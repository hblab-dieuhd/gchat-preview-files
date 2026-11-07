import {
  isSandboxMessage,
  type AssetResultMessage,
  type AttachmentKind,
  type DiagramResultMessage,
  type FetchAssetRequest,
  type FetchAssetResponse,
  type FetchDiagramRequest,
  type FetchDiagramResponse,
  type JsonExpand,
  type RenderAttachmentMessage,
  type HtmlFinding,
} from '../shared/protocol.ts'
import { isAssetUrlAllowed, type Settings } from '../shared/settings.ts'
import { requestFromBackground } from './background-request.ts'
import { bannerFor } from './scan-banner.ts'

/**
 * The modal that hosts the preview.
 *
 * Three isolation boundaries matter here and none is optional:
 *  - The modal's own UI lives in a shadow root so Google Chat's stylesheet
 *    cannot restyle it and vice versa.
 *  - The attachment's HTML is never touched by this file. It is handed to the
 *    sandboxed extension page as a string over postMessage, and that page
 *    renders it inside a further frame with no same-origin access.
 *  - Scripts in the attachment are off until the user turns them on for that
 *    preview. Everything attacker-controlled that reaches this file — the file
 *    name included, which comes from the sender's `alt` text — is written with
 *    `textContent`, never `innerHTML`.
 */

const STYLES = `
  :host { all: initial; }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(32, 33, 36, 0.6);
    font-family: "Google Sans", Roboto, Arial, sans-serif;
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(1100px, 100%);
    height: min(820px, 100%);
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid #e0e0e0;
    background: #f8f9fa;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    color: #202124;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    flex: none;
    padding: 2px 8px;
    border-radius: 10px;
    background: #e6f4ea;
    color: #137333;
    font-size: 11px;
    font-weight: 500;
  }
  .badge.scripts-on { background: #fef7e0; color: #b06000; }
  button {
    flex: none;
    border: 1px solid #dadce0;
    border-radius: 6px;
    padding: 6px 12px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    background: #fff;
    color: #5f6368;
  }
  button:hover:not(:disabled) { background: #f1f3f4; color: #202124; }
  button:disabled { color: #bdc1c6; border-color: #f1f3f4; cursor: default; }
  button[hidden] { display: none; }
  button.plain { border-color: transparent; background: transparent; }
  .warning {
    padding: 8px 16px;
    border-bottom: 1px solid #e0e0e0;
    background: #f1f3f4;
    color: #3c4043;
    font-size: 12px;
    line-height: 1.5;
  }
  .warning[hidden] { display: none; }
  .warning.caution { background: #fef7e0; color: #5f4b1f; }
  .warning.danger { background: #fce8e6; color: #a50e0e; font-weight: 500; }
  button.danger { border-color: #d93025; color: #c5221f; }
  .body { position: relative; flex: 1; background: #fff; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    font-size: 14px;
    color: #5f6368;
    background: #fff;
  }
  .status.error { color: #c5221f; }
  .status[hidden] { display: none; }
`

const BADGES: Record<AttachmentKind, string> = {
  html: 'Scripts off',
  markdown: 'Markdown · inert',
  json: 'JSON · inert',
  mermaid: 'Mermaid · local',
  plantuml: 'PlantUML · inert',
}

/**
 * The only kind besides `html` with something to say, because drawing the diagram
 * is what sends the file's source to a third-party server. Saying so on the
 * preview itself is the only place the user sees it happen.
 *
 * Markdown, JSON and Mermaid get no bar: this extension generates those documents
 * and escapes what goes into them, so there is nothing about the file to report.
 */
function plantUmlNote(settings: Settings): string {
  if (!settings.plantUmlEnabled) {
    return (
      'PlantUML rendering is off in this extension’s settings, so this file is shown as ' +
      'source. Nothing was sent anywhere.'
    )
  }

  let host = settings.plantUmlServer
  try {
    host = new URL(settings.plantUmlServer).host
  } catch {
    // Keep the raw value; normalise() should have made this unreachable.
  }

  return `Drawing this diagram sent the file’s source to ${host}.`
}

export interface PreviewHandle {
  /** Swap the modal from its loading state to the rendered attachment. */
  render(text: string): void
  fail(message: string): void
  close(): void
}

function fetchDiagram(url: string): Promise<FetchDiagramResponse> {
  const request: FetchDiagramRequest = { type: 'FETCH_DIAGRAM', url }

  // Same worker-wake retry as the attachment path. A diagram is more exposed to
  // it than an attachment is: several arrive at once from one document, so the
  // first can be what starts the worker while the rest race its shutdown.
  return requestFromBackground<FetchDiagramResponse>(request).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }))
}

