import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineRemoteAssets, type Asset } from './inline-assets.ts'

/**
 * Guards the string surgery that builds a file's linked resources into it.
 *
 * Two properties matter more than any individual rewrite:
 *
 *  - **Everything outside a replaced span survives byte for byte.** `html` is the
 *    one kind whose file *is* the document, and this is the only thing that ever
 *    touches it.
 *  - **A host that is not allowed is never fetched.** The allowlist is what keeps
 *    "the page cannot phone home" true after this feature exists, so the tests
 *    assert on the *fetcher never being called*, not merely on the output.
 */

const HOSTS = ['cdn.example.com', '*.fonts.example.com']

/** Builds a fetcher over a fixed URL -> body map, recording what was asked for. */
function fakeFetcher(files: Record<string, string | { body: string; contentType: string }>): {
  fetchAsset: (url: string) => Promise<Asset>
  asked: string[]
} {
  const asked: string[] = []

  return {
    asked,
    fetchAsset: async (url) => {
      asked.push(url)
      const entry = files[url]
      if (entry === undefined) throw new Error(`404 ${url}`)

      const body = typeof entry === 'string' ? entry : entry.body
      const contentType = typeof entry === 'string' ? 'text/css' : entry.contentType
      const base64 = Buffer.from(body, 'utf8').toString('base64')

      return { contentType, base64, byteLength: Buffer.byteLength(body, 'utf8') }
    },
  }
}

test('a linked stylesheet becomes an inline style block', async () => {
  const { fetchAsset } = fakeFetcher({ 'https://cdn.example.com/a.css': 'body{color:red}' })

  const result = await inlineRemoteAssets(
    '<head><link rel="stylesheet" href="https://cdn.example.com/a.css"></head><body>hi</body>',
    { hosts: HOSTS, fetchAsset },
  )

  assert.equal(result.html, '<head><style>body{color:red}</style></head><body>hi</body>')
  assert.equal(result.inlined, 1)
})

test('everything the scanner does not replace is left byte for byte', async () => {
  const { fetchAsset } = fakeFetcher({ 'https://cdn.example.com/a.css': 'i{}' })

  const source =
    '<!doctype html>\n<html Lang=en>\n  <p class=x data-y="a>b">kept &amp; unescaped</p>\n' +
    '  <link rel=stylesheet href=https://cdn.example.com/a.css>\n  <br/>\n</html>'

  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.equal(result.html, source.replace(/<link[^>]*>/, '<style>i{}</style>'))
})

test('a host that is not on the list is never fetched', async () => {
  const { fetchAsset, asked } = fakeFetcher({ 'https://evil.example.net/a.css': 'body{}' })

  const source = '<link rel="stylesheet" href="https://evil.example.net/a.css">'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.deepEqual(asked, [])
  assert.equal(result.html, source)
  assert.deepEqual(result.blockedHosts, ['evil.example.net'])
})

test('a wildcard entry matches subdomains but not an unrelated suffix', async () => {
  const { fetchAsset, asked } = fakeFetcher({ 'https://a.fonts.example.com/f.css': 'x{}' })

  await inlineRemoteAssets(
    '<link rel=stylesheet href="https://a.fonts.example.com/f.css">' +
      '<link rel=stylesheet href="https://notfonts.example.com/f.css">',
    { hosts: HOSTS, fetchAsset },
  )

  assert.deepEqual(asked, ['https://a.fonts.example.com/f.css'])
})

test('http is refused even when the host is allowed', async () => {
  const { fetchAsset, asked } = fakeFetcher({})

  const source = '<link rel=stylesheet href="http://cdn.example.com/a.css">'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.deepEqual(asked, [])
  assert.equal(result.html, source)
})

test('a linked script is inlined and cannot close its own tag', async () => {
  // The payload is the real hazard: a bundle holding the literal "</script>" would
  // otherwise end the element there and spill the rest into the page as markup.
  const { fetchAsset } = fakeFetcher({
    'https://cdn.example.com/lib.js': {
      body: 'var t = "</script><img src=x onerror=alert(1)>";',
      contentType: 'text/javascript',
    },
  })

  const result = await inlineRemoteAssets(
    '<script type="module" src="https://cdn.example.com/lib.js" defer></script>',
    { hosts: HOSTS, fetchAsset },
  )

  assert.equal(result.html.match(/<\/script>/g)?.length, 1)
  assert.ok(result.html.includes('<\\/script>'))
  // The src attribute is cut out; type and defer survive exactly as written.
  assert.ok(result.html.startsWith('<script type="module"  defer>'))
  assert.ok(result.html.endsWith('</script>'))
})

test('a script with a body of its own is left alone', async () => {
  const { fetchAsset, asked } = fakeFetcher({ 'https://cdn.example.com/a.css': 'x{}' })

  // The <link> inside is text, not an element, and must not be rewritten.
  const source =
    '<script>var s = \'<link rel="stylesheet" href="https://cdn.example.com/a.css">\';</script>'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.deepEqual(asked, [])
  assert.equal(result.html, source)
})

test('a commented-out link is left alone', async () => {
  const { fetchAsset, asked } = fakeFetcher({ 'https://cdn.example.com/a.css': 'x{}' })

  const source = '<!-- <link rel=stylesheet href="https://cdn.example.com/a.css"> -->'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.deepEqual(asked, [])
  assert.equal(result.html, source)
})

