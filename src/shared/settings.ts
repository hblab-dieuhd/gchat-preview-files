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

  /** How much of a JSON tree is open when a preview first appears. */
  jsonExpand: JsonExpand

  /** Files larger than this are refused rather than previewed. */
  maxBytes: number
}

export const PUBLIC_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml'

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
