import { MAX_ATTACHMENT_BYTES, type FetchAttachmentResponse } from './protocol.ts'
import { describeCandidate, downloadUrlCandidates } from './attachment-url.ts'

/**
 * Downloads an attachment's bytes, trying each candidate URL until one works.
 *
 * Shared by the content script and the service worker because the right fetcher
 * depends on where the URL points — see `src/content/index.ts`. Every failed
 * attempt is recorded and reported, since the failure mode that matters here
 * (Chat rejecting a URL shape with HTTP 400) is invisible otherwise.
 */
export async function fetchAttachmentText(
  rawUrl: string,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): Promise<FetchAttachmentResponse> {
  if (!isHttps(rawUrl)) {
    return { ok: false, error: 'Only https attachment URLs can be previewed.' }
  }

  const attempts: string[] = []

  for (const candidate of downloadUrlCandidates(rawUrl)) {
    const label = describeCandidate(candidate)

    try {
      const response = await fetch(candidate, { credentials: 'include', redirect: 'follow' })

      if (!response.ok) {
        // Where a redirect landed matters: these URLs bounce to Google's
        // file-serving hosts, and a host missing from host_permissions fails
        // here rather than at the endpoint.
        attempts.push(`${label}: HTTP ${response.status}${redirectNote(candidate, response)}`)
        continue
      }

      const contentType = response.headers.get('content-type') ?? 'text/html'
      if (/^image\//i.test(contentType)) {
        // A thumbnail came back rather than the file itself; wrong url_type.
        attempts.push(`${label}: got ${contentType}`)
        continue
      }

      // Trust Content-Length when present so oversized files are rejected before
      // being buffered. A size failure is definitive — do not try other URLs.
      const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return { ok: false, error: sizeError(declaredLength, maxBytes) }
      }

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > maxBytes) {
        return { ok: false, error: sizeError(buffer.byteLength, maxBytes) }
      }

      return {
        ok: true,
        text: new TextDecoder(charsetOf(contentType)).decode(buffer),
        contentType,
        byteLength: buffer.byteLength,
      }
    } catch (error) {
      attempts.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    ok: false,
    error: `Could not download the attachment. Tried — ${attempts.join('; ')}.`,
  }
}

/** " (redirected to host)" when the response came from somewhere else. */
function redirectNote(requestUrl: string, response: Response): string {
  try {
    const from = new URL(requestUrl).host
    const to = new URL(response.url).host
    return response.redirected && to !== from ? ` (redirected to ${to})` : ''
  } catch {
    return ''
  }
}

function isHttps(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === 'https:'
  } catch {
    return false
  }
}

/** Falls back to utf-8 for charsets TextDecoder does not recognise. */
function charsetOf(contentType: string): string {
  const match = /charset=([^;]+)/i.exec(contentType)
  const charset = match?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!charset) return 'utf-8'
  try {
    new TextDecoder(charset)
    return charset
  } catch {
    return 'utf-8'
  }
}

function sizeError(byteLength: number, maxBytes: number): string {
  const mb = (byteLength / (1024 * 1024)).toFixed(1)
  const limit = Math.round(maxBytes / (1024 * 1024))
  return `File is too large to preview (${mb} MB, limit ${limit} MB).`
}