test('an image becomes a data URI and loses its srcset', async () => {
  const { fetchAsset } = fakeFetcher({
    'https://cdn.example.com/logo.png': { body: 'PNG', contentType: 'image/png' },
  })

  const result = await inlineRemoteAssets(
    '<img alt="a>b" src="https://cdn.example.com/logo.png" srcset="https://cdn.example.com/logo.png 2x">',
    { hosts: HOSTS, fetchAsset },
  )

  // A surviving srcset would win over src and the inlined image would never show.
  assert.equal(
    result.html,
    `<img alt="a>b" src="data:image/png;base64,${Buffer.from('PNG').toString('base64')}" srcset="">`,
  )
})

test('an unquoted src is re-quoted, because a data URI contains "="', async () => {
  const { fetchAsset } = fakeFetcher({
    'https://cdn.example.com/i.gif': { body: 'a', contentType: 'image/gif' },
  })

  const result = await inlineRemoteAssets('<img src=https://cdn.example.com/i.gif>', {
    hosts: HOSTS,
    fetchAsset,
  })

  assert.equal(result.html, '<img src="data:image/gif;base64,YQ==">')
})

test('url() and @import resolve against the stylesheet, not the document', async () => {
  const { fetchAsset } = fakeFetcher({
    'https://cdn.example.com/css/main.css': '@import "./base.css";\na{background:url(../img/b.png)}',
    'https://cdn.example.com/css/base.css': 'b{font-family:x}',
    'https://cdn.example.com/img/b.png': { body: 'IMG', contentType: 'image/png' },
  })

  const result = await inlineRemoteAssets(
    '<link rel=stylesheet href="https://cdn.example.com/css/main.css">',
    { hosts: HOSTS, fetchAsset },
  )

  assert.equal(
    result.html,
    `<style>b{font-family:x}\na{background:url("data:image/png;base64,${Buffer.from('IMG').toString('base64')}")}</style>`,
  )
})

test('a conditional @import keeps its condition', async () => {
  const { fetchAsset } = fakeFetcher({
    'https://cdn.example.com/p.css': 'a{}',
  })

  const result = await inlineRemoteAssets(
    '<style>@import url("https://cdn.example.com/p.css") print;</style>',
    { hosts: HOSTS, fetchAsset },
  )

  // Dropping "print" would apply a print-only sheet on screen.
  assert.equal(result.html, '<style>@media print{a{}}</style>')
})

test('a link keeps its media attribute when it becomes a style block', async () => {
  const { fetchAsset } = fakeFetcher({ 'https://cdn.example.com/s.css': 'a{}' })

  const result = await inlineRemoteAssets(
    '<link rel="stylesheet" media="screen and (min-width:40em)" href="https://cdn.example.com/s.css">',
    { hosts: HOSTS, fetchAsset },
  )

  assert.equal(result.html, '<style media="screen and (min-width:40em)">a{}</style>')
})

test('a resource that fails to download leaves the element as it was', async () => {
  const { fetchAsset } = fakeFetcher({})

  const source = '<link rel=stylesheet href="https://cdn.example.com/gone.css"><p>text</p>'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  // One missing stylesheet must not cost the reader the document.
  assert.equal(result.html, source)
  assert.equal(result.failed, 1)
})

test('a file with no absolute https reference is returned unchanged and unfetched', async () => {
  const { fetchAsset, asked } = fakeFetcher({})

  const source = '<link rel=stylesheet href="/local.css"><img src="pic.png">'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.equal(result.html, source)
  assert.deepEqual(asked, [])
})

test('the same URL is fetched once however often it is referenced', async () => {
  const { fetchAsset, asked } = fakeFetcher({
    'https://cdn.example.com/f.woff2': { body: 'F', contentType: 'font/woff2' },
  })

  await inlineRemoteAssets(
    '<style>@font-face{src:url(https://cdn.example.com/f.woff2)}' +
      '.b{background:url("https://cdn.example.com/f.woff2")}</style>',
    { hosts: HOSTS, fetchAsset },
  )

  assert.deepEqual(asked, ['https://cdn.example.com/f.woff2'])
})

test('a non-stylesheet link is ignored', async () => {
  const { fetchAsset, asked } = fakeFetcher({ 'https://cdn.example.com/i.png': 'x' })

  const source = '<link rel="icon" href="https://cdn.example.com/i.png">'
  const result = await inlineRemoteAssets(source, { hosts: HOSTS, fetchAsset })

  assert.deepEqual(asked, [])
  assert.equal(result.html, source)
})

test('an entity-encoded URL is decoded before fetching but not re-encoded', async () => {
  const { fetchAsset, asked } = fakeFetcher({
    'https://cdn.example.com/a.css?x=1&y=2': 'q{}',
  })

  const result = await inlineRemoteAssets(
    '<link rel=stylesheet href="https://cdn.example.com/a.css?x=1&amp;y=2">',
    { hosts: HOSTS, fetchAsset },
  )

  assert.deepEqual(asked, ['https://cdn.example.com/a.css?x=1&y=2'])
  assert.equal(result.html, '<style>q{}</style>')
})
