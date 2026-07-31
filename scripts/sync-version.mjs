#!/usr/bin/env node
/**
 * Copies the version from package.json into public/manifest.json.
 *
 * Wired to npm's `version` lifecycle, so `npm version minor` bumps both files in
 * one commit. scripts/package.mjs refuses to build when the two disagree — that
 * guard is right, but leaving the fix as "remember to edit two files" is the kind
 * of manual step that breaks a release at the worst moment.
 *
 * A targeted replace, not JSON.parse + stringify: the manifest is hand-maintained
 * and a round-trip through the parser would silently reformat it.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'public/manifest.json')

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = readFileSync(manifestPath, 'utf8')

// `^\s*"version"` cannot match "manifest_version" or "minimum_chrome_version" —
// both have a character other than a quote where this pattern needs one.
const pattern = /^(\s*"version":\s*")[^"]*(")/m
const matches = manifest.match(new RegExp(pattern, 'gm')) ?? []

if (matches.length !== 1) {
  console.error(
    `Expected exactly one top-level "version" in public/manifest.json, found ${matches.length}.`,
  )
  process.exit(1)
}

writeFileSync(manifestPath, manifest.replace(pattern, `$1${version}$2`))

// npm commits during `version`, so the manifest has to be staged to ride along.
// Outside a release (a bare `npm run sync-version`) there may be nothing to stage,
// and failing there would be noise.
try {
  execFileSync('git', ['add', manifestPath], { cwd: root, stdio: 'pipe' })
} catch {
  console.warn('Could not stage public/manifest.json — stage it yourself.')
}

console.log(`public/manifest.json -> ${version}`)
