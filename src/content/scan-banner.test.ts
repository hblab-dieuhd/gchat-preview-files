import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bannerFor } from './scan-banner.ts'
import type { HtmlFinding } from '../shared/protocol.ts'

const ALL: HtmlFinding[] = [
  'obfuscated',
  'redirect',
  'password',
  'login',
  'embedded',
  'unchecked',
  'scripts',
  'inputs',
  'remote',
]

test('nothing found means no bar at all', () => {
  assert.equal(bannerFor([], false), null)
})

test('the most serious finding sets the level, whatever order they arrive in', () => {
  assert.equal(bannerFor(['remote', 'scripts'], false)?.level, 'notice')
  assert.equal(bannerFor(['scripts', 'password'], false)?.level, 'caution')
  assert.equal(bannerFor(['inputs', 'password', 'obfuscated'], false)?.level, 'danger')
  assert.equal(bannerFor(['redirect'], false)?.level, 'danger')
  assert.equal(bannerFor(['unchecked'], false)?.level, 'caution')
})

test('the wording never vouches for a file, because the scan cannot', () => {
  for (const finding of ALL) {
    for (const scriptsOn of [false, true]) {
      const text = bannerFor([finding], scriptsOn)?.text ?? ''
      assert.notEqual(text, '', finding)
      assert.doesNotMatch(text, /\bsafe\b|\bclean\b|no threats?/i, finding)
    }
  }
})

test('the script line follows the toggle', () => {
  assert.match(bannerFor(['scripts'], false)?.text ?? '', /They are off/)
  assert.match(bannerFor(['scripts'], true)?.text ?? '', /are running/)
  assert.match(bannerFor(['obfuscated'], true)?.text ?? '', /they are running/)
})

test('disguised scripts are not also announced as plain scripts', () => {
  const text = bannerFor(['obfuscated', 'scripts'], false)?.text ?? ''
  assert.doesNotMatch(text, /contains scripts/)
})

test('an unrecognised code from the message is dropped', () => {
  assert.equal(bannerFor(['<img src=x>' as HtmlFinding], false), null)
})
