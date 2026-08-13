import {
  DEFAULT_SETTINGS,
  MAX_ALLOWED_BYTES,
  PUBLIC_PLANTUML_SERVER,
  assetHostPatterns,
  loadSettings,
  normaliseHost,
  normaliseHosts,
  normaliseServer,
  saveSettings,
  serverOriginPattern,
  type Settings,
} from '../shared/settings.ts'

/**
 * The options page.
 *
 * Two things here are more than form plumbing, and they are the same thing twice:
 * a custom PlantUML server and every allowed asset host need a **host
 * permission**, which Chrome will only grant from a user gesture. So both are
 * requested during the save click, and the save is abandoned if the user
 * declines — storing a host the extension cannot reach would produce broken
 * previews with no explanation.
 */

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const fields = {
  previewHtml: el<HTMLInputElement>('previewHtml'),
  previewMarkdown: el<HTMLInputElement>('previewMarkdown'),
  previewJson: el<HTMLInputElement>('previewJson'),
  previewMermaid: el<HTMLInputElement>('previewMermaid'),
  previewPlantUml: el<HTMLInputElement>('previewPlantUml'),
  allowScriptsByDefault: el<HTMLInputElement>('allowScriptsByDefault'),
  mermaidEnabled: el<HTMLInputElement>('mermaidEnabled'),
  plantUmlEnabled: el<HTMLInputElement>('plantUmlEnabled'),
  plantUmlServer: el<HTMLInputElement>('plantUmlServer'),
  remoteAssets: el<HTMLInputElement>('remoteAssets'),
  remoteAssetHosts: el<HTMLTextAreaElement>('remoteAssetHosts'),
  jsonExpand: el<HTMLSelectElement>('jsonExpand'),
  maxMb: el<HTMLInputElement>('maxMb'),
}

/**
 * What is currently in storage, as opposed to what the form now says.
 *
 * Only one thing needs it: releasing the host permissions for asset hosts that
 * have just been switched off or removed, which means knowing which ones were
 * granted before this save.
 */
let stored: Settings = { ...DEFAULT_SETTINGS }

const scriptsWarning = el<HTMLDivElement>('scriptsWarning')
const plantUmlWarning = el<HTMLDivElement>('plantUmlWarning')
const plantUmlHost = el<HTMLElement>('plantUmlHost')
const plantUmlError = el<HTMLDivElement>('plantUmlError')
const remoteAssetsWarning = el<HTMLDivElement>('remoteAssetsWarning')
const remoteAssetsError = el<HTMLDivElement>('remoteAssetsError')
const status = el<HTMLSpanElement>('status')

function fill(settings: Settings): void {
  fields.previewHtml.checked = settings.previewHtml
  fields.previewMarkdown.checked = settings.previewMarkdown
  fields.previewJson.checked = settings.previewJson
  fields.previewMermaid.checked = settings.previewMermaid
  fields.previewPlantUml.checked = settings.previewPlantUml
  fields.allowScriptsByDefault.checked = settings.allowScriptsByDefault
  fields.mermaidEnabled.checked = settings.mermaidEnabled
  fields.plantUmlEnabled.checked = settings.plantUmlEnabled
  fields.plantUmlServer.value = settings.plantUmlServer
  fields.remoteAssets.checked = settings.remoteAssets
  fields.remoteAssetHosts.value = settings.remoteAssetHosts.join('\n')
  fields.jsonExpand.value = settings.jsonExpand
  fields.maxMb.value = String(Math.round(settings.maxBytes / (1024 * 1024)))
  syncHints()
}

function collect(): Settings {
  const megabytes = Number(fields.maxMb.value)

  return {
    previewHtml: fields.previewHtml.checked,
    previewMarkdown: fields.previewMarkdown.checked,
    previewJson: fields.previewJson.checked,
    previewMermaid: fields.previewMermaid.checked,
    previewPlantUml: fields.previewPlantUml.checked,
    allowScriptsByDefault: fields.allowScriptsByDefault.checked,
    mermaidEnabled: fields.mermaidEnabled.checked,
    plantUmlEnabled: fields.plantUmlEnabled.checked,
    plantUmlServer: normaliseServer(fields.plantUmlServer.value),
    remoteAssets: fields.remoteAssets.checked,
    remoteAssetHosts: normaliseHosts(fields.remoteAssetHosts.value.split('\n')),
    jsonExpand: fields.jsonExpand.value as Settings['jsonExpand'],
    maxBytes: Number.isFinite(megabytes)
      ? Math.min(Math.max(Math.round(megabytes), 1) * 1024 * 1024, MAX_ALLOWED_BYTES)
      : DEFAULT_SETTINGS.maxBytes,
  }
}

