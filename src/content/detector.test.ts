import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeAttachment } from './detector.ts'
import { describeCandidate, downloadUrlCandidates, toDownloadUrl } from '../shared/attachment-url.ts'

/**
 * Guards the URL rewriting, which is the only part of detection that can be
 * verified without a live Google Workspace account.
 *
 * REAL_THUMBNAIL is a verbatim capture from Google Chat. Do not "tidy" it: the
 * point of these tests is that the opaque `attachment_token` survives byte for
 * byte, and any re-encoding of it makes Chat reject the download.
 */

const TOKEN =
  'AOo0EEV5ETeYQ9%2FWb8woLb5QjnTl3uMsMf9brZU9HvVKRVtN3L6jiPNSAiYu0Jbq9JhvHlMIeUzbPdA0VLYVlZdlP6bKDkswdGu%2B4ieEleV4PqPzTYg1LOq7YSv0YsDgI6ztWMSNmaZNZ1bGfXSJBAIsT0G47TqgynqY6%2BJ8v%2FYqa732rY8B0mGKow0Qzh%2BmAFaCUeQJJeMdefDDN%2BiZYKw6WNAQvBdmb3SfwnIL7sjNBcwkqFCrZFiisLLT%2FMgtbQhVuTZmeQfFiMuCYBE5A2gQx673hjNrL%2BKT0v%2BOHxCuDa1EKPz%2BBRk9PZgNJy2uq3w0TLt3AC4plY6ukiE4YYKzCmcwGQPdn8ze%2FPWY3Lg%2FoR3%2B6r%2BwrDpx83zmazvskZ6qCy29n40EqEV8y3SyRSoLuvPZ8Z%2BNUa0LOoN%2Fy80ysLAzh8lJ3nRvCG8%2F3hZVH6LBuNT%2BgmP8%2FmOL3HaAUJzevvxK%2BcV5QSHFqSG6PhbG6LPpNEDi6RGV9RZDFpGuqnRZZ%2FYxiXFnGSm8oNoDJ9V1kcniyILdDau%2BNLBRXb%2FfIvqWcZRBzbP%2Fo31mpj0YCWodELfN7H%2BXNDBKi98hYJpvPCNmPVjmRsrXMofY%2BWfE%2B1KXuswpC9xxWACMa0QZqVH0NV6%2FQeb2YiE%2FdlF7kQgNOs9xPZJsTj43DDdRvootNGyV'

const REAL_THUMBNAIL =
  'https://chat.google.com/api/get_attachment_url' +
  '?url_type=THUMBNAIL_URL' +
  '&content_type=text%2Fhtml' +
  `&attachment_token=${TOKEN}` +
  '&allow_caching=true' +
  '&sz=w512'

test('detects a real Chat HTML thumbnail and names it from alt', () => {
  const attachment = describeAttachment(REAL_THUMBNAIL, ['hblab-slide-profile.html', ''])
  assert.equal(attachment?.fileName, 'hblab-slide-profile.html')
})

test('rewrites the thumbnail URL into a download URL', () => {
  const url = describeAttachment(REAL_THUMBNAIL, ['hblab-slide-profile.html'])!.downloadUrl

  assert.match(url, /[?&]url_type=DOWNLOAD_URL(&|$)/)
  assert.doesNotMatch(url, /THUMBNAIL_URL/)
  assert.doesNotMatch(url, /[?&]sz=/, 'thumbnail sizing must not survive')
  assert.doesNotMatch(url, /[?&]{2}|[?&]$/, 'no dangling separators')
  assert.ok(url.includes(`attachment_token=${TOKEN}`), 'token must survive byte for byte')
  assert.ok(url.includes('content_type=text%2Fhtml'), 'content_type identifies the file')
  assert.doesNotMatch(url, /allow_caching/, 'thumbnail caching hint is a suspected cause of HTTP 400')
})

test('detects markdown and json attachments, and reports how to render them', () => {
  const endpoint = (contentType: string) =>
    `https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=${contentType}&attachment_token=X`

  // The extension decides the kind, because Chat reports .md as text/plain.
  assert.equal(describeAttachment(endpoint('text%2Fplain'), ['notes.md'])?.kind, 'markdown')
  assert.equal(describeAttachment(endpoint('application%2Foctet-stream'), ['data.json'])?.kind, 'json')
  assert.equal(describeAttachment(endpoint('text%2Fhtml'), ['page.html'])?.kind, 'html')

  // Content type is the fallback when the name carries no usable extension.
  assert.equal(describeAttachment(endpoint('text%2Fmarkdown'), ['README'])?.kind, 'markdown')
  assert.equal(describeAttachment(endpoint('application%2Fjson'), ['export'])?.kind, 'json')
  assert.equal(describeAttachment(endpoint('application%2Fld%2Bjson'), ['export'])?.kind, 'json')
})

