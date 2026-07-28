import type { JsonExpand } from '../shared/protocol.ts'
import { escapeHtml } from './markdown.ts'

/**
 * Renders JSON as a browsable tree.
 *
 * The hard constraint: this document runs in a frame with `sandbox=""`, so
 * **there is no JavaScript**. Collapsing and expanding is therefore built on
 * `<details>`/`<summary>`, which the browser handles natively. Anything that
 * would need script — expand-all, collapse-all — is a re-render driven from the
 * modal instead, which is why `JsonExpand` exists.
 *
 * Every value that reaches the output goes through `escapeHtml`, including keys.
 * A JSON string containing `</script>` is data, and must stay data.
 */

/** Depth that stays open in `auto` mode. Deep files open unusably slowly otherwise. */
const AUTO_OPEN_DEPTH = 2

/**
 * Above this many values the tree is replaced by pretty-printed text. Each node
 * costs a `<details>` element, and browsers get slow long before the 5 MB size
 * cap is reached.
 */
const MAX_NODES = 20_000

export function renderJson(source: string, expand: JsonExpand): string {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return renderInvalid(source, error)
  }

  if (countNodes(value, MAX_NODES) > MAX_NODES) {
    return [
      note('This file is too large to browse as a tree, so it is shown as formatted text.'),
      `<pre class="plain">${escapeHtml(safeStringify(value))}</pre>`,
    ].join('')
  }

  return `<div class="json">${renderValue(value, '', 0, expand)}</div>`
}

/** Prebuilt HTML for the `"key": ` or `0: ` prefix; empty at the root. */
function objectLabel(key: string): string {
  return `<span class="j-key">${escapeHtml(JSON.stringify(key))}</span><span class="j-punct">: </span>`
}

/**
 * Array items are prefixed with their index. Without it, a list of similar
 * objects collapses into a column of identical `{ … 3 keys }` rows with no way
 * to tell which is which.
 */
function indexLabel(index: number): string {
  return `<span class="j-index">${index}</span><span class="j-punct">: </span>`
}

function renderValue(value: unknown, label: string, depth: number, expand: JsonExpand): string {
  if (Array.isArray(value)) {
    return renderContainer({
      children: value.map((item, index) => renderValue(item, indexLabel(index), depth + 1, expand)),
      label,
      open: '[',
      close: ']',
      count: plural(value.length, 'item'),
      depth,
      expand,
    })
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return renderContainer({
      children: entries.map(([entryKey, entryValue]) =>
        renderValue(entryValue, objectLabel(entryKey), depth + 1, expand),
      ),
      label,
      open: '{',
      close: '}',
      count: plural(entries.length, 'key'),
      depth,
      expand,
    })
  }

  return `<div class="j-leaf">${label}${renderPrimitive(value)}</div>`
}

interface ContainerParts {
  children: string[]
  label: string
  open: string
  close: string
  count: string
  depth: number
  expand: JsonExpand
}

function renderContainer(parts: ContainerParts): string {
  const { children, label, open, close, count, depth, expand } = parts

  // An empty container has nothing to expand into, so it stays a plain line.
  if (children.length === 0) {
    return `<div class="j-leaf">${label}<span class="j-punct">${open}${close}</span></div>`
  }

  return [
    `<details class="j-node"${isOpen(depth, expand) ? ' open' : ''}>`,
    `<summary>${label}<span class="j-punct">${open}</span>`,
    // Hidden by CSS while open; this is the collapsed one-line form.
    `<span class="j-collapsed"> … <span class="j-count">${count}</span> <span class="j-punct">${close}</span></span>`,
    '</summary>',
    `<div class="j-list">${children.join('')}</div>`,
    `<div class="j-punct j-close">${close}</div>`,
    '</details>',
  ].join('')
}

function isOpen(depth: number, expand: JsonExpand): boolean {
  if (expand === 'all') return true
  // Collapse-all keeps the root open, otherwise the view is a single line and
  // the user has to hunt for something to click.
  if (expand === 'none') return depth === 0
  return depth < AUTO_OPEN_DEPTH
}

function renderPrimitive(value: unknown): string {
  if (value === null) return '<span class="j-null">null</span>'

  switch (typeof value) {
    case 'string':
      return `<span class="j-string">${escapeHtml(JSON.stringify(value))}</span>`
    case 'number':
      return `<span class="j-number">${escapeHtml(String(value))}</span>`
    case 'boolean':
      return `<span class="j-boolean">${value ? 'true' : 'false'}</span>`
    default:
      return `<span class="j-null">${escapeHtml(String(value))}</span>`
  }
}

/**
 * Invalid JSON still gets shown. Someone sharing a broken file usually wants to
 * see *why* it is broken, and hiding the content behind an error would make the
 * preview less useful than the download it replaces.
 */
function renderInvalid(source: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return [
    `<div class="j-error"><strong>Not valid JSON.</strong> Showing the raw file.<br>${escapeHtml(message)}</div>`,
    `<pre class="plain">${escapeHtml(source)}</pre>`,
  ].join('')
}

function note(text: string): string {
  return `<div class="j-note">${escapeHtml(text)}</div>`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Counts values, stopping once the budget is blown so huge files stay cheap. */
function countNodes(value: unknown, budget: number): number {
  let seen = 0

  const walk = (node: unknown): void => {
    if (seen > budget) return
    seen += 1

    if (Array.isArray(node)) {
      for (const item of node) walk(item)
    } else if (node !== null && typeof node === 'object') {
      for (const item of Object.values(node as Record<string, unknown>)) walk(item)
    }
  }

  walk(value)
  return seen
}
