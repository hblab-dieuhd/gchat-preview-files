/**
 * Finds previewable attachments in the Google Chat DOM.
 *
 * Google Chat ships obfuscated, build-generated class names that change between
 * releases, so nothing here may key off CSS classes. Detection instead relies on
 * the one stable, self-describing thing Chat exposes: the attachment URL itself.
 *
 * A real attachment renders as a thumbnail card, NOT as a link:
 *
 *   <div class="nmzsyc r1jLeb">                     <- obfuscated, do not match
 *     <img class="INRavc hL6y0b"
 *          alt="hblab-slide-profile.html"           <- file name
 *          src="https://chat.google.com/api/get_attachment_url
 *               ?url_type=THUMBNAIL_URL
 *               &content_type=text%2Fhtml           <- MIME type
 *               &attachment_token=AOo0EEV5...
 *               &sz=w512">
 *   </div>
 *
 * THIS IS THE FILE TO TUNE when detection breaks. Everything version-fragile is
 * confined to the tables below, plus `src/shared/attachment-url.ts` for the URL
 * rewriting.
 */

import { isAttachmentEndpoint, toDownloadUrl } from '../shared/attachment-url.ts'
import type { AttachmentKind } from '../shared/protocol.ts'

/**
 * File extensions worth previewing, and how each must be rendered.
 *
 * The extension decides the kind, not the MIME type: Chat reports `.md` as
 * `text/plain` and frequently reports `.html` as `application/octet-stream`.
 *
 * `.txt` is deliberately absent — Google Chat previews plain text natively, so
 * adding a second button next to its own preview would only be noise.
 */
/**
 * What may follow an extension for it to count.
 *
 * Not simply `[?#]|$`, and the difference is load-bearing. Chat labels an
 * attachment card with punctuation around the name — the real `aria-label` is
 * `", GetStoreProductSalesScorecardWeekly(2).puml."` — and that trailing period
 * made the label unmatchable, so the card went undetected entirely.
 *
 * A trailing `.,;` and a following space are allowed; another word character is
 * not. So `notes.md (12 KB)` matches while `data.json.gz` and `page.htmlx`
 * still do not.
 */
const EXTENSION_END = '(?:[?#]|[.,;]?(?:\\s|$))'

/** One extension-matching pattern, so the rule above cannot drift between them. */
function extensionPattern(alternatives: string): RegExp {
  return new RegExp(`\\.(?:${alternatives})${EXTENSION_END}`, 'i')
}

const HTML_EXT = 'html?|xhtml'
const MARKDOWN_EXT = 'md|markdown|mdown|mkd'
const JSON_EXT = 'json'
const MERMAID_EXT = 'mermaid|mmd'
const PLANTUML_EXT = 'plantuml|puml|iuml|wsd|pu'

const KIND_BY_EXTENSION: readonly (readonly [RegExp, AttachmentKind])[] = [
  [extensionPattern(HTML_EXT), 'html'],
  [extensionPattern(MARKDOWN_EXT), 'markdown'],
  [extensionPattern(JSON_EXT), 'json'],
  // Diagram sources. Chat serves all of these as text/plain, so the extension is
  // the only thing that can tell them apart — there is no MIME fallback below.
  [extensionPattern(MERMAID_EXT), 'mermaid'],
  [extensionPattern(PLANTUML_EXT), 'plantuml'],
]

/** Fallback when the file name carries no usable extension. */
const KIND_BY_CONTENT_TYPE: readonly (readonly [RegExp, AttachmentKind])[] = [
  [/^text\/html|^application\/xhtml\+xml/i, 'html'],
  [/^text\/(?:x-)?markdown/i, 'markdown'],
  [/^application\/(?:[\w.+-]+\+)?json|^text\/json/i, 'json'],
]

/** Matches a previewable file name inside a longer label. */
const FILE_NAME_IN_LABEL = new RegExp(
  `([^\\s/\\\\"']+\\.(?:${[HTML_EXT, MARKDOWN_EXT, JSON_EXT, MERMAID_EXT, PLANTUML_EXT].join('|')}))${EXTENSION_END}`,
  'i',
)

const DEFAULT_NAMES: Record<AttachmentKind, string> = {
  html: 'attachment.html',
  markdown: 'attachment.md',
  json: 'attachment.json',
  mermaid: 'attachment.mmd',
  plantuml: 'attachment.puml',
}

/** Marks nodes already processed so the MutationObserver stays idempotent. */
const PROCESSED_ATTR = 'data-gchat-html-preview'

export interface HtmlAttachment {
  /** The preview button is inserted directly after this element. */
  mountAfter: Element
  fileName: string
  downloadUrl: string
  kind: AttachmentKind
}

/**
 * How far up to look for a file name.
 *
 * Chat's detailed-thread attachment card has **no `<img>` at all** — the
 * thumbnail is a `<span>` with a `background-image` — and the download `<a>`
 * carries no label of its own, only an "Open in new tab" button. The file name
 * lives on an ancestor `div[role="button"]`'s `title` and `aria-label`, two
 * levels up. Without reading those the card is invisible: its endpoint URL has
 * no `content_type` parameter to fall back on either.
 *
 * Ancestors are appended after the element's own labels, so a label on the
 * element itself still wins.
 */
