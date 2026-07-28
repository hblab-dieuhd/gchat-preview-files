/**
 * Turns a Google Chat thumbnail URL into candidate URLs that serve the real bytes.
 *
 * `https://chat.google.com/api/get_attachment_url` serves both the thumbnail and
 * the file, selected by `url_type`. The exact parameter combination Chat accepts
 * is undocumented and has been observed to reject plausible-looking variants with
 * HTTP 400, so this returns an ordered list of candidates to try rather than a
 * single guess. Callers stop at the first one that returns usable bytes.
 *
 * All rewriting is string surgery, never `URLSearchParams`: round-tripping
 * through the URL parser re-encodes the opaque `attachment_token` and Chat
 * rejects the result.
 */

/**
 * Deliberately host- and path-agnostic across google.com.
 *
 * Chat serves this endpoint from more than one place — `chat.google.com/api/…`
 * standalone, but `mail.google.com/chat/api/…` when embedded in Gmail. Pinning
 * the host meant the URL was never recognised there, so it was fetched
 * unrewritten as a thumbnail and Chat answered HTTP 400.
 */
const ATTACHMENT_ENDPOINT = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.google\.com\/[^?#]*get_attachment_url/i

/** `url_type` values that plausibly serve bytes, in order of likelihood. */
const DOWNLOAD_URL_TYPES = ['DOWNLOAD_URL', 'FIFE_URL', 'MEDIA_URL'] as const

export function isAttachmentEndpoint(rawUrl: string): boolean {
  return ATTACHMENT_ENDPOINT.test(rawUrl)
}

/**
 * The preferred download URL. Kept as a named export because it is the one the
 * detector reports and the tests pin.
 */
export function toDownloadUrl(rawUrl: string): string {
  return setParam(dropParam(dropParam(rawUrl, 'sz'), 'allow_caching'), 'url_type', 'DOWNLOAD_URL')
}

/**
 * Every URL worth trying, most likely first. Varies the two things known to
 * cause 400s: the `url_type` value, and whether the thumbnail-only `sz` and
 * `allow_caching` params are carried over.
 */
export function downloadUrlCandidates(rawUrl: string): string[] {
  if (!isAttachmentEndpoint(rawUrl)) return [rawUrl]

  const stripped = dropParam(dropParam(rawUrl, 'sz'), 'allow_caching')
  const keepsCaching = dropParam(rawUrl, 'sz')

  const candidates = [
    ...DOWNLOAD_URL_TYPES.map((type) => setParam(stripped, 'url_type', type)),
    // Same types again, but preserving allow_caching in case it is required.
    ...DOWNLOAD_URL_TYPES.map((type) => setParam(keepsCaching, 'url_type', type)),
  ]

  return [...new Set(candidates)]
}

/**
 * Short label for error reporting, e.g. "DOWNLOAD_URL @ chat.google.com/api/…".
 *
 * Includes host and path because a wrong *endpoint* and a wrong *url_type* both
 * surface as HTTP 400, and the two are otherwise indistinguishable from the
 * message alone. Never includes the query string — that holds the
 * session-bearing `attachment_token`.
 */
export function describeCandidate(rawUrl: string): string {
  const urlType = /[?&]url_type=([^&]*)/i.exec(rawUrl)?.[1] ?? 'no url_type'
  try {
    const { host, pathname } = new URL(rawUrl)
    return `${urlType} @ ${host}${pathname}`
  } catch {
    return urlType
  }
}

function setParam(rawUrl: string, name: string, value: string): string {
  const pattern = new RegExp(`([?&])${name}=[^&]*`, 'i')
  if (pattern.test(rawUrl)) {
    return rawUrl.replace(pattern, `$1${name}=${value}`)
  }
  return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}${name}=${value}`
}

function dropParam(rawUrl: string, name: string): string {
  return rawUrl
    .replace(new RegExp(`([?&])${name}=[^&]*`, 'i'), '$1')
    .replace(/&&+/g, '&')
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '')
}
