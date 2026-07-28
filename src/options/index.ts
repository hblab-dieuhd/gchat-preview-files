import {
  DEFAULT_SETTINGS,
  MAX_ALLOWED_BYTES,
  PUBLIC_PLANTUML_SERVER,
  loadSettings,
  normaliseServer,
  saveSettings,
  serverOriginPattern,
  type Settings,
} from '../shared/settings.ts'

/**
 * The options page.
 *
 * One thing here is more than form plumbing: a custom PlantUML server needs a
 * **host permission**, which Chrome will only grant from a user gesture. So the
 * permission is requested during the save click, and the save is abandoned if
 * the user declines — storing a server the extension cannot reach would produce
 * broken diagrams with no explanation.
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
  jsonExpand: el<HTMLSelectElement>('jsonExpand'),
  maxMb: el<HTMLInputElement>('maxMb'),
}

const scriptsWarning = el<HTMLDivElement>('scriptsWarning')
const plantUmlWarning = el<HTMLDivElement>('plantUmlWarning')
const plantUmlHost = el<HTMLElement>('plantUmlHost')
const plantUmlError = el<HTMLDivElement>('plantUmlError')
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

async function save(): Promise<void> {
  plantUmlError.hidden = true

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

  await saveSettings(settings)
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
  void saveSettings(DEFAULT_SETTINGS).then(() => showStatus('Reset to defaults.'))
})

el<HTMLElement>('version').textContent = `v${chrome.runtime?.getManifest?.().version ?? '0.0.0'}`

setUpNav()
void loadSettings().then(fill)
