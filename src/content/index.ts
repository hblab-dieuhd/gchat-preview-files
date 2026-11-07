import { observeHtmlAttachments, type HtmlAttachment } from './detector.ts'
import {
  findDriveRows,
  findViewerFile,
  isDriveOwnFrame,
  markRowButton,
  observeDrive,
  type DriveFile,
  type DriveRow,
} from './drive.ts'
import { openPreview } from './preview-modal.ts'
import { requestFromBackground } from './background-request.ts'
import { fetchAttachmentText } from '../shared/fetch-attachment.ts'
import type { FetchAttachmentRequest, FetchAttachmentResponse } from '../shared/protocol.ts'
import { DEFAULT_SETTINGS, isKindEnabled, loadSettings, type Settings } from '../shared/settings.ts'

/**
 * Entry point injected into Google Chat and Google Drive.
 *
 * Responsibilities are deliberately narrow: spot attachments, obtain their bytes,
 * and hand them to the sandbox. It never renders attachment HTML itself.
 *
 * It is also the only context that can read settings — the sandbox page has no
 * `chrome.*` APIs — so it reads them once and forwards what the sandbox needs.
 */

let settings: Settings = { ...DEFAULT_SETTINGS }

const BUTTON_STYLES = `
  :host { all: initial; }
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    /* Bounded so a long name cannot stretch the message row; the name itself
       ellipsises inside it. */
    max-width: 320px;
    margin: 4px 0 4px 8px;
    padding: 2px 10px;
    border: 1px solid #dadce0;
    border-radius: 12px;
    background: #fff;
    color: #1a73e8;
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
    vertical-align: middle;
  }
  .action { flex: none; }
  /* min-width:0 is what lets a flex item shrink below its content and ellipsise. */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #5f6368;
  }
  .name::before { content: "·"; margin-right: 4px; color: #bdc1c6; }
  button:hover { background: #f1f3f4; }
  button:disabled { color: #80868b; cursor: default; }
  button:disabled .name { color: #b0b4b8; }
`

/** What a preview needs to know, wherever the file was found. */
type PreviewSource = Pick<HtmlAttachment, 'fileName' | 'downloadUrl' | 'kind'>

function createPreviewButton(
  attachment: PreviewSource,
  { showName }: { showName: boolean },
): { host: HTMLElement; open: () => void } {
  const host = document.createElement('span')
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = BUTTON_STYLES

  const button = document.createElement('button')
  button.type = 'button'
  button.title = `Preview ${attachment.fileName} without downloading it`

  // The name is on the button, not only in the title: a card can sit next to
  // others and "Preview" alone does not say which file it opens.
  const action = document.createElement('span')
  action.className = 'action'
  action.textContent = 'Preview'

  // textContent, never innerHTML — this string is the sender's `alt` text.
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = attachment.fileName

  button.append(action)
  if (showName) button.append(name)

  button.addEventListener('click', (event) => {
    // Chat's own click handlers would otherwise start a download.
    event.preventDefault()
    event.stopPropagation()
    void showPreview(attachment, button)
  })

  shadow.append(style, button)
  return { host, open: () => void showPreview(attachment, button) }
}

function attachPreviewButton(attachment: HtmlAttachment): void {
  if (!isKindEnabled(settings, attachment.kind)) return
  attachment.mountAfter.insertAdjacentElement('afterend', createPreviewButton(attachment, { showName: true }).host)
}

/**
 * Stops the row reacting to the button: press selects a row, double-click opens
 * Drive's viewer. `pointerup` is handled separately below.
 */
const DRIVE_ROW_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'dblclick'] as const

/** Reused across Drive's row rebuilds; see `driveRowButton`. */
const driveRowButtons = new Map<string, HTMLElement>()

/**
 * A row button is driven by pointer events, because it never receives a mouse
 * `click`.
 *
 * Drive rebuilds the row on hover, press and release, which detaches the button
 * mid-gesture. Chrome forgets the click target the moment that node leaves the
 * tree, and reinserting the very same element does not bring it back. Pointer
 * events are still delivered to the button, confirmed against live Drive, so the
 * press and release are paired by hand.
 *
 * That pairing lives in this closure, which is why the same element has to be
 * reinserted for a slot rather than a new one built per scan. Keyboard activation
 * has no pointer events and still arrives as `click`, with `detail` 0.
 */