test('detects standalone diagram files by extension alone', () => {
  // Chat serves every one of these as text/plain, so there is no MIME fallback
  // to lean on — if the extension table misses one, the file is not detected.
  const endpoint =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=text%2Fplain&attachment_token=X'

  for (const name of ['flow.mmd', 'flow.mermaid']) {
    assert.equal(describeAttachment(endpoint, [name])?.kind, 'mermaid', name)
  }

  for (const name of ['seq.puml', 'seq.plantuml', 'seq.pu', 'seq.iuml', 'seq.wsd']) {
    assert.equal(describeAttachment(endpoint, [name])?.kind, 'plantuml', name)
  }
})

test('detects the detailed-thread card, which labels only its ancestors', () => {
  // Taken verbatim from live Chat. This card has no <img> at all — the thumbnail
  // is a <span> with a background-image — and the download <a> carries only an
  // "Open in new tab" button. Everything the <a> itself exposes is useless, and
  // the endpoint URL has no content_type to fall back on, so the file name has
  // to come from the ancestor div[role="button"] or the card is never detected.
  const href =
    'https://chat.google.com/api/get_attachment_url?url_type=DOWNLOAD_URL&attachment_token=AOo0EEUvYB6dkWpkxoGjwIjg&auto=true'

  const ownLabels = [null, null, '', 'Open in new tab']
  assert.equal(describeAttachment(href, ownLabels), null, 'the link alone gives nothing')

  const ancestorTitle = 'GetStoreProductSalesScorecardWeekly(2).puml'
  const withAncestors = describeAttachment(href, [
    ...ownLabels,
    ancestorTitle,
    `, ${ancestorTitle}.`,
  ])

  assert.equal(withAncestors?.kind, 'plantuml')
  assert.equal(withAncestors?.fileName, ancestorTitle)
})

test('a file name survives the punctuation Chat wraps it in', () => {
  // Chat's aria-label is `", <name>."`. The trailing period used to make the
  // whole label unmatchable, so the attachment went undetected.
  const endpoint =
    'https://chat.google.com/api/get_attachment_url?url_type=DOWNLOAD_URL&attachment_token=X'

  assert.equal(describeAttachment(endpoint, [', report.puml.'])?.fileName, 'report.puml')
  assert.equal(describeAttachment(endpoint, ['notes.md (12 KB)'])?.fileName, 'notes.md')
  assert.equal(describeAttachment(endpoint, ['Attachment: data.json, 4 KB'])?.fileName, 'data.json')
})

test('loosening the extension boundary does not swallow neighbours', () => {
  // The boundary allows trailing punctuation but not another word character,
  // which is what keeps these out.
  const endpoint =
    'https://chat.google.com/api/get_attachment_url?url_type=DOWNLOAD_URL&attachment_token=X'

  assert.equal(describeAttachment(endpoint, ['archive.json.gz']), null)
  assert.equal(describeAttachment(endpoint, ['page.htmlx']), null)
  assert.equal(describeAttachment(endpoint, ['backup.puml.bak']), null)
})

test('.mmd is not mistaken for .md', () => {
  // The markdown pattern is checked first and `.mmd` is one character away from
  // matching it; a diagram file rendered as Markdown would show as raw text.
  const endpoint =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=text%2Fplain&attachment_token=X'

  assert.equal(describeAttachment(endpoint, ['a.mmd'])?.kind, 'mermaid')
  assert.equal(describeAttachment(endpoint, ['a.md'])?.kind, 'markdown')
})

test('ignores plain text, which Google Chat already previews itself', () => {
  const endpoint =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=text%2Fplain&attachment_token=X'

  assert.equal(describeAttachment(endpoint, ['notes.txt']), null)
  assert.equal(describeAttachment(endpoint, ['server.log']), null)
  assert.equal(describeAttachment(endpoint, ['dump']), null)
})

