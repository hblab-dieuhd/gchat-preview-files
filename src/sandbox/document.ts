import type {
  AssetSettings,
  AttachmentKind,
  DiagramKind,
  DiagramSettings,
  JsonExpand,
} from '../shared/protocol.ts'
import { escapeHtml, plantUmlUrl, renderMarkdown } from './markdown.ts'
import { renderJson } from './json.ts'
import { HIGHLIGHT_STYLES } from './highlight.ts'
import { inlineRemoteAssets, type AssetFetcher, type InlineResult } from './inline-assets.ts'

/**
 * Turns an attachment's text into the document the inner frame renders.
 *
 * This is where the kinds diverge, and the difference is a security boundary:
 *
 *  - `html`      the file *is* the document, passed through untouched.
 *  - `markdown`  we generate the document; raw HTML in the source is escaped.
 *  - `json`      we generate the document; every key and value is escaped into a
 *                <details> tree, so a JSON string containing markup stays data.
 *  - `mermaid`,
 *    `plantuml`  we generate the document; the whole file is one diagram, and
 *                its source is escaped on every path that shows it.
 *
 * Markdown may contain diagrams. Mermaid is rendered to SVG through the injected
 * `renderDiagram` callback — injected rather than imported so the 3.2 MB mermaid
 * bundle stays out of documents that do not need it, and so tests can run without
 * a DOM. PlantUML needs no callback: it is already an <img> by this point.
 *
 * The generated documents carry no script — the frame that renders them is built
 * with `sandbox=""`. Anything interactive in them must work in pure HTML/CSS.
 *
 * Remote images and fonts will not load — the sandbox CSP is `img-src data:
 * blob:` with no host. That is deliberate; see the security notes in CLAUDE.md.
 */

