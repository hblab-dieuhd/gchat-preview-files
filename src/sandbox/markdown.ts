import { Marked } from 'marked'
import { highlight } from './highlight.ts'

/**
 * Markdown -> HTML for the preview, with the two things Markdown allows that we
 * do not want turned off.
 *
 * 1. **Raw HTML passthrough.** CommonMark lets a document embed arbitrary HTML.
 *    The `html` renderer escapes those tokens instead, so `<script>` in a .md
 *    file shows up as visible characters.
 *
 * 2. **Dangerous link schemes.** `[x](javascript:...)` otherwise emits a live
 *    `javascript:` href. Only http/https/mailto and relative targets survive;
 *    anything else is rendered as plain text.
 *
 * Note what is NOT done here: escaping the source before parsing. That is the
 * obvious approach and it is wrong — it double-escapes inside code spans and
 * fences, so `` `code <b>` `` renders as `&lt;b&gt;` instead of `<b>`. The
 * escaping has to happen per-token, after parsing.
 *
 * Fenced blocks carrying a language tag are syntax-coloured by `highlight.ts`,
 * which produces `<span>`s at build time because the document's frame runs no
 * JavaScript.
 *
 * Fenced blocks tagged `mermaid` or `plantuml` become diagrams instead of code:
 *
 *  - **mermaid** renders locally. The source is collected here and turned into
 *    SVG later by the caller, because mermaid is async and lives in a bundle
 *    that is only loaded when a document actually needs it.
 *  - **plantuml** cannot render locally — it is a Java program, and the only
 *    browser route is a PlantUML server, which means **the diagram source
 *    leaves the machine**. Its source is collected here too; the caller fetches
 *    the rendered image through the background and inlines it as a data: URI.
 *    Emitting a plain <img src="https://server/..."> would have been simpler but
 *    is not an option: the sandbox CSP's `img-src` is static, so a
 *    user-configured server could never be allowlisted.
 */

const ALLOWED_SCHEME = /^(?:https?|mailto):/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Fence languages that mean "this is a PlantUML diagram". */
const PLANTUML_LANGS = new Set(['plantuml', 'puml', 'uml'])

/**
 * Diagram sources found during the last parse.
 *
 * Module-scoped because marked's renderer callbacks cannot return extra values.
 * Parsing is synchronous and single-threaded, so these are filled and handed
 * back before any other parse can start.
 */
let collectedMermaid: string[] = []
let collectedPlantUml: string[] = []
let currentOptions: MarkdownOptions = { mermaid: true, plantUml: true }

const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token) {
      return escapeHtml(token.text)
    },
    code(token) {
      const lang = (token.lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''

      if (lang === 'mermaid' && currentOptions.mermaid) {
        const index = collectedMermaid.push(token.text) - 1
        // Filled in by buildDocument once mermaid has produced the SVG.
        return `<div class="diagram" data-mermaid="${index}"></div>`
      }

      if (PLANTUML_LANGS.has(lang) && currentOptions.plantUml) {
        const index = collectedPlantUml.push(token.text) - 1
        return `<div class="diagram" data-plantuml="${index}"></div>`
      }

      // Colouring is baked in here rather than left to a script in the document:
      // the frame rendering it has sandbox="", so nothing in it can run. A
      // language hljs does not know returns null and the block stays plain.
      const coloured = highlight(token.text, lang)
      const classes = [lang ? `language-${escapeHtml(lang)}` : '', coloured ? 'hljs' : '']
        .filter(Boolean)
        .join(' ')
      const className = classes ? ` class="${classes}"` : ''

      // `coloured` is inserted unescaped — hljs escapes the source as it
      // tokenises, and highlight.test.ts pins that it does.
      return `<pre><code${className}>${coloured ?? escapeHtml(token.text)}\n</code></pre>`
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens ?? [])
      if (!isSafeHref(token.href)) return inner
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      // rel/target: a preview link should never hand the opener to the target.
      return `<a href="${escapeHtml(token.href)}"${title} target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
    },
    image(token) {
      const alt = escapeHtml(token.text ?? '')
      if (!isSafeHref(token.href)) return alt
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      return `<img src="${escapeHtml(token.href)}" alt="${alt}"${title}>`
    },
  },
})

export interface MarkdownOptions {
  /** When off, the fence stays a code block rather than becoming a diagram. */
  mermaid: boolean
  plantUml: boolean
}

export interface MarkdownResult {
  html: string
  /** Sources indexed to match the `data-mermaid` / `data-plantuml` placeholders. */
  mermaid: string[]
  plantUml: string[]
}

export function renderMarkdown(
  source: string,
  options: MarkdownOptions = { mermaid: true, plantUml: true },
): MarkdownResult {
  collectedMermaid = []
  collectedPlantUml = []
  currentOptions = options

  const html = markdown.parse(source, { async: false })
  return { html, mermaid: collectedMermaid, plantUml: collectedPlantUml }
}

/** PlantUML's own base64 variant: standard 6-bit packing, non-standard alphabet. */
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

/**
 * The URL that renders `source`, using PlantUML's deflate + custom-base64 form.
 *
 * This was `~h` hex, which needs no compressor and no async encode. That was
 * wrong for a reason measured against the live server, not guessed: hex doubles
 * the source, and the server rejects the request with **HTTP 400 somewhere past
 * an 8 KB URL** — so every `.puml` file over roughly 3.5 KB failed to render,
 * which is most real diagrams. Deflate takes the same 4 KB source from an 8082
 * character URL that 400s to a 762 character one that renders.
 *
 * Hex survives as the fallback for a browser with no `CompressionStream`. It is
 * still correct, just size-limited, and it keeps a missing API from taking the
 * feature out entirely.
 */
export async function plantUmlUrl(server: string, source: string): Promise<string> {
  const base = server.replace(/\/+$/, '')
  const bytes = new TextEncoder().encode(source)

  const deflated = await deflateRaw(bytes)
  if (deflated) return `${base}/svg/${encodePlantUml(deflated)}`

  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `${base}/svg/~h${hex}`
}

/** Raw deflate — no zlib header, which is what PlantUML's decoder expects. */
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null

  try {
    const stream = new CompressionStream('deflate-raw')
    const writer = stream.writable.getWriter()
    void writer.write(bytes)
    void writer.close()
    return new Uint8Array(await new Response(stream.readable).arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Three bytes to four characters, like base64, but over PlantUML's alphabet and
 * with no `=` padding — the decoder takes the length from the deflate stream.
 */
function encodePlantUml(bytes: Uint8Array): string {
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] ?? 0
    const b2 = bytes[i + 1] ?? 0
    const b3 = bytes[i + 2] ?? 0

    out += PLANTUML_ALPHABET.charAt((b1 >> 2) & 0x3f)
    out += PLANTUML_ALPHABET.charAt((((b1 & 0x03) << 4) | (b2 >> 4)) & 0x3f)
    out += PLANTUML_ALPHABET.charAt((((b2 & 0x0f) << 2) | (b3 >> 6)) & 0x3f)
    out += PLANTUML_ALPHABET.charAt(b3 & 0x3f)
  }

  return out
}

/**
 * Schemes are checked with whitespace and control characters removed, because
 * `java\tscript:` and friends are parsed as a scheme by browsers but not by a
 * naive regex. The original string is what gets emitted if the check passes.
 */
function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false
  const cleaned = href.replace(/[\u0000-\u0020\u007F]/g, '')
  if (!cleaned) return false
  // No scheme at all means a relative or fragment target, which is inert here.
  return HAS_SCHEME.test(cleaned) ? ALLOWED_SCHEME.test(cleaned) : true
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