/**
 * Fetches one resource an HTML attachment links to — but only from a host the
 * user has allowed.
 *
 * This check is the enforcement point, not the host permission. Most CDNs answer
 * `Access-Control-Allow-Origin: *`, so the service worker's fetch would succeed
 * from anywhere; the permission is where the user consents, this is where the
 * allowlist is applied. It runs here rather than in the sandbox because the
 * sandbox is the context holding untrusted content and cannot read settings.
 */
function fetchAsset(url: string, settings: Settings): Promise<FetchAssetResponse> {
  if (!settings.remoteAssets) {
    return Promise.resolve({ ok: false as const, error: 'Loading linked resources is switched off.' })
  }

  if (!isAssetUrlAllowed(url, settings.remoteAssetHosts)) {
    return Promise.resolve({ ok: false as const, error: 'That host is not on the allowed list.' })
  }

  const request: FetchAssetRequest = { type: 'FETCH_ASSET', url }

  return requestFromBackground<FetchAssetResponse>(request).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }))
}

/** "cdn.a, cdn.b and cdn.c", so the note reads as a sentence rather than a list. */
function listHosts(hosts: string[]): string {
  if (hosts.length === 1) return hosts[0]!
  return `${hosts.slice(0, -1).join(', ')} and ${hosts[hosts.length - 1]!}`
}

