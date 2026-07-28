import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  MAX_ALLOWED_BYTES,
  isKindEnabled,
  normalise,
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
