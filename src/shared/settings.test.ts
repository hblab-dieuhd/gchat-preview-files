import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  MAX_ALLOWED_BYTES,
  assetHostPatterns,
  isAssetUrlAllowed,
  isKindEnabled,
  normalise,
  normaliseHost,
  normaliseHosts,
  normaliseServer,
  serverOriginPattern,
} from './settings.ts'

/**
 * Storage is not a trusted schema — it survives upgrades, syncs from other
 * machines, and can be hand-edited. `normalise` is what stops a bad value there
 * from surfacing as a broken preview far from its cause.
 */

test('defaults reproduce the behaviour before settings existed', () => {
  assert.equal(DEFAULT_SETTINGS.allowScriptsByDefault, false, 'scripts off is the safe default')
  assert.equal(DEFAULT_SETTINGS.previewHtml, true)
  assert.equal(DEFAULT_SETTINGS.previewMarkdown, true)
  assert.equal(DEFAULT_SETTINGS.previewJson, true)
  assert.equal(DEFAULT_SETTINGS.previewMermaid, true)
  assert.equal(DEFAULT_SETTINGS.previewPlantUml, true)
  assert.equal(DEFAULT_SETTINGS.mermaidEnabled, true)
  assert.equal(DEFAULT_SETTINGS.plantUmlEnabled, true)
  assert.equal(DEFAULT_SETTINGS.jsonExpand, 'auto')
})

test('normalise fills gaps and rejects wrong types', () => {
  assert.deepEqual(normalise({}), DEFAULT_SETTINGS)
  assert.equal(normalise({ allowScriptsByDefault: 'yes' as never }).allowScriptsByDefault, false)
  assert.equal(normalise({ jsonExpand: 'sideways' as never }).jsonExpand, 'auto')
  assert.equal(normalise({ maxBytes: -1 }).maxBytes, DEFAULT_SETTINGS.maxBytes)
  assert.equal(normalise({ maxBytes: Number.NaN }).maxBytes, DEFAULT_SETTINGS.maxBytes)
})

test('normalise clamps the size limit rather than trusting it', () => {
  assert.equal(normalise({ maxBytes: 999 * 1024 * 1024 }).maxBytes, MAX_ALLOWED_BYTES)
})

test('a non-https diagram server is refused, not passed through', () => {
  // The source of every diagram travels in this URL; plaintext is not acceptable.
  assert.equal(normaliseServer('http://uml.internal/plantuml'), DEFAULT_SETTINGS.plantUmlServer)
  assert.equal(normaliseServer('javascript:alert(1)'), DEFAULT_SETTINGS.plantUmlServer)
  assert.equal(normaliseServer('not a url'), DEFAULT_SETTINGS.plantUmlServer)
  assert.equal(normaliseServer(''), DEFAULT_SETTINGS.plantUmlServer)
  assert.equal(normaliseServer(undefined), DEFAULT_SETTINGS.plantUmlServer)
})

test('server URLs are normalised so the diagram path appends cleanly', () => {
  assert.equal(normaliseServer('https://uml.internal/plantuml/'), 'https://uml.internal/plantuml')
  assert.equal(normaliseServer('  https://uml.internal/plantuml  '), 'https://uml.internal/plantuml')
  assert.equal(normaliseServer('https://uml.internal'), 'https://uml.internal')
})

test('permission patterns cover the origin only', () => {
  assert.equal(serverOriginPattern('https://uml.internal/plantuml'), 'https://uml.internal/*')
  assert.equal(serverOriginPattern('nonsense'), 'https://www.plantuml.com/*')
})

test('file types can be switched off individually', () => {
  const onlyJson = { ...DEFAULT_SETTINGS, previewHtml: false, previewMarkdown: false }
  assert.equal(isKindEnabled(onlyJson, 'json'), true)
  assert.equal(isKindEnabled(onlyJson, 'html'), false)
  assert.equal(isKindEnabled(onlyJson, 'markdown'), false)
})

test('diagram files have their own switch, separate from drawing them', () => {
  // The two are independent on purpose: "do not send my PlantUML to a server"
  // must not also mean "do not let me open the file".
  const noDrawing = { ...DEFAULT_SETTINGS, mermaidEnabled: false, plantUmlEnabled: false }
  assert.equal(isKindEnabled(noDrawing, 'mermaid'), true)
  assert.equal(isKindEnabled(noDrawing, 'plantuml'), true)

  const noPreview = { ...DEFAULT_SETTINGS, previewMermaid: false, previewPlantUml: false }
  assert.equal(isKindEnabled(noPreview, 'mermaid'), false)
  assert.equal(isKindEnabled(noPreview, 'plantuml'), false)
  assert.equal(isKindEnabled(noPreview, 'markdown'), true, 'markdown is unaffected')
})

