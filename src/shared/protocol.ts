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

export type FetchDiagramResponse = { ok: true; dataUri: string } | { ok: false; error: string }

export type FetchAttachmentResponse =
  | { ok: true; text: string; contentType: string; byteLength: number }
  | { ok: false; error: string }

export type RuntimeRequest = FetchAttachmentRequest | FetchDiagramRequest

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

export type SandboxMessage =
  | SandboxReadyMessage
  | RenderAttachmentMessage
  | DiagramRequestMessage
  | DiagramResultMessage

export function isSandboxMessage(value: unknown): value is SandboxMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  )
}
