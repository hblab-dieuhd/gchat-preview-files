import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highlight, isHighlightable, HIGHLIGHT_STYLES } from './highlight.ts'

/**
 * The load-bearing assertion here is the escaping one.
 *
 * `highlight()` output is inserted into the generated document *unescaped* —
 * that is the whole point, it is markup. So the guarantee that hljs escapes the
 * source as it tokenises is not an implementation detail of a dependency, it is
 * the thing standing between a `.md` file containing a script tag inside a code
 * fence and that tag being live in the document. If a hljs upgrade ever breaks
 * it, this file is what says so.
 */

const XSS = '<script>alert("x" & \'y\')</script>'

test('a known language produces spans, not plain text', () => {
  const html = highlight('const x = 1', 'javascript')

  assert.ok(html, 'javascript is registered')
  assert.match(html, /<span class="hljs-keyword">const<\/span>/)
  assert.match(html, /<span class="hljs-number">1<\/span>/)
})

test('source is escaped even while being coloured', () => {
  // Tagged as html so hljs parses it as markup rather than as opaque text —
  // the case where a naive highlighter would hand back live tags.
  const html = highlight(XSS, 'html')

  assert.ok(html)
  assert.doesNotMatch(html, /<script/i, 'no live script tag survives')
  assert.doesNotMatch(html, /<\/script/i)
  // hljs wraps the tag name in its own span, so the escaped brackets are not
  // adjacent to it: the output is `&lt;<span class="hljs-name">script</span>&gt;`.
  assert.match(html, /&lt;<span class="hljs-name">script<\/span>&gt;/)
  assert.match(html, /&amp;/, 'a bare ampersand is escaped too')
  assert.match(html, /&quot;x&quot;/, 'quotes are escaped as well')
})

test('every registered language escapes markup in its source', () => {
  // The escaping lives in hljs core, but grammars differ in how much of the
  // source they emit through their own rules, so each is checked.
  for (const lang of ['javascript', 'python', 'sql', 'yaml', 'markdown', 'diff', 'bash']) {
    const html = highlight(XSS, lang)
    assert.ok(html, `${lang} is registered`)
    assert.doesNotMatch(html, /<script/i, `${lang} let a script tag through`)
  }
})

test('aliases reach their language', () => {
  // hljs resolves these itself, which is why the registered list can be short.
  for (const alias of ['js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'zsh', 'yml', 'md', 'html', 'toml']) {
    assert.ok(isHighlightable(alias), `${alias} should resolve to a registered language`)
  }
})

test('an unknown or missing language is null, not an error', () => {
  // Null is the signal to fall back to a plain escaped code block. A fence
  // tagged with prose, a filename, or nothing at all must land here.
  assert.equal(highlight('x', ''), null)
  assert.equal(highlight('x', '   '), null)
  assert.equal(highlight('x', 'brainfuck'), null)
  assert.equal(highlight('x', 'Dockerfile.prod'), null)
  assert.equal(isHighlightable('brainfuck'), false)
})

test('language tags are matched case-insensitively', () => {
  assert.ok(isHighlightable('JavaScript'))
  assert.ok(isHighlightable('SQL'))
  assert.match(highlight('SELECT 1', 'SQL') ?? '', /hljs-keyword/)
})

test('a fragment that breaks the grammar still gets colour', () => {
  // Snippets in chat are usually fragments, not whole valid files. Without
  // ignoreIllegals hljs would throw here and the block would lose its colour.
  const html = highlight('} else {\n  return 1\n}', 'java')

  assert.ok(html)
  assert.match(html, /hljs-keyword/)
})

test('the theme only styles hljs classes', () => {
  // The stylesheet is concatenated into the document's <style> alongside rules
  // for pre/code/table. A selector here that is not hljs-scoped would silently
  // restyle the rest of the document.
  const selectors = HIGHLIGHT_STYLES.match(/\.[a-z][\w.-]*/gi) ?? []

  assert.ok(selectors.length > 0)
  for (const selector of selectors) {
    assert.match(selector, /^\.hljs-/, `${selector} escapes the hljs namespace`)
  }
})
