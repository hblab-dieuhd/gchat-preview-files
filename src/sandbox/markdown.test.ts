import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plantUmlUrl } from './markdown.ts'

const SERVER = 'https://www.plantuml.com/plantuml'

/**
 * The encoding is what decides whether a real `.puml` file renders at all.
 *
 * The `~h` hex form used to be the only one. It needs no compressor and no
 * async encode, which is why it was chosen — but it doubles the source, and the
 * server answers HTTP 400 somewhere past an 8 KB URL. Measured against the live
 * server: a 4021-byte source became an 8082-character URL that 400s, versus a
 * 762-character deflate URL that renders. That put every `.puml` file over
 * roughly 3.5 KB out of reach, which is most real diagrams.
 */

/** Reverses the encoding, so a round-trip proves the bytes are actually right. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

async function decodePlantUml(encoded: string): Promise<string> {
  const bits: number[] = []
  for (const char of encoded) bits.push(ALPHABET.indexOf(char))

  const bytes: number[] = []
  for (let i = 0; i < bits.length; i += 4) {
    const [c1 = 0, c2 = 0, c3 = 0, c4 = 0] = bits.slice(i, i + 4)
    bytes.push(((c1 << 2) | (c2 >> 4)) & 0xff)
    bytes.push(((c2 << 4) | (c3 >> 2)) & 0xff)
    bytes.push(((c3 << 6) | c4) & 0xff)
  }

  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  void writer.write(new Uint8Array(bytes))
  void writer.close()
  return new Response(stream.readable).text()
}

test('the encoded source survives a round trip', async () => {
  const source = '@startuml\nAlice -> Bob: hé\nnote right: 100%\n@enduml'
  const url = await plantUmlUrl(SERVER, source)

  assert.ok(url.startsWith('https://www.plantuml.com/plantuml/svg/'))
  assert.doesNotMatch(url, /~h/, 'compression should be used, not the hex fallback')

  const decoded = await decodePlantUml(url.slice(url.lastIndexOf('/') + 1))
  // Deflate output is byte-padded, so the tail can carry extra NULs.
  assert.equal(decoded.replace(/\0+$/, ''), source)
})

test('the encoded URL stays inside the server’s length limit', async () => {
  // 4 KB is where hex used to start failing. Anything near that size is the
  // whole reason this encoding changed.
  let body = ''
  for (let i = 0; body.length < 4000; i += 1) body += `participant Participant${i}\n`
  const url = await plantUmlUrl(SERVER, `@startuml\n${body}@enduml`)

  assert.ok(url.length < 2000, `expected a short URL, got ${url.length} characters`)
})

test('the URL uses only characters that need no escaping', async () => {
  const url = await plantUmlUrl(SERVER, '@startuml\nA -> B: "x" & <y>\n@enduml')
  const encoded = url.slice(url.lastIndexOf('/') + 1)

  // PlantUML's alphabet is deliberately URL-safe; anything outside it would have
  // to be percent-encoded and the server would decode something else.
  assert.match(encoded, /^[0-9A-Za-z_-]+$/)
})

test('a trailing slash on the configured server does not double up', async () => {
  const url = await plantUmlUrl('https://uml.internal/plantuml/', '@startuml\n@enduml')
  assert.ok(url.startsWith('https://uml.internal/plantuml/svg/'))
  assert.doesNotMatch(url, /plantuml\/\/svg/)
})

test('hex is the fallback when the browser has no CompressionStream', async () => {
  // Kept working rather than deleted: without it, a browser missing the API
  // loses PlantUML entirely instead of losing only large files.
  const original = globalThis.CompressionStream
  // @ts-expect-error — deleting a global to simulate an older browser.
  delete globalThis.CompressionStream

  try {
    assert.equal(await plantUmlUrl(SERVER, 'AB'), `${SERVER}/svg/~h4142`)
    // Newlines must not be dropped, and multi-byte characters must expand.
    assert.match(await plantUmlUrl(SERVER, 'A\nB'), /~h410a42$/)
    assert.match(await plantUmlUrl(SERVER, 'é'), /~hc3a9$/)
  } finally {
    globalThis.CompressionStream = original
  }
})