test('normalise keeps the new file-type switches out of the defaults trap', () => {
  // A profile written before these existed has neither key; both must come back
  // on, not undefined-as-false.
  const legacy = normalise({ previewHtml: true, previewMarkdown: true, previewJson: true })
  assert.equal(legacy.previewMermaid, true)
  assert.equal(legacy.previewPlantUml, true)

  assert.equal(normalise({ previewMermaid: 'yes' }).previewMermaid, true, 'a bad value falls back')
  assert.equal(normalise({ previewPlantUml: false }).previewPlantUml, false, 'a real false survives')
})

/**
 * The asset allowlist is the only thing standing between "the extension fetches
 * what a file asks for" and "a file sent by anyone can make the extension reach
 * any host". These tests are about that boundary, not about tidiness.
 */

test('loading linked resources is off until asked for', () => {
  assert.equal(DEFAULT_SETTINGS.remoteAssets, false, 'no egress without a decision')
  // A default list is not a grant: with the switch off nothing on it is fetched,
  // and turning it on is what asks Chrome for the host permissions.
  assert.ok(DEFAULT_SETTINGS.remoteAssetHosts.includes('cdn.jsdelivr.net'))
  assert.ok(
    DEFAULT_SETTINGS.remoteAssetHosts.includes('fonts.gstatic.com'),
    'the Google Fonts stylesheet is useless without the host its url()s point at',
  )
})

test('a host entry is accepted as a bare name, a wildcard, or a pasted URL', () => {
  assert.equal(normaliseHost('CDN.Example.COM'), 'cdn.example.com')
  assert.equal(normaliseHost('*.example.com'), '*.example.com')
  assert.equal(normaliseHost('https://cdn.example.com/lib@3/x.css?v=1'), 'cdn.example.com')
  // Match patterns carry no port, so one that survived here would never match.
  assert.equal(normaliseHost('cdn.example.com:8443'), 'cdn.example.com')
})

test('anything that is not a host name is dropped rather than stored', () => {
  assert.equal(normaliseHost('*'), null, 'a bare wildcard is the thing the list exists to prevent')
  assert.equal(normaliseHost('*.com'), null, 'a whole TLD is not a host')
  assert.equal(normaliseHost('localhost'), null, 'no dot, no host')
  assert.equal(normaliseHost('a b.com'), null)
  assert.equal(normaliseHost(''), null)
  assert.equal(normaliseHost(42), null)
})

test('normaliseHosts drops bad entries and duplicates but keeps order', () => {
  assert.deepEqual(
    normaliseHosts(['b.com', 'nope', 'B.com', 'https://a.com/x', '']),
    ['b.com', 'a.com'],
  )
  // A profile written before this existed has no key at all; it gets the defaults
  // rather than an empty list, which would silently disable the feature.
  assert.deepEqual(normaliseHosts(undefined), DEFAULT_SETTINGS.remoteAssetHosts)
  assert.deepEqual(normalise({}).remoteAssetHosts, DEFAULT_SETTINGS.remoteAssetHosts)
  assert.deepEqual(normalise({ remoteAssetHosts: [] }).remoteAssetHosts, [])
})

test('only https on a listed host is allowed', () => {
  const hosts = ['cdn.example.com', '*.fonts.example.com']

  assert.equal(isAssetUrlAllowed('https://cdn.example.com/a.css', hosts), true)
  assert.equal(isAssetUrlAllowed('https://a.fonts.example.com/f.woff2', hosts), true)
  assert.equal(isAssetUrlAllowed('https://fonts.example.com/f.woff2', hosts), true)

  assert.equal(isAssetUrlAllowed('http://cdn.example.com/a.css', hosts), false, 'https only')
  assert.equal(isAssetUrlAllowed('https://evil.net/a.css', hosts), false)
  // The one that a naive endsWith would wave through.
  assert.equal(isAssetUrlAllowed('https://notfonts.example.com/x', hosts), false)
  assert.equal(isAssetUrlAllowed('https://cdn.example.com.evil.net/x', hosts), false)
  assert.equal(isAssetUrlAllowed('data:text/css,body{}', hosts), false)
  assert.equal(isAssetUrlAllowed('not a url', hosts), false)
  assert.equal(isAssetUrlAllowed('https://cdn.example.com/a.css', []), false, 'an empty list allows nothing')
})

test('asset permission patterns cover the origin only', () => {
  assert.deepEqual(assetHostPatterns(['cdn.example.com', '*.a.com']), [
    'https://cdn.example.com/*',
    'https://*.a.com/*',
  ])
})
