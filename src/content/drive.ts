/**
 * Finds previewable files in Google Drive.
 *
 * Separate from `detector.ts` because the two share nothing but the extension
 * table: Chat exposes a self-describing attachment URL and no stable id, Drive
 * exposes a stable file id and no URL. Three surfaces carry a file:
 *
 *   list/grid/Home  <div data-id="FILE_ID" data-tooltip="name.html HTML">name.html</div>
 *   overlay viewer  <div id="drive-active-item-info" style="display:none">
 *                     {"id": "FILE_ID", "title": "name.html", "mimeType": "text/html"}
 *                   </div>   inside the drive.google.com/viewer/main iframe
 *   file page       /file/d/FILE_ID/view, named by <meta property="og:title">
 *
 * Confirmed against live Drive. Class names are build-generated, and aria-labels
 * ("Rename …", "Displaying …") are translated with the UI, so neither is used.
 *
 * Only html, mermaid and plantuml are offered. Drive's own viewer shows those as
 * source text, so a rendered view adds something it does not have.
 */

import { HTML_EXT, MERMAID_EXT, PLANTUML_EXT } from './detector.ts'
import { driveDownloadUrl } from '../shared/attachment-url.ts'
import type { AttachmentKind } from '../shared/protocol.ts'

export interface DriveFile {
  id: string
  fileName: string
  downloadUrl: string
  kind: AttachmentKind
}

export interface DriveRow {
  /** The element holding the file name; the button goes straight after it. */
  title: Element
  file: DriveFile
  /**
   * Identifies the button this row should hold. See `findDriveRows`.
   *
   * Carries the name so a renamed file gets a fresh button, and the occurrence
   * because one file can be on the page twice — Home lists it under both Suggested
   * and a folder. Keyed on the id alone, a single button would be moved back and
   * forth between the two, each move triggering the observer that makes the next
   * one, and the tab would hang.
   */
  slot: string
}

/**
 * Anchored at the end of the name, unlike Chat's `EXTENSION_END`. Chat has to dig
 * a name out of a sentence-like label, so it tolerates text after the extension;
 * here the string IS the name, and tolerating that would read `a.html backup.pdf`
 * as HTML.
 */
const KIND_BY_NAME: readonly (readonly [RegExp, AttachmentKind])[] = [
  [new RegExp(`\\.(?:${HTML_EXT})$`, 'i'), 'html'],
  [new RegExp(`\\.(?:${MERMAID_EXT})$`, 'i'), 'mermaid'],
  [new RegExp(`\\.(?:${PLANTUML_EXT})$`, 'i'), 'plantuml'],
]

