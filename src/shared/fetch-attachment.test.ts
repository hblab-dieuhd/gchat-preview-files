import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAttachmentText } from './fetch-attachment.ts'
import { driveDownloadUrl } from './attachment-url.ts'

/**
 * Guards what may be treated as a file's bytes. An `html` preview renders whatever
 * comes back as a document, so a Google error page accepted here would be shown to
 * the reader as the contents of the file.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function respondWith(body: string, headers: Record<string, string>, status = 200): void {
  globalThis.fetch = (async () => new Response(body, { status, headers })) as typeof fetch
}

const DRIVE_URL = driveDownloadUrl('abc', null)

test('accepts Drive bytes served as a download, as captured from live Drive', async () => {
  respondWith('<!DOCTYPE html><p>real', {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="a.html"',
  })
  const result = await fetchAttachmentText(DRIVE_URL)
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.text, '<!DOCTYPE html><p>real')
})

test('refuses a Drive page served in place of the file', async () => {
  respondWith('<html>Sign in</html>', { 'content-type': 'text/html; charset=utf-8' })
  const result = await fetchAttachmentText(DRIVE_URL)
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /sign-in|permission/i)
  assert.doesNotMatch(!result.ok ? result.error : '', /id=abc/, 'the query string is never reported')
})

test('reports a Drive refusal with its status', async () => {
  respondWith('<html>Not found</html>', { 'content-type': 'text/html' }, 404)
  const result = await fetchAttachmentText(DRIVE_URL)
  assert.match(!result.ok ? result.error : '', /HTTP 404/)
})

test('does not apply the Drive rule to Chat, which sends no such header', async () => {
  respondWith('<p>chat', { 'content-type': 'text/html' })
  const result = await fetchAttachmentText(
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&attachment_token=X',
  )
  assert.equal(result.ok, true)
})