const ANCESTOR_LABEL_DEPTH = 4

export function findHtmlAttachments(root: ParentNode = document): HtmlAttachment[] {
  const found: HtmlAttachment[] = []
  // One button per attachment, however many elements in the card point at it.
  // The token is the only stable identity: the thumbnail and the download link
  // carry the same attachment through visibly different URLs.
  const seenTokens = new Set<string>()

  const candidates = root.querySelectorAll<HTMLImageElement | HTMLAnchorElement>(
    `img[src]:not([${PROCESSED_ATTR}]), a[href]:not([${PROCESSED_ATTR}])`,
  )

  for (const element of candidates) {
    const isImage = element instanceof HTMLImageElement
    const rawUrl = isImage ? element.src : element.href
    const ownLabels = isImage
      ? [element.alt, element.title]
      : [
          element.getAttribute('download'),
          element.getAttribute('aria-label'),
          element.title,
          element.textContent,
        ]

    const attachment = describeAttachment(rawUrl, [...ownLabels, ...ancestorLabels(element)])
    if (!attachment) continue

    element.setAttribute(PROCESSED_ATTR, '1')

    const token = readParam(rawUrl, 'attachment_token')
    if (token) {
      if (seenTokens.has(token)) continue
      seenTokens.add(token)
    }

    found.push({
      // The thumbnail's wrapper is the smallest sane anchor point; inserting
      // inside the <img>'s own box is not possible.
      mountAfter: isImage ? (element.parentElement ?? element) : element,
      ...attachment,
    })
  }

  return found
}

/** `title` and `aria-label` from a few levels up. See ANCESTOR_LABEL_DEPTH. */
function ancestorLabels(element: Element): (string | null)[] {
  const labels: (string | null)[] = []
  let node = element.parentElement

  for (let depth = 0; depth < ANCESTOR_LABEL_DEPTH && node; depth += 1) {
    labels.push(node.getAttribute('title'), node.getAttribute('aria-label'))
    node = node.parentElement
  }

  return labels
}

/**
 * Decides whether a URL points at a previewable attachment and, if so, returns
 * its file name, how to render it, and a URL that serves the actual bytes.
 */
export function describeAttachment(
  rawUrl: string,
  labels: (string | null | undefined)[],
): { fileName: string; downloadUrl: string; kind: AttachmentKind } | null {
  const labelName = pickFileName(labels)

  if (isAttachmentEndpoint(rawUrl)) {
    // The endpoint's own path carries no file name, hence labels only.
    const contentType = readParam(rawUrl, 'content_type')
    const kind = kindFromFileName(labelName) ?? kindFromContentType(contentType)
    if (!kind) return null

    return {
      fileName: labelName ?? DEFAULT_NAMES[kind],
      downloadUrl: toDownloadUrl(rawUrl),
      kind,
    }
  }

  // Anything that is not the attachment endpoint is a link somebody typed or
  // pasted into the conversation, not a file they uploaded — and a URL ending in
  // `.html` is an ordinary web page, which the browser already opens perfectly
  // well. Previewing those was worse than useless: the extension has no host
  // permission for arbitrary sites, so the button appeared and then failed to
  // fetch. Only uploaded files get a button.
  return null
}

function kindFromFileName(fileName: string | null): AttachmentKind | null {
  if (!fileName) return null
  for (const [pattern, kind] of KIND_BY_EXTENSION) {
    if (pattern.test(fileName)) return kind
  }
  return null
}

function kindFromContentType(contentType: string | null): AttachmentKind | null {
  if (!contentType) return null
  for (const [pattern, kind] of KIND_BY_CONTENT_TYPE) {
    if (pattern.test(contentType)) return kind
  }
  return null
}

/** First label that looks like a previewable file name. */
function pickFileName(labels: (string | null | undefined)[]): string | null {
  const cleaned = labels
    .map((label) => label?.trim())
    .filter((label): label is string => Boolean(label))

  for (const label of cleaned) {
    const match = FILE_NAME_IN_LABEL.exec(label)
    if (match?.[1]) return match[1]
  }

  return cleaned[0] ?? null
}

function readParam(rawUrl: string, name: string): string | null {
  const match = new RegExp(`[?&]${name}=([^&]*)`, 'i').exec(rawUrl)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/**
 * Watches for attachments appearing in the virtualized message list. Chat mounts
 * and unmounts messages as the user scrolls, so a one-shot scan at load time
 * misses almost everything.
 */
export function observeHtmlAttachments(
  onFound: (attachments: HtmlAttachment[]) => void,
  debounceMs = 300,
): () => void {
  const emit = (): void => {
    const attachments = findHtmlAttachments()
    if (attachments.length > 0) onFound(attachments)
  }

  // Not `number`: @types/node is in scope for the test runner and widens the
  // return type of setTimeout.
  let timer: ReturnType<typeof setTimeout> | undefined
  const observer = new MutationObserver(() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(emit, debounceMs)
  })

  observer.observe(document.body, { childList: true, subtree: true })
  emit()

  return () => {
    if (timer !== undefined) clearTimeout(timer)
    observer.disconnect()
  }
}