/** Keeps the warnings honest about what the current choices actually do. */
function syncHints(): void {
  scriptsWarning.hidden = !fields.allowScriptsByDefault.checked

  const plantUmlOn = fields.plantUmlEnabled.checked
  fields.plantUmlServer.disabled = !plantUmlOn
  plantUmlWarning.hidden = !plantUmlOn

  const server = normaliseServer(fields.plantUmlServer.value)
  try {
    plantUmlHost.textContent = new URL(server).host
  } catch {
    plantUmlHost.textContent = server
  }

  const assetsOn = fields.remoteAssets.checked
  fields.remoteAssetHosts.disabled = !assetsOn
  remoteAssetsWarning.hidden = !assetsOn
}

function showStatus(message: string, isError = false): void {
  status.textContent = message
  status.hidden = false
  status.classList.toggle('bad', isError)
  setTimeout(() => {
    status.hidden = true
  }, 3000)
}

/**
 * Sidebar scrollspy.
 *
 * Deliberately position-based rather than an IntersectionObserver: the sections
 * have very different heights, and the last one is short enough that it would
 * never cross an observer band, leaving the nav stuck on the previous entry.
 * Reading scroll position handles that case explicitly.
 */
function setUpNav(): void {
  const content = el<HTMLElement>('content')
  const links = [...el<HTMLElement>('nav').querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]

  const targets = links
    .map((link) => ({ link, section: document.getElementById(link.hash.slice(1)) }))
    .filter((entry): entry is { link: HTMLAnchorElement; section: HTMLElement } =>
      Boolean(entry.section),
    )
  if (targets.length === 0) return

  /** Distance below the top of the scroller at which a section counts as current. */
  const TRIGGER = 90

  const markActive = (active: HTMLAnchorElement): void => {
    for (const { link } of targets) link.classList.toggle('active', link === active)
  }

  const sync = (): void => {
    const scrolled = content.scrollTop
    // The last section can be too short to ever reach the trigger line, so
    // hitting the bottom selects it outright.
    const atBottom = scrolled + content.clientHeight >= content.scrollHeight - 4

    let current = targets[0]!.link
    if (atBottom) {
      current = targets[targets.length - 1]!.link
    } else {
      for (const { link, section } of targets) {
        if (section.offsetTop <= scrolled + TRIGGER) current = link
      }
    }
    markActive(current)
  }

  let queued = false
  content.addEventListener(
    'scroll',
    () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        sync()
      })
    },
    { passive: true },
  )

  for (const { link, section } of targets) {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      // scrollTo rather than the default hash jump: `main` is the scroller, and
      // changing location.hash would also leave a history entry behind.
      content.scrollTo({ top: Math.max(section.offsetTop - 12, 0), behavior: 'smooth' })
      markActive(link)
    })
  }

  sync()
}

/**
 * Chrome only grants optional host permissions from a user gesture, so this must
 * run inside the click handler — awaiting anything before it loses the gesture.
 */
async function ensureServerPermission(server: string): Promise<boolean> {
  if (server === PUBLIC_PLANTUML_SERVER) return true

  const origins = [serverOriginPattern(server)]
  if (await chrome.permissions.contains({ origins })) return true

  return chrome.permissions.request({ origins })
}

/**
 * Same gesture constraint as the PlantUML server, and the same consequence: this
 * has to run inside the click handler, because awaiting anything beforehand loses
 * the user gesture and Chrome refuses the prompt.
 *
 * The whole list is checked in one call and requested in one call, deliberately:
 * a per-host loop would put an await between the gesture and the prompt for every
 * host but the first. Chrome does not prompt again for what is already granted, so
 * re-requesting the full list costs nothing.
 */
async function ensureAssetPermissions(hosts: string[]): Promise<boolean> {
  if (hosts.length === 0) return true

  const origins = assetHostPatterns(hosts)
  if (await chrome.permissions.contains({ origins })) return true

  return chrome.permissions.request({ origins })
}