export function openPreview(
  fileName: string,
  kind: AttachmentKind,
  settings: Settings,
): PreviewHandle {
  const host = document.createElement('div')
  host.style.setProperty('display', 'contents')
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLES

  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-label', `Preview of ${fileName}`)

  const dialog = document.createElement('div')
  dialog.className = 'dialog'

  const header = document.createElement('header')
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = fileName
  const badge = document.createElement('span')
  badge.className = 'badge'
  const scriptsButton = document.createElement('button')
  // JSON collapsing is native <details> behaviour inside the frame, but expand-all
  // and collapse-all cannot be, so they re-render through the sandbox.
  const expandButton = document.createElement('button')
  expandButton.textContent = 'Expand all'
  const collapseButton = document.createElement('button')
  collapseButton.textContent = 'Collapse all'
  const closeButton = document.createElement('button')
  closeButton.className = 'plain'
  closeButton.textContent = 'Close'
  header.append(title, badge, expandButton, collapseButton, scriptsButton, closeButton)

  const warning = document.createElement('div')
  warning.className = 'warning'
  warning.hidden = true

  const body = document.createElement('div')
  body.className = 'body'

  const frame = document.createElement('iframe')
  frame.src = chrome.runtime.getURL('sandbox.html')

  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = 'Loading preview…'

  body.append(frame, status)
  dialog.append(header, warning, body)
  backdrop.append(dialog)
  shadow.append(style, backdrop)
  document.body.append(host)

  let closed = false
  let sandboxReady = false
  let text: string | null = null
  // Scripts only ever start on for HTML: the other kinds are documents this
  // extension generates, so the setting has nothing to apply to.
  let allowScripts = kind === 'html' && settings.allowScriptsByDefault
  let expand: JsonExpand = settings.jsonExpand
  let findings: HtmlFinding[] = []
  let assetNotes: string[] = []

  const syncWarning = (): void => {
    // With inlining on, anything still remote is named by `assetNotes`, by host.
    const shown = settings.remoteAssets ? findings.filter((f) => f !== 'remote') : findings
    const banner = kind === 'html' ? bannerFor(shown, allowScripts) : null
    const note = kind === 'plantuml' ? plantUmlNote(settings) : ''
    const text = [banner?.text ?? note, ...assetNotes].filter(Boolean).join(' ')

    warning.textContent = text
    warning.hidden = text === ''
    warning.className = `warning ${banner?.level ?? 'notice'}`

    const disguised = findings.includes('obfuscated')
    scriptsButton.classList.toggle('danger', disguised)
    if (disguised && !allowScripts) {
      scriptsButton.title =
        'This file’s scripts look deliberately disguised. Only run them if you trust where it came from.'
    }
  }

  const syncControls = (): void => {
    badge.textContent = allowScripts ? 'Scripts on · offline' : BADGES[kind]
    badge.classList.toggle('scripts-on', allowScripts)
    scriptsButton.textContent = allowScripts ? 'Disable scripts' : 'Enable scripts'
    scriptsButton.title = allowScripts
      ? 'Re-render this file with scripts blocked'
      : 'Re-render this file with its scripts allowed to run. They stay cut off from the network.'
    // Markdown and JSON are documents this extension generates, so there is
    // nothing in them the user could sensibly opt into running.
    scriptsButton.hidden = kind !== 'html'
    expandButton.hidden = kind !== 'json'
    collapseButton.hidden = kind !== 'json'
    expandButton.disabled = expand === 'all'
    collapseButton.disabled = expand === 'none'
    syncWarning()
  }

  const post = (): void => {
    if (text === null || !sandboxReady) return
    const message: RenderAttachmentMessage = {
      type: 'RENDER_ATTACHMENT',
      text,
      fileName,
      kind,
      expand,
      diagrams: {
        mermaid: settings.mermaidEnabled,
        plantUml: settings.plantUmlEnabled,
        plantUmlServer: settings.plantUmlServer,
      },
      assets: {
        enabled: kind === 'html' && settings.remoteAssets,
        hosts: settings.remoteAssetHosts,
      },
      allowScripts,
    }
    // targetOrigin must be "*": an opaque origin cannot be named.
    frame.contentWindow?.postMessage(message, '*')
    status.hidden = true
  }

  const onSandboxMessage = (event: MessageEvent): void => {
    // The sandbox page has an opaque origin, so `event.origin` is "null" and
    // useless for validation. Identity of the sending window is the real check —
    // and it also rejects the attachment frame, which can post here too.
    if (event.source !== frame.contentWindow) return
    if (!isSandboxMessage(event.data)) return

    // The sandbox cannot reach the network, so diagram fetches are relayed here.
    if (event.data.type === 'DIAGRAM_REQUEST') {
      const { id, url } = event.data
      void fetchDiagram(url).then((result) => {
        const reply: DiagramResultMessage = { type: 'DIAGRAM_RESULT', id, result }
        frame.contentWindow?.postMessage(reply, '*')
      })
      return
    }

    if (event.data.type === 'ASSET_REQUEST') {
      const { id, url } = event.data
      void fetchAsset(url, settings).then((result) => {
        const reply: AssetResultMessage = { type: 'ASSET_RESULT', id, result }
        frame.contentWindow?.postMessage(reply, '*')
      })
      return
    }

    // A file whose CDN is not allowed renders unstyled and simply looks broken,
    // so the warning bar names the host to add rather than leaving the reader to
    // guess. It goes here, never into the document.
    if (event.data.type === 'ASSET_REPORT') {
      const { blockedHosts, failed, inlined } = event.data
      const notes: string[] = []
      // Fetching these is the one thing that did leave the machine, and the bar is
      // the only place the reader can learn it.
      if (inlined > 0) {
        notes.push(
          'Resources it links to on your allowed hosts were downloaded and built into this ' +
            'preview, so those hosts can tell you opened it.',
        )
      }
      if (blockedHosts.length > 0) {
        notes.push(
          `This file also links to ${listHosts(blockedHosts)}, which ${
            blockedHosts.length === 1 ? 'is' : 'are'
          } not on your allowed list, so ${
            blockedHosts.length === 1 ? 'it was' : 'they were'
          } not loaded.`,
        )
      }
      if (failed > 0) {
        notes.push(`${failed} allowed resource${failed === 1 ? '' : 's'} could not be downloaded.`)
      }
      assetNotes = notes
      syncWarning()
      return
    }

    if (event.data.type === 'HTML_SCAN') {
      findings = event.data.findings
      syncWarning()
      return
    }

    if (event.data.type !== 'SANDBOX_READY') return

    sandboxReady = true
    post()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  }

  const close = (): void => {
    if (closed) return
    closed = true
    window.removeEventListener('message', onSandboxMessage)
    window.removeEventListener('keydown', onKeyDown, true)
    host.remove()
  }

  window.addEventListener('message', onSandboxMessage)
  window.addEventListener('keydown', onKeyDown, true)
  closeButton.addEventListener('click', close)
  scriptsButton.addEventListener('click', () => {
    allowScripts = !allowScripts
    syncControls()
    post()
  })
  const setExpand = (next: JsonExpand): void => {
    expand = next
    syncControls()
    post()
  }
  expandButton.addEventListener('click', () => setExpand('all'))
  collapseButton.addEventListener('click', () => setExpand('none'))
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })

  syncControls()

  return {
    render(value: string): void {
      if (closed) return
      text = value
      post()
    },
    fail(message: string): void {
      if (closed) return
      frame.remove()
      scriptsButton.remove()
      expandButton.remove()
      collapseButton.remove()
      badge.remove()
      warning.remove()
      status.hidden = false
      status.classList.add('error')
      status.textContent = message
    },
    close,
  }
}