function driveRowButton(slot: string, file: DriveFile): HTMLElement {
  const existing = driveRowButtons.get(slot)
  if (existing) return existing

  // The name is right beside it in a row, so repeating it would only cost width.
  const { host, open } = createPreviewButton(file, { showName: false })
  // Above the absolutely positioned layer that covers a whole card in grid view,
  // which would otherwise hide the button and take its clicks.
  host.style.cssText = 'flex: none; position: relative; z-index: 1;'
  markRowButton(host, file)
  for (const type of DRIVE_ROW_EVENTS) {
    host.addEventListener(type, (event) => event.stopPropagation())
  }

  let pressed = false
  host.addEventListener('pointerdown', (event) => {
    pressed = event.button === 0
  })
  host.addEventListener('pointerup', (event) => {
    event.stopPropagation()
    if (pressed) open()
    pressed = false
  })
  // A release anywhere else abandons the press. Never reached by a release on the
  // button, whose listener above stops it first.
  window.addEventListener('pointerup', () => {
    pressed = false
  })
  // A mouse click that does survive must not open the preview a second time.
  host.addEventListener(
    'click',
    (event) => {
      if (event.detail > 0) event.stopImmediatePropagation()
    },
    true,
  )

  driveRowButtons.set(slot, host)
  return host
}

function attachDriveRowButton({ title, file, slot }: DriveRow): void {
  if (!isKindEnabled(settings, file.kind)) return
  title.insertAdjacentElement('afterend', driveRowButton(slot, file))
}

let viewerButton: { fileId: string; host: HTMLElement } | null = null

/**
 * Keeps one floating button in step with the file the viewer has open.
 *
 * Fixed rather than slotted into Drive's toolbar: the Comment and Download buttons
 * that would anchor it come and go with the file's permissions, and the place it
 * sits — the empty end of the toolbar row — is the same on both viewers.
 */
function syncViewerButton(): void {
  const found = findViewerFile()
  const file = found && isKindEnabled(settings, found.kind) ? found : null
  if (viewerButton?.fileId === file?.id) return

  viewerButton?.host.remove()
  viewerButton = null
  if (!file) return

  const { host } = createPreviewButton(file, { showName: true })
  host.style.cssText = 'position: fixed; top: 74px; right: 24px; z-index: 2147483000;'
  document.body.append(host)
  viewerButton = { fileId: file.id, host }
}

function startOnDrive(): void {
  // See `isDriveOwnFrame`: a Drive iframe embedded on another site is not ours.
  if (!isDriveOwnFrame(location.ancestorOrigins)) return

  observeDrive(() => {
    for (const row of findDriveRows()) attachDriveRowButton(row)
    syncViewerButton()
  })
}

async function showPreview(attachment: PreviewSource, button: HTMLButtonElement): Promise<void> {
  const preview = openPreview(attachment.fileName, attachment.kind, settings)
  button.disabled = true

  try {
    const response = await requestAttachment(attachment.downloadUrl)
    if (response.ok) preview.render(response.text)
    else preview.fail(response.error)
  } catch (error) {
    preview.fail(error instanceof Error ? error.message : String(error))
  } finally {
    button.disabled = false
  }
}

/**
 * Downloads the attachment, preferring a direct fetch from this page.
 *
 * The service worker goes first. `DOWNLOAD_URL` answers with a cross-origin
 * redirect to Google's file-serving hosts, and a page-context fetch dies there
 * with a bare "Failed to fetch": the request starts same-origin but the redirect
 * makes it cross-origin, and those hosts send no `Access-Control-Allow-Origin`.
 * Only the worker can follow it, because host_permissions exempt it from CORS.
 *
 * The page-context fetch is kept as a fallback for the opposite failure: it is
 * the only context that sends `Origin`/`Referer`, which the Chat API may require.
 *
 * Both errors are reported when both fail. Returning only one of them is what
 * previously hid the real cause behind a plausible-looking message.
 */
async function requestAttachment(url: string): Promise<FetchAttachmentResponse> {
  const failures: string[] = []

  const viaWorker = await requestViaServiceWorker(url).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (viaWorker.ok) return viaWorker
  failures.push(`In the background — ${viaWorker.error}`)

  if (isSameOrigin(url)) {
    const direct = await fetchAttachmentText(url, settings.maxBytes)
    if (direct.ok) return direct
    failures.push(`In the page — ${direct.error}`)
  }

  return { ok: false, error: failures.join('  ||  ') }
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === location.origin
  } catch {
    return false
  }
}

function requestViaServiceWorker(url: string): Promise<FetchAttachmentResponse> {
  const request: FetchAttachmentRequest = { type: 'FETCH_ATTACHMENT', url, maxBytes: settings.maxBytes }
  // Retries the shutting-down-worker race; see `background-request.ts`.
  return requestFromBackground<FetchAttachmentResponse>(request)
}

/**
 * Settings are loaded before scanning starts, so a disabled file type never gets
 * a button that then has to be removed. Later edits apply to previews opened
 * from then on; buttons already in the page are left alone.
 */
void loadSettings().then((loaded) => {
  settings = loaded

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void loadSettings().then((next) => (settings = next))
  })

  if (location.hostname === 'drive.google.com') {
    startOnDrive()
    return
  }

  observeHtmlAttachments((attachments) => {
    for (const attachment of attachments) attachPreviewButton(attachment)
  })
})
