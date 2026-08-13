import type {
  FetchAssetResponse,
  FetchAttachmentResponse,
  FetchDiagramResponse,
  RuntimeRequest,
} from '../shared/protocol.ts'
import { fetchAttachmentText } from '../shared/fetch-attachment.ts'

/**
 * Fetches everything the other contexts cannot reach themselves.
 *
 * Two jobs, for the same underlying reason — this is the only context with
 * host_permissions, so it is the only one CORS does not apply to:
 *
 *  - Attachments, when the URL is cross-origin to the page or redirects
 *    cross-origin (see `src/content/index.ts`).
 *  - PlantUML diagrams, which are turned into `data:` URIs here so the sandbox
 *    CSP never has to allowlist a diagram server.
 *  - Stylesheets, fonts, images and scripts an HTML attachment links to, for the
 *    same reason: they come back as bytes and are built into the document, so the
 *    CSP keeps its `default-src 'none'` and the previewed page still reaches no
 *    host of its own.
 *
 * Which asset URLs are permitted is decided in the content script, which is the
 * context that can read settings. This one enforces only what does not depend on
 * settings: https, a size ceiling, and no credentials.
 *
 * Note it cannot set a `Referer` header — `fetch` forbids it — which is why the
 * content script is still tried for attachments.
 */

/** Diagrams are small; anything this big is not an SVG we want to inline. */
const MAX_DIAGRAM_BYTES = 2 * 1024 * 1024

/**
 * One asset. Generous enough for a full icon font or a bundled framework, small
 * enough that a single hostile URL cannot make the preview eat memory — the
 * document-wide budget in `inline-assets.ts` is the other half of that.
 */
const MAX_ASSET_BYTES = 4 * 1024 * 1024

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeRequest,
    _sender,
    sendResponse: (r: FetchAttachmentResponse | FetchDiagramResponse | FetchAssetResponse) => void,
  ) => {
    if (message?.type === 'FETCH_ATTACHMENT') {
      fetchAttachmentText(message.url, message.maxBytes)
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: describe(error) }))
      return true
    }

    if (message?.type === 'FETCH_DIAGRAM') {
      fetchDiagram(message.url)
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: describe(error) }))
      return true
    }

    if (message?.type === 'FETCH_ASSET') {
      fetchAsset(message.url)
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: describe(error) }))
      return true
    }

    return undefined
  },
)

/**
 * Fetches one linked resource for an HTML preview.
 *
 * `credentials: 'omit'` is not a detail: without it a CDN that happens to have a
 * cookie on this machine would receive it, on a request the user never made and a
 * page they only opened to read.
 */
async function fetchAsset(rawUrl: string): Promise<FetchAssetResponse> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Not a valid URL.' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https resources are fetched.' }
  }

  const response = await fetch(url.toString(), { credentials: 'omit', redirect: 'follow' })
  if (!response.ok) {
    return { ok: false, error: `${url.host} answered HTTP ${response.status}.` }
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, error: `${url.pathname} is larger than ${MAX_ASSET_BYTES} bytes.` }
  }

  return {
    ok: true,
    contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
    base64: toBase64(buffer),
    byteLength: buffer.byteLength,
  }
}

async function fetchDiagram(rawUrl: string): Promise<FetchDiagramResponse> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'The diagram server URL is not valid.' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The diagram server must use https.' }
  }

  // No credentials: a diagram server has no business receiving session cookies.
  const response = await fetch(url.toString(), { credentials: 'omit', redirect: 'follow' })
  if (!response.ok) {
    return { ok: false, error: `The diagram server answered HTTP ${response.status}.` }
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_DIAGRAM_BYTES) {
    return { ok: false, error: 'The rendered diagram is too large to display.' }
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!/^image\//i.test(contentType)) {
    // PlantUML answers with text/plain and a description when it cannot parse.
    return { ok: false, error: `The diagram server returned ${contentType || 'no content type'}.` }
  }

  return { ok: true, dataUri: `data:${contentType.split(';')[0]};base64,${toBase64(buffer)}` }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunked: spreading a multi-megabyte array into String.fromCharCode blows the
  // argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
