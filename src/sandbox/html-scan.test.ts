import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findingsFromFacts, hasLoginWording, looksObfuscated, type HtmlFacts } from './html-scan.ts'

/**
 * The DOM walk needs a real parser, so `scripts/verify-scan.mjs` checks it in the
 * test browser. What runs here is the policy built on its result.
 */

const NOTHING: HtmlFacts = {
  scripts: false,
  code: [],
  redirects: false,
  passwordField: false,
  textInput: false,
  loginButton: false,
  loginHeading: false,
  embedded: false,
  remote: false,
}

const findings = (facts: Partial<HtmlFacts>) => findingsFromFacts({ ...NOTHING, ...facts })

test('a file with nothing in it has no findings, which is what removes the bar', () => {
  assert.deepEqual(findings({}), [])
})

test('decoding and then running is obfuscation', () => {
  for (const code of [
    'eval(atob("YWxlcnQoMSk="))',
    'eval ( unescape("%61") )',
    'new Function(atob(x))()',
    'Function(decodeURIComponent(x))()',
    'document.write(unescape("%3Cscript"))',
    'eval(String.fromCharCode(97,108))',
    'eval(window.atob(x))',
    "eval(function(p,a,c,k,e,d){return p}('0',1,1,''.split('|')))",
    `String.fromCharCode(${Array(30).fill(97).join(',')})`,
    `var s = "${'\\x61'.repeat(30)}"`,
    'var _0x1a2b=1,_0x3c4d=2,_0x5e6f=3,_0x7a8b=4,_0x9c0d=5',
    `var blob = "${'QUJD'.repeat(600)}"; run(atob(blob))`,
  ]) {
    assert.equal(looksObfuscated(code), true, code)
  }
})

test('using a decoder for an ordinary purpose is not', () => {
  for (const code of [
    'const bytes = atob(payload)',
    'eval("1 + 1")',
    'String.fromCharCode(c + 32)',
    `var title = "${'\\u30d1'.repeat(40)}"`,
    `var image = "data:image/png;base64,${'QUJD'.repeat(600)}"; atob(image)`,
    `var key = "${'QUJD'.repeat(600)}"`,
  ]) {
    assert.equal(looksObfuscated(code), false, code)
  }
})

test('real minified libraries do not trip it, because a banner that cries wolf gets ignored', () => {
  for (const file of [
    'node_modules/mermaid/dist/mermaid.min.js',
    'node_modules/marked/lib/marked.umd.js',
    'node_modules/highlight.js/lib/core.js',
  ]) {
    assert.equal(looksObfuscated(readFileSync(file, 'utf8')), false, file)
  }
})

test('the scan keeps up with a bundle the size of the largest one shipped', () => {
  const bundle = readFileSync('node_modules/mermaid/dist/mermaid.min.js', 'utf8')
  const started = performance.now()
  looksObfuscated(bundle)
  assert.ok(performance.now() - started < 1000)
})

test('a run just under the encoded-blob threshold costs no quadratic scan', () => {
  const hostile = `${'A'.repeat(1999)} `.repeat(5000)
  const started = performance.now()
  assert.equal(looksObfuscated(hostile + 'atob'), false)
  assert.ok(performance.now() - started < 1000)
})

test('sign-in wording is recognised in the languages people here read', () => {
  for (const text of ['Sign in', 'sign-in', 'LOGIN', 'Log in', 'Password', 'Mật khẩu', 'Đăng nhập', 'パスワード', 'ログイン']) {
    assert.equal(hasLoginWording(text), true, text)
  }
  for (const text of ['Design', 'blogging', 'Assign in order', 'Quarterly report']) {
    assert.equal(hasLoginWording(text), false, text)
  }
})

test('a heading about logging in is only a sign-in page once there is somewhere to type', () => {
  assert.deepEqual(findings({ loginHeading: true }), [])
  assert.ok(findings({ loginHeading: true, textInput: true }).includes('login'))
  assert.ok(findings({ loginButton: true }).includes('login'))
})

test('a password field says so once rather than three ways', () => {
  assert.deepEqual(
    findings({ passwordField: true, textInput: true, loginButton: true }),
    ['password'],
  )
})

test('obfuscation found in any one piece of code is reported', () => {
  assert.deepEqual(findings({ scripts: true, code: ['var a = 1', 'eval(atob(x))'] }), [
    'obfuscated',
    'scripts',
  ])
})