const DOCUMENT_STYLES = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 32px 40px 64px;
    background: #fff;
    color: #202124;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    overflow-wrap: break-word;
  }
  .plain {
    margin: 0;
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    tab-size: 4;
  }
  .markdown > :first-child { margin-top: 0; }
  h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.3; font-weight: 600; }
  h1 { font-size: 1.9em; padding-bottom: 0.3em; border-bottom: 1px solid #e0e0e0; }
  h2 { font-size: 1.45em; padding-bottom: 0.3em; border-bottom: 1px solid #e0e0e0; }
  h3 { font-size: 1.2em; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
  ul, ol { padding-left: 1.6em; }
  li + li { margin-top: 0.25em; }
  a { color: #1a73e8; }
  code {
    padding: 0.15em 0.4em;
    border-radius: 4px;
    background: #f1f3f4;
    font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  pre {
    padding: 14px 16px;
    border-radius: 8px;
    background: #f8f9fa;
    border: 1px solid #e8eaed;
    overflow-x: auto;
  }
  pre code { padding: 0; background: none; font-size: 0.85em; }
  /* Syntax colours for fenced blocks; the spans come from highlight.ts. */
  ${HIGHLIGHT_STYLES}
  blockquote {
    padding: 0 1em;
    border-left: 4px solid #dadce0;
    color: #5f6368;
  }
  table { border-collapse: collapse; display: block; overflow-x: auto; }
  th, td { padding: 7px 13px; border: 1px solid #dadce0; }
  th { background: #f8f9fa; font-weight: 600; text-align: left; }
  hr { height: 1px; margin: 1.8em 0; border: 0; background: #e0e0e0; }
  img { max-width: 100%; }

  .diagram {
    margin: 0 0 1.4em;
    padding: 16px;
    border: 1px solid #e8eaed;
    border-radius: 8px;
    background: #fff;
    overflow-x: auto;
    text-align: center;
  }
  .diagram svg { max-width: 100%; height: auto; }
  /* The box centres the picture, but a fallback shows source — which must not
     inherit that, or every line of code ends up centred. */
  .diagram pre { text-align: left; }
  /* A whole .mmd/.puml file is one diagram, so it drops the card chrome that
     separates a diagram from the prose around it in a Markdown document. */
  .diagram-page { margin: 0; padding: 0; border: 0; background: none; }
  .diagram-page img { max-width: 100%; }
  .diagram-note, .diagram-error {
    margin-top: 10px;
    font-size: 11px;
    line-height: 1.5;
    text-align: left;
  }
  .diagram-note { color: #80868b; }
  .diagram-error { color: #c5221f; }

  /* --- JSON tree: interactive with no JavaScript, via <details>. --- */
  .json {
    font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .json summary {
    list-style: none;
    cursor: pointer;
    border-radius: 4px;
  }
  .json summary::-webkit-details-marker { display: none; }
  .json summary::before {
    content: "▾";
    display: inline-block;
    width: 1.1em;
    margin-left: -1.1em;
    color: #80868b;
  }
  .json details:not([open]) > summary::before { content: "▸"; }
  .json summary:hover { background: #f1f3f4; }
  .json details[open] > summary .j-collapsed { display: none; }
  .json .j-node, .json .j-leaf { padding-left: 1.1em; }
  .json .j-list {
    margin-left: 0.3em;
    padding-left: 0.9em;
    border-left: 1px solid #e8eaed;
  }
  .json .j-close { padding-left: 1.1em; }
  .json .j-key { color: #1967d2; }
  .json .j-index { color: #80868b; }
  .json .j-string { color: #137333; white-space: pre-wrap; }
  .json .j-number { color: #b06000; }
  .json .j-boolean { color: #9334e6; }
  .json .j-null { color: #5f6368; font-style: italic; }
  .json .j-punct { color: #80868b; }
  .json .j-count { color: #5f6368; }
  .j-error, .j-note {
    margin: 0 0 16px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
  }
  .j-error { background: #fce8e6; color: #a50e0e; }
  .j-note { background: #e8f0fe; color: #174ea6; }
`

/** Renders one mermaid source to an SVG string, or rejects. */
export type MermaidRenderer = (source: string, index: number) => Promise<string>

/** Fetches a rendered diagram URL and returns a data: URI, or rejects. */
export type DiagramFetcher = (url: string) => Promise<string>

export interface BuildOptions {
  expand?: JsonExpand
  diagrams?: DiagramSettings
  renderMermaid?: MermaidRenderer
  fetchDiagram?: DiagramFetcher
  /** Whether an HTML file's linked resources are built into it, and from where. */
  assets?: AssetSettings
  fetchAsset?: AssetFetcher
  /**
   * Told what the inlining actually managed, so the modal can say which host to
   * allow when a file still comes out unstyled. It is reported to the extension's
   * own UI rather than written into the document — an `html` attachment is the
   * sender's document, and this extension does not add to it.
   */
  onAssetReport?: (result: InlineResult) => void
}

const ALL_DIAGRAMS: DiagramSettings = {
  mermaid: true,
  plantUml: true,
  plantUmlServer: 'https://www.plantuml.com/plantuml',
}

export async function buildDocument(
  text: string,
  kind: AttachmentKind,
  options: BuildOptions = {},
): Promise<string> {
  // The file is the document. The only thing that may happen to it is having the
  // resources it links to built in — and only when the user has switched that on,
  // for hosts they have allowed. Off, it is returned byte for byte as before.
  if (kind === 'html') {
    if (!options.assets?.enabled || !options.fetchAsset) return text

    const result = await inlineRemoteAssets(text, {
      hosts: options.assets.hosts,
      fetchAsset: options.fetchAsset,
    })
    options.onAssetReport?.(result)
    return result.html
  }

  const body = await renderBody(text, kind, options)

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<style>${DOCUMENT_STYLES}</style>`,
    `</head><body>${body}</body></html>`,
  ].join('')
}

async function renderBody(
  text: string,
  kind: Exclude<AttachmentKind, 'html'>,
  options: BuildOptions,
): Promise<string> {
  switch (kind) {
    case 'markdown':
      return `<div class="markdown">${await renderMarkdownBody(text, options)}</div>`
    case 'json':
      return renderJson(text, options.expand ?? 'auto')
    default:
      return renderDiagramBody(text, kind, options)
  }
}

/**
 * A whole `.mmd` or `.puml` file as a single diagram.
 *
 * The source is not wrapped in a synthetic fenced block and pushed through the
 * markdown renderer, tempting as that is: a diagram source containing ``` would
 * close the fence early and the rest of the file would render as prose.
 *
 * When the matching diagram switch is off the file still opens — as its source,
 * with a note saying why. That is the point of keeping the two settings apart:
 * for PlantUML, "off" specifically means the source must not be sent anywhere,
 * and showing it locally honours that while still being useful.
 */
async function renderDiagramBody(
  source: string,
  kind: DiagramKind,
  options: BuildOptions,
): Promise<string> {
  const settings = options.diagrams ?? ALL_DIAGRAMS
  const enabled = kind === 'mermaid' ? settings.mermaid : settings.plantUml
  if (!enabled) return diagramDisabled(source, kind)

  return settle(source, async () => {
    if (kind === 'mermaid') {
      if (!options.renderMermaid) throw new Error('Diagram rendering is unavailable.')
      return `<div class="diagram diagram-page">${await options.renderMermaid(source, 0)}</div>`
    }

    if (!options.fetchDiagram) throw new Error('Diagram rendering is unavailable.')
    const dataUri = await options.fetchDiagram(await plantUmlUrl(settings.plantUmlServer, source))
    return [
      '<div class="diagram diagram-page">',
      `<img src="${escapeHtml(dataUri)}" alt="PlantUML diagram">`,
      `<div class="diagram-note">Rendered by ${escapeHtml(hostOf(settings.plantUmlServer))}`,
      ' — this file’s source was sent there.</div>',
      '</div>',
    ].join('')
  })
}

/** The switch for this diagram kind is off, so the file is shown as source. */
function diagramDisabled(source: string, kind: DiagramKind): string {
  const note =
    kind === 'mermaid'
      ? 'Mermaid rendering is switched off in this extension’s settings, so the file is shown as source.'
      : 'PlantUML rendering is switched off in this extension’s settings, so the file is shown as ' +
        'source. Drawing it would have meant sending the source to a PlantUML server.'

  return `<div class="j-note">${note}</div><pre><code>${escapeHtml(source)}</code></pre>`
}

async function renderMarkdownBody(text: string, options: BuildOptions): Promise<string> {
  const settings = options.diagrams ?? ALL_DIAGRAMS
  const { html, mermaid, plantUml } = renderMarkdown(text, {
    mermaid: settings.mermaid,
    plantUml: settings.plantUml,
  })

  if (mermaid.length === 0 && plantUml.length === 0) return html

  // Both kinds resolve concurrently, and one failure must not cost the reader
  // the rest of the document.
  const [mermaidHtml, plantUmlHtml] = await Promise.all([
    Promise.all(
      mermaid.map((source, index) =>
        settle(source, async () => {
          if (!options.renderMermaid) throw new Error('Diagram rendering is unavailable.')
          return `<div class="diagram">${await options.renderMermaid(source, index)}</div>`
        }),
      ),
    ),
    Promise.all(
      plantUml.map((source) =>
        settle(source, async () => {
          if (!options.fetchDiagram) throw new Error('Diagram rendering is unavailable.')
          const dataUri = await options.fetchDiagram(await plantUmlUrl(settings.plantUmlServer, source))
          return [
            '<div class="diagram">',
            `<img src="${escapeHtml(dataUri)}" alt="PlantUML diagram">`,
            `<div class="diagram-note">Rendered by ${escapeHtml(hostOf(settings.plantUmlServer))}`,
            ' — this diagram\u2019s source was sent there.</div>',
            '</div>',
          ].join('')
        }),
      ),
    ),
  ])

  // The placeholders are emitted by this codebase, so their exact shape is known.
  return html
    .replace(
      /<div class="diagram" data-mermaid="(\d+)"><\/div>/g,
      (placeholder, index: string) => mermaidHtml[Number(index)] ?? placeholder,
    )
    .replace(
      /<div class="diagram" data-plantuml="(\d+)"><\/div>/g,
      (placeholder, index: string) => plantUmlHtml[Number(index)] ?? placeholder,
    )
}

async function settle(source: string, render: () => Promise<string>): Promise<string> {
  try {
    return await render()
  } catch (error) {
    return diagramFallback(source, error instanceof Error ? error.message : String(error))
  }
}

function hostOf(server: string): string {
  try {
    return new URL(server).host
  } catch {
    return server
  }
}

/** Shows the diagram source rather than an empty box when rendering fails. */
function diagramFallback(source: string, message: string): string {
  return [
    '<div class="diagram">',
    `<pre><code>${escapeHtml(source)}</code></pre>`,
    `<div class="diagram-error">${escapeHtml(message)}</div>`,
    '</div>',
  ].join('')
}

export { escapeHtml }
