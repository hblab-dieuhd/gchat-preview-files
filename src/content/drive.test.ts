import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountIndex,
  describeDriveFile,
  driveKindOf,
  fileIdFromPath,
  isDriveOwnFrame,
  parseActiveItem,
} from './drive.ts'

/**
 * Guards the string decisions behind Drive detection. The markup these strings
 * come from was captured from live Drive; see the note at the top of `drive.ts`.
 */

test('offers html and both diagram kinds', () => {
  for (const name of ['a.html', 'a.HTM', 'a.xhtml']) assert.equal(driveKindOf(name), 'html', name)
  for (const name of ['a.mmd', 'a.mermaid']) assert.equal(driveKindOf(name), 'mermaid', name)
  for (const name of ['a.puml', 'a.plantuml', 'a.iuml', 'a.wsd', 'a.pu']) {
    assert.equal(driveKindOf(name), 'plantuml', name)
  }
})

test('leaves alone what Drive was not asked to preview', () => {
  for (const name of ['a.md', 'a.json', 'a.txt', 'a.pdf', 'a.drawio', 'Sheet']) {
    assert.equal(driveKindOf(name), null, name)
  }
})

test('the extension must end the name', () => {
  // Chat's tolerant pattern would call all of these html.
  for (const name of ['a.html backup.pdf', 'a.html.zip', 'a.html.', 'a.htmlx']) {
    assert.equal(driveKindOf(name), null, name)
  }
})

test('keeps spaces and dots in a real file name', () => {
  const file = describeDriveFile('abc-1_2', '  Q3 report v1.2.html ', null)
  assert.equal(file?.fileName, 'Q3 report v1.2.html')
  assert.equal(file?.kind, 'html')
  assert.equal(file?.downloadUrl, 'https://drive.google.com/uc?export=download&id=abc-1_2')
})

test('carries the account into the download URL', () => {
  assert.equal(
    describeDriveFile('abc', 'a.puml', '2')?.downloadUrl,
    'https://drive.google.com/uc?export=download&id=abc&authuser=2',
  )
})

test('refuses an id that could change the URL it is built into', () => {
  for (const id of ['a&export=view', 'a/b', 'a b', '', null]) {
    assert.equal(describeDriveFile(id, 'a.html', null), null, String(id))
  }
})

test('reads the account from wherever Drive put it', () => {
  assert.equal(accountIndex('https://drive.google.com/drive/u/1/my-drive'), '1')
  assert.equal(accountIndex('https://drive.google.com/file/u/3/d/abc/view'), '3')
  assert.equal(accountIndex('https://drive.google.com/file/d/abc/view?authuser=2&usp=x'), '2')
  assert.equal(accountIndex('https://drive.google.com/drive/my-drive?hl=en'), null)

  // The overlay's frame has lost it; the page that opened the frame has not.
  assert.equal(
    accountIndex('https://drive.google.com/viewer/main?hl=en', 'https://drive.google.com/drive/u/4/home'),
    '4',
  )
})

test('does not take an account from a search query that looks like one', () => {
  assert.equal(accountIndex('https://drive.google.com/drive/search?q=/u/7/'), null)
})

test('finds the id in a file page path', () => {
  assert.equal(fileIdFromPath('/file/d/1RLvx-9_i/view'), '1RLvx-9_i')
  assert.equal(fileIdFromPath('/file/u/0/d/1RLvx/view'), '1RLvx')
  assert.equal(fileIdFromPath('/file/d/1RLvx/preview'), '1RLvx')
  assert.equal(fileIdFromPath('/drive/my-drive'), null)
})

test('reads the overlay viewer item, verbatim shape from live Drive', () => {
  assert.deepEqual(
    parseActiveItem('{"id": "1RLvx", "title": "1334_Auction.drawio.html", "mimeType": "text/html"}'),
    { id: '1RLvx', name: '1334_Auction.drawio.html' },
  )
})

test('a Google Doc named like a file has no bytes to preview', () => {
  assert.equal(
    parseActiveItem('{"id":"x","title":"notes.html","mimeType":"application/vnd.google-apps.document"}'),
    null,
  )
})

test('tolerates a malformed viewer item', () => {
  for (const value of [null, undefined, '', 'not json', 'null', '[]', '{"id":1,"title":"a.html"}']) {
    assert.equal(parseActiveItem(value), null, String(value))
  }
})

test('runs only where every ancestor is Drive', () => {
  assert.equal(isDriveOwnFrame([]), true)
  assert.equal(isDriveOwnFrame(['https://drive.google.com']), true)
  assert.equal(isDriveOwnFrame(['https://drive.google.com', 'https://example.com']), false)
  assert.equal(isDriveOwnFrame(['https://mail.google.com']), false)
})
