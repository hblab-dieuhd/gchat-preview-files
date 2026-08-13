import {
  isSandboxMessage,
  type AssetReportMessage,
  type SandboxReadyMessage,
} from '../shared/protocol.ts'
import { buildDocument, escapeHtml } from './document.ts'
import { renderMermaid } from './mermaid.ts'
import { requestDiagram, handleDiagramResult } from './diagram-relay.ts'
import { requestAsset, handleAssetResult } from './asset-relay.ts'

/**
 * Runs inside the manifest-declared sandboxed page (opaque origin, no `chrome.*`
 * APIs). It receives an attachment's text from the content script, builds a
 * document for it, and hands that to a nested frame.
 *
 * `srcdoc` is used rather than any form of DOM insertion in this page: the
 * attachment must own its own document so its scripts — when enabled — run in
 * the nested frame's opaque origin instead of this page's.
 *
 * The frame is rebuilt from scratch on every render. The `sandbox` attribute is
 * only read when a frame loads, so toggling scripts by mutating the existing
 * frame would silently keep the old permissions.
 */

const HOST_ID = 'frame-host'

window.addEventListener('message', (event: MessageEvent) => {
  // Only the content script that embedded this page may drive it. The nested
  // attachment frame can reach this listener too, but its `source` is the frame,
  // never the parent, so it is rejected here.
  if (event.source !== window.parent) return
  if (!isSandboxMessage(event.data)) return

  if (event.data.type === 'DIAGRAM_RESULT') {
    handleDiagramResult(event.data)
    return
  }

  if (event.data.type === 'ASSET_RESULT') {
    handleAssetResult(event.data)
    return
  }

  if (event.data.type !== 'RENDER_ATTACHMENT') return

  const host = document.getElementById(HOST_ID)
  if (!host) return

  const { text, fileName, kind, expand, diagrams, assets, allowScripts } = event.data

  // Re-checked rather than trusted: every kind but `html` is a document we
  // generate, so there is never a reason to run script in one, whatever the
  // message says.
  const scripts = kind === 'html' && allowScripts

  document.title = fileName

  // Rendering is async because a markdown file may hold mermaid diagrams, which
  // need the on-demand bundle. A later message simply overwrites this frame.
  void buildDocument(text, kind, {
    expand,
    diagrams,
    renderMermaid,
    fetchDiagram: requestDiagram,
    // Same re-check as `scripts`, for the same reason: the generated documents
    // link nowhere, so there is nothing in them to resolve.
    assets: { enabled: kind === 'html' && assets.enabled, hosts: assets.hosts },
    fetchAsset: requestAsset,
    onAssetReport: (result) => {
      const report: AssetReportMessage = {
        type: 'ASSET_REPORT',
        inlined: result.inlined,
        failed: result.failed,
        blockedHosts: result.blockedHosts,
      }
      window.parent.postMessage(report, '*')
    },
  })
    // Without this, a rejection leaves the host empty and the modal shows a
    // blank white pane with no hint of what went wrong — the failure mode is
    // indistinguishable from "the file rendered as nothing".
    .catch((error: unknown) => errorDocument(error))
    .then((html) => {
      host.replaceChildren(buildFrame(html, scripts))
    })
})

/** Shown in place of the document when building it threw outright. */
function errorDocument(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<style>body{margin:0;padding:32px 40px;background:#fff;color:#c5221f;',
    'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}',
    'pre{white-space:pre-wrap;color:#5f6368;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace}',
    '</style></head><body>',
    '<p>This file could not be rendered.</p>',
    `<pre>${escapeHtml(message)}</pre>`,
    '</body></html>',
  ].join('')
}

function buildFrame(html: string, allowScripts: boolean): HTMLIFrameElement {
  const frame = document.createElement('iframe')

  // Empty string means every restriction applies: no scripts, no forms, no
  // popups, no modals, and — critically — no same-origin access.
  frame.setAttribute('sandbox', allowScripts ? 'allow-scripts' : '')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.srcdoc = html

  return frame
}

const ready: SandboxReadyMessage = { type: 'SANDBOX_READY' }
// targetOrigin "*" is required: this page cannot name the parent's origin from
// an opaque origin, and the parent validates by window identity instead.
window.parent.postMessage(ready, '*')
