#!/usr/bin/env node
/**
 * Packs dist/ into release/<name>-<version>.zip for the Chrome Web Store.
 *
 * The one thing that must not change: the zip's entries are relative to dist/,
 * so manifest.json sits at the ROOT of the archive. Zipping the dist/ folder
 * itself (`zip -r out.zip dist`) produces `dist/manifest.json` and the Web Store
 * rejects the upload with "Manifest file is missing or unreadable" — which reads
 * like a manifest bug and is not one.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const outDir = resolve(root, 'release')

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run `npm run build` first.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// The manifest version is the one the Web Store reads; package.json must not drift.
if (manifest.version !== pkg.version) {
  console.error(
    `Version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}.\n` +
      'Bump both before packaging — the Web Store rejects a re-upload of an existing version.',
  )
  process.exit(1)
}

const zipPath = resolve(outDir, `gchat-preview-files-${manifest.version}.zip`)
mkdirSync(outDir, { recursive: true })
rmSync(zipPath, { force: true })

execFileSync(
  'zip',
  ['-r', '-X', '-q', zipPath, '.', '-x', '.*', '-x', '*/.*', '-x', '__MACOSX/*'],
  { cwd: dist, stdio: 'inherit' },
)

const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

if (!entries.includes('manifest.json')) {
  console.error('Packaging failed: manifest.json is not at the archive root.')
  process.exit(1)
}

console.log(`${zipPath}`)
console.log(`${entries.length} entries, version ${manifest.version}`)