test('names unnamed attachments after their kind', () => {
  const url =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=text%2Fmarkdown&attachment_token=X'
  assert.equal(describeAttachment(url, [null])?.fileName, 'attachment.md')
})

test('ignores attachments that are not previewable', () => {
  const png =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=image%2Fpng&attachment_token=X&sz=w512'
  assert.equal(describeAttachment(png, ['screenshot.png']), null)
  assert.equal(describeAttachment('https://ssl.gstatic.com/docs/icon.png', ['icon']), null)

  const pdf =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=application%2Fpdf&attachment_token=X'
  assert.equal(describeAttachment(pdf, ['report.pdf']), null)
})

test('accepts HTML uploaded as octet-stream, where the name is the only signal', () => {
  const octet =
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&content_type=application%2Foctet-stream&attachment_token=X'
  assert.equal(describeAttachment(octet, ['report.html'])?.fileName, 'report.html')
})

test('falls back to plain links, taking the name from the URL', () => {
  const attachment = describeAttachment('https://example.com/files/report.html', [null])
  assert.equal(attachment?.fileName, 'report.html')
  assert.equal(attachment?.downloadUrl, 'https://example.com/files/report.html')
  assert.equal(attachment?.kind, 'html')

  assert.equal(describeAttachment('https://example.com/notes.md', [null])?.kind, 'markdown')
  assert.equal(describeAttachment('https://example.com/data.json', [null])?.kind, 'json')
})

test('offers fallback candidates, all preserving the token', () => {
  const candidates = downloadUrlCandidates(REAL_THUMBNAIL)

  assert.equal(candidates[0], toDownloadUrl(REAL_THUMBNAIL), 'preferred URL comes first')
  assert.ok(candidates.length > 1, 'a single guess is not enough — Chat 400s on the wrong shape')
  assert.equal(new Set(candidates).size, candidates.length, 'no duplicate attempts')

  for (const candidate of candidates) {
    assert.ok(candidate.includes(`attachment_token=${TOKEN}`), 'token must survive every rewrite')
    assert.doesNotMatch(candidate, /THUMBNAIL_URL|[?&]sz=/, 'thumbnail-only params must be gone')
    assert.doesNotMatch(candidate, /[?&]{2}|[?&]$/, 'no dangling separators')
  }
})

test('recognises the endpoint wherever Chat serves it from', () => {
  // Regression: pinning host+path to chat.google.com/api/ meant these were never
  // rewritten, so the thumbnail URL was fetched as-is and Chat returned 400.
  const surfaces = [
    'https://chat.google.com/api/get_attachment_url?url_type=THUMBNAIL_URL&attachment_token=X',
    'https://chat.google.com/u/0/api/get_attachment_url?url_type=THUMBNAIL_URL&attachment_token=X',
    'https://mail.google.com/chat/api/get_attachment_url?url_type=THUMBNAIL_URL&attachment_token=X',
    'https://mail.google.com/chat/u/0/api/get_attachment_url?url_type=THUMBNAIL_URL&attachment_token=X',
  ]

  for (const url of surfaces) {
    const candidates = downloadUrlCandidates(url)
    assert.ok(candidates.length > 1, `${url} was not recognised as an attachment endpoint`)
    assert.doesNotMatch(candidates[0]!, /THUMBNAIL_URL/, `${url} was left unrewritten`)
  }
})

test('candidate labels identify the endpoint without leaking the token', () => {
  const label = describeCandidate(
    'https://mail.google.com/chat/api/get_attachment_url?url_type=DOWNLOAD_URL&attachment_token=SECRET',
  )
  assert.equal(label, 'DOWNLOAD_URL @ mail.google.com/chat/api/get_attachment_url')
  assert.doesNotMatch(label, /SECRET/)
})

test('leaves non-Chat URLs alone', () => {
  assert.deepEqual(downloadUrlCandidates('https://example.com/report.html'), [
    'https://example.com/report.html',
  ])
})

test('handles url_type being absent or first in the query', () => {
  assert.equal(
    toDownloadUrl('https://chat.google.com/api/get_attachment_url?attachment_token=X'),
    'https://chat.google.com/api/get_attachment_url?attachment_token=X&url_type=DOWNLOAD_URL',
  )
  assert.equal(toDownloadUrl('https://x.test/a?sz=w512&url_type=THUMBNAIL_URL'), 'https://x.test/a?url_type=DOWNLOAD_URL')
})
