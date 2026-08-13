/**
 * Message contracts for the two hops untrusted content travels across.
 *
 *   background  --(chrome.runtime)-->  content script  --(postMessage)-->  sandbox
 *
 * The file is always carried as an inert string. Nothing on either hop is ever
 * inserted into the Google Chat DOM.
 */

/** Hard cap on attachment size; larger files are rejected instead of previewed. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/**
 * How the sandbox must turn the file's text into a document.
 *
 * This is a security boundary, not a display preference. Only `html` is handed
 * to the frame as-is; every other kind is a document *we* generate, with the
 * file's text escaped into it, so a file containing `<script>` renders as
 * visible characters rather than becoming a script.
 */
export type AttachmentKind = 'html' | 'markdown' | 'json' | 'mermaid' | 'plantuml'

/**
 * The kinds whose whole file is one diagram — `.mmd` and `.puml` attachments,
 * as opposed to a fenced block inside a Markdown file.
 *
 * They stay two kinds rather than one `diagram` kind because their privacy
 * properties differ: mermaid is drawn locally, while drawing plantuml sends the
 * source to a server. The preview has to be able to say which is happening.
 */
export type DiagramKind = Extract<AttachmentKind, 'mermaid' | 'plantuml'>

/**
 * How much of a JSON tree starts expanded.
 *
 * The JSON view is built from <details>/<summary>, so collapsing and expanding
 * individual nodes costs no JavaScript. Expand-all and collapse-all cannot be
 * done that way, so they are a re-render driven from the modal instead.
 */
export type JsonExpand = 'auto' | 'all' | 'none'

/** content script -> background: fetch an attachment's bytes as text. */
export interface FetchAttachmentRequest {
  type: 'FETCH_ATTACHMENT'
  url: string
  maxBytes: number
}

/**
 * content script -> background: fetch a rendered PlantUML diagram.
 *
 * This goes through the background rather than being an <img src> in the
 * document, for two reasons. The sandbox CSP's `img-src` is static, so a
 * user-configured server could never be allowlisted; and keeping `img-src` at
 * `data: blob:` means no host is reachable from previewed content at all.
 */
export interface FetchDiagramRequest {
  type: 'FETCH_DIAGRAM'
  url: string
}

/**
 * content script -> background: fetch one resource an HTML attachment links to.
 *
 * Bytes come back base64 rather than decoded, because the caller does not know
 * yet what it is holding: a stylesheet is decoded to text and rewritten, a font
 * or image becomes a `data:` URI verbatim. Base64 is the one form that survives
 * both without a lossy round-trip through a string.
 */
export interface FetchAssetRequest {
  type: 'FETCH_ASSET'
  url: string
}

export type FetchAssetResponse =
  | { ok: true; contentType: string; base64: string; byteLength: number }
  | { ok: false; error: string }

export type FetchDiagramResponse = { ok: true; dataUri: string } | { ok: false; error: string }

export type FetchAttachmentResponse =
  | { ok: true; text: string; contentType: string; byteLength: number }
  | { ok: false; error: string }

export type RuntimeRequest = FetchAttachmentRequest | FetchDiagramRequest | FetchAssetRequest

/** sandbox -> content script: the sandbox frame's listener is installed. */
export interface SandboxReadyMessage {
  type: 'SANDBOX_READY'
}

/** content script -> sandbox: render this file in the inner, isolated frame. */
export interface RenderAttachmentMessage {
  type: 'RENDER_ATTACHMENT'
  text: string
  fileName: string
  kind: AttachmentKind
  /** Only meaningful for `json`. */
  expand: JsonExpand
  /** Diagram settings, forwarded because the sandbox cannot read storage itself. */
  diagrams: DiagramSettings
  /**
   * Whether linked stylesheets, fonts, images and scripts are built into the
   * document before rendering, and from which hosts.
   *
   * Forwarded for the same reason as `diagrams`. The sandbox uses the host list
   * only to avoid asking for URLs that will be refused; the content script checks
   * it again on every request, and that check is the one that counts.
   *
   * Only ever honoured for `html` — every other kind is a document this extension
   * generates, so there is nothing in it that could link anywhere.
   */
  assets: AssetSettings
  /**
   * Whether the inner frame gets `allow-scripts`. Off unless the user asks for
   * it on that specific preview — a static render cannot capture keystrokes, so
   * this is what stops a fake login form in an attachment from being useful.
   *
   * Only ever honoured for `html`. The sandbox re-checks rather than trusting it.
   */
  allowScripts: boolean
}

/** The slice of user settings the sandbox needs to render a document. */
export interface DiagramSettings {
  mermaid: boolean
  plantUml: boolean
  plantUmlServer: string
}

/** The slice of user settings that decides whether linked resources are inlined. */
export interface AssetSettings {
  enabled: boolean
  hosts: string[]
}

/**
 * sandbox -> content script: fetch this PlantUML URL on my behalf.
 *
 * The sandbox page has no `chrome.*` APIs, so every network need has to be
 * relayed. Each request carries an id the reply echoes back.
 */
export interface DiagramRequestMessage {
  type: 'DIAGRAM_REQUEST'
  id: number
  url: string
}

/** content script -> sandbox: the reply to one `DIAGRAM_REQUEST`. */
export interface DiagramResultMessage {
  type: 'DIAGRAM_RESULT'
  id: number
  result: FetchDiagramResponse
}

/**
 * sandbox -> content script: fetch this asset URL on my behalf.
 *
 * Same relay and the same reason as `DIAGRAM_REQUEST`, but far more of them: one
 * document can reference dozens of stylesheets, fonts and images, and they all
 * resolve concurrently and out of order. Hence the id.
 */
export interface AssetRequestMessage {
  type: 'ASSET_REQUEST'
  id: number
  url: string
}

/** content script -> sandbox: the reply to one `ASSET_REQUEST`. */
export interface AssetResultMessage {
  type: 'ASSET_RESULT'
  id: number
  result: FetchAssetResponse
}

/**
 * sandbox -> content script: what the asset inlining managed for this render.
 *
 * The counts go to the modal's own warning bar, never into the document: an
 * `html` attachment is the sender's document and this extension does not write
 * into it. Without this the failure is invisible — a file whose CDN is not on the
 * allowlist renders unstyled and looks broken, with nothing naming the host to
 * add.
 */
export interface AssetReportMessage {
  type: 'ASSET_REPORT'
  inlined: number
  failed: number
  blockedHosts: string[]
}

export type SandboxMessage =
  | SandboxReadyMessage
  | AssetReportMessage
  | RenderAttachmentMessage
  | DiagramRequestMessage
  | DiagramResultMessage
  | AssetRequestMessage
  | AssetResultMessage

export function isSandboxMessage(value: unknown): value is SandboxMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  )
}