/**
 * Gives back the host permissions the asset allowlist no longer needs.
 *
 * Without this the grant outlives the feature: switch linked resources on once,
 * off again, and the extension keeps standing access to those CDNs forever. The
 * permission is meant to be the answer to "may I fetch this for you", so it ends
 * when the answer does.
 *
 * Two origins must survive the sweep whatever the allowlist says — the ones in
 * `host_permissions`, which `remove` rejects outright, and whatever the PlantUML
 * server is currently set to, which is a separate grant that happens to be able
 * to collide with an asset host.
 */
async function releaseAssetPermissions(previous: string[], next: Settings): Promise<void> {
  const required = new Set(chrome.runtime.getManifest().host_permissions ?? [])
  const keep = next.remoteAssets ? next.remoteAssetHosts : []
  const wanted = new Set([...assetHostPatterns(keep), serverOriginPattern(next.plantUmlServer)])

  const origins = assetHostPatterns(previous).filter(
    (origin) => !wanted.has(origin) && !required.has(origin),
  )
  if (origins.length === 0) return

  try {
    await chrome.permissions.remove({ origins })
  } catch {
    // Never granted, or Chrome refused one of them. Nothing to undo either way.
  }
}

async function save(): Promise<void> {
  plantUmlError.hidden = true
  remoteAssetsError.hidden = true

  const settings = collect()
  const typed = fields.plantUmlServer.value.trim()

  // normaliseServer silently falls back, which would look like the field was
  // ignored. Say so instead.
  if (settings.plantUmlEnabled && typed && settings.plantUmlServer !== normaliseServer(typed)) {
    plantUmlError.textContent = 'Enter a full https:// URL, for example https://uml.example.com/plantuml'
    plantUmlError.hidden = false
    return
  }

  if (settings.plantUmlEnabled) {
    let granted = false
    try {
      granted = await ensureServerPermission(settings.plantUmlServer)
    } catch (error) {
      plantUmlError.textContent = error instanceof Error ? error.message : String(error)
      plantUmlError.hidden = false
      return
    }

    if (!granted) {
      plantUmlError.textContent =
        'Permission to reach that server was declined, so nothing was saved. ' +
        'Diagrams cannot be fetched without it.'
      plantUmlError.hidden = false
      return
    }
  }

  if (settings.remoteAssets) {
    // An entry that survives neither as a hostname nor as a pasted URL is dropped
    // by normaliseHosts, which would look like the box was ignored. Say so, and
    // name the line — comparing counts would misfire on a duplicated host, which
    // normaliseHosts also collapses and which is not a mistake worth blocking on.
    const rejected = fields.remoteAssetHosts.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && normaliseHost(line) === null)

    if (rejected.length > 0) {
      remoteAssetsError.textContent =
        `“${rejected[0]!}” is not a host name. Use one host per line, like ` +
        'cdn.jsdelivr.net or *.example.com — no paths.'
      remoteAssetsError.hidden = false
      return
    }

    let granted = false
    try {
      granted = await ensureAssetPermissions(settings.remoteAssetHosts)
    } catch (error) {
      remoteAssetsError.textContent = error instanceof Error ? error.message : String(error)
      remoteAssetsError.hidden = false
      return
    }

    if (!granted) {
      remoteAssetsError.textContent =
        'Permission to reach those hosts was declined, so nothing was saved. ' +
        'Linked resources cannot be downloaded without it.'
      remoteAssetsError.hidden = false
      return
    }
  }

  await saveSettings(settings)
  // After the write, not before: a grant that is dropped while the save could
  // still fail would leave the stored allowlist naming hosts nothing can reach.
  await releaseAssetPermissions(stored.remoteAssetHosts, settings)
  stored = settings
  fill(settings)
  showStatus('Saved.')
}

for (const field of Object.values(fields)) {
  field.addEventListener('change', syncHints)
  field.addEventListener('input', syncHints)
}

el<HTMLButtonElement>('save').addEventListener('click', () => {
  void save()
})

el<HTMLButtonElement>('reset').addEventListener('click', () => {
  fill(DEFAULT_SETTINGS)
  void saveSettings(DEFAULT_SETTINGS)
    // Resetting turns linked resources back off, so the CDN grants go with it.
    .then(() => releaseAssetPermissions(stored.remoteAssetHosts, DEFAULT_SETTINGS))
    .then(() => {
      stored = { ...DEFAULT_SETTINGS }
      showStatus('Reset to defaults.')
    })
})

el<HTMLElement>('version').textContent = `v${chrome.runtime?.getManifest?.().version ?? '0.0.0'}`

setUpNav()
void loadSettings().then((loaded) => {
  stored = loaded
  fill(loaded)
})