const FILE_ID = /^[\w-]+$/
const FILE_PATH = /^\/file(?:\/u\/\d+)?\/d\/([\w-]+)/
const ACCOUNT_IN_PATH = /\/u\/(\d+)(?:\/|$)/
const ACCOUNT_IN_QUERY = /[?&]authuser=(\d+)(?:&|#|$)/

/** Holds the file id the button was built for. See `findDriveRows`. */
const ROW_BUTTON_ATTR = 'data-gchat-preview-file'

export function driveKindOf(name: string): AttachmentKind | null {
  for (const [pattern, kind] of KIND_BY_NAME) {
    if (pattern.test(name)) return kind
  }
  return null
}

export function describeDriveFile(
  id: string | null,
  name: string | null | undefined,
  authUser: string | null,
): DriveFile | null {
  const fileName = name?.trim()
  if (!id || !fileName || !FILE_ID.test(id)) return null

  const kind = driveKindOf(fileName)
  if (!kind) return null

  return { id, fileName, kind, downloadUrl: driveDownloadUrl(id, authUser) }
}

/**
 * The signed-in account index, which the download URL has to carry: without it
 * Drive answers for account 0, and a file owned by account 1 comes back refused.
 *
 * The referrer is there for the overlay viewer. Its frame's own URL has lost the
 * account by the time this runs, while the page that opened it still has it.
 */
export function accountIndex(...urls: string[]): string | null {
  for (const url of urls) {
    const path = url.split(/[?#]/)[0] ?? ''
    const match = ACCOUNT_IN_QUERY.exec(url) ?? ACCOUNT_IN_PATH.exec(path.replace(/^https?:\/\/[^/]+/, ''))
    if (match?.[1]) return match[1]
  }
  return null
}

export function fileIdFromPath(pathname: string): string | null {
  return FILE_PATH.exec(pathname)?.[1] ?? null
}

/**
 * The file the overlay viewer has open.
 *
 * A Google Doc named `notes.html` is not an HTML file — it has no bytes to
 * download — and this is the one surface that says so, through `mimeType`.
 */
export function parseActiveItem(
  json: string | null | undefined,
): { id: string; name: string } | null {
  if (!json) return null

  let item: unknown
  try {
    item = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof item !== 'object' || item === null) return null

  const { id, title, mimeType } = item as Record<string, unknown>
  if (typeof id !== 'string' || typeof title !== 'string') return null
  if (typeof mimeType === 'string' && mimeType.startsWith('application/vnd.google-apps.')) return null

  return { id, name: title }
}

/**
 * Whether this frame is Drive itself rather than Drive embedded somewhere else.
 *
 * The manifest match has to be `all_frames` to reach the overlay viewer's iframe,
 * which also matches a `/file/d/…/preview` iframe on any site that embeds one.
 * That is not a surface this extension means to appear on.
 */
export function isDriveOwnFrame(ancestorOrigins: Iterable<string>): boolean {
  for (const origin of ancestorOrigins) {
    if (origin !== 'https://drive.google.com') return false
  }
  return true
}

/**
 * Rows that need a button.
 *
 * Keyed on the file id rather than a one-way "processed" flag, because Drive
 * recycles row elements when sorting and paging. A flag would leave the old button
 * on a row now showing a different file — and clicking it would preview the wrong
 * one.
 *
 * Drive also rebuilds a row on hover, press and release, so the caller must
 * reinsert the SAME element for a slot rather than build a new one; see
 * `driveRowButton` in `index.ts`.
 */
export function findDriveRows(root: ParentNode = document): DriveRow[] {
  const rows: DriveRow[] = []
  const authUser = currentAccount()
  const occurrences = new Map<string, number>()

  for (const title of root.querySelectorAll('[data-id][data-tooltip]')) {
    const id = title.getAttribute('data-id')
    const file = describeDriveFile(id, title.textContent, authUser)

    const key = `${id}|${file?.fileName}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)

    const existing = title.parentElement?.querySelector(`:scope > [${ROW_BUTTON_ATTR}]`)
    if (file && existing?.getAttribute(ROW_BUTTON_ATTR) === id) continue
    existing?.remove()

    if (file) rows.push({ title, file, slot: `${key}#${occurrence}` })
  }

  return rows
}

export function markRowButton(host: Element, file: DriveFile): void {
  host.setAttribute(ROW_BUTTON_ATTR, file.id)
}

/** The file open in this frame's viewer, or null when no viewer is showing one. */
export function findViewerFile(root: Document = document): DriveFile | null {
  const authUser = currentAccount()

  const active = parseActiveItem(root.getElementById('drive-active-item-info')?.textContent)
  if (active) return describeDriveFile(active.id, active.name, authUser)

  const id = fileIdFromPath(location.pathname)
  const name = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
  return describeDriveFile(id, name, authUser)
}

function currentAccount(): string | null {
  return accountIndex(location.href, document.referrer)
}

/**
 * Rescans inside the observer callback, with no debounce and no frame callback.
 *
 * Chat's 300 ms debounce would break this: Drive rebuilds a row's contents the
 * moment the pointer enters it, which removes the button. With any delay the
 * button is gone right as the user reaches for it, and the click lands on the row
 * and selects it instead. `requestAnimationFrame` narrows that gap but does not
 * close it, and stalls entirely in a window the OS reports as covered. The callback
 * is a microtask, so the button is back before the next input event can land.
 *
 * Cheap enough to afford: one selector over the rows currently mounted. Inserting
 * a button triggers one further pass, which finds nothing to do and stops.
 */
export function observeDrive(onChange: () => void): void {
  new MutationObserver(onChange).observe(document.body, { childList: true, subtree: true })
  onChange()
}
