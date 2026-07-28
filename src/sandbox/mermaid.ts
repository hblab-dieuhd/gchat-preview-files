/**
 * Loads the mermaid bundle on demand and renders diagrams to SVG.
 *
 * The load is a plain `<script src="mermaid.js">` appended to the sandbox page.
 * That is allowed by the sandbox CSP's `script-src 'self'` — the page's URL is
 * still `chrome-extension://<id>/sandbox.html` even though its origin is opaque,
 * so the relative path resolves. Remote script loading is not an option and is
 * not wanted: nothing here may touch the network.
 */

const BUNDLE = 'mermaid.js'

let loading: Promise<void> | null = null

function loadBundle(): Promise<void> {
  if (globalThis.__gchatMermaid) return Promise.resolve()

  // One load, however many diagrams the document holds.
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = BUNDLE
    script.addEventListener('load', () => {
      if (globalThis.__gchatMermaid) resolve()
      else reject(new Error('The diagram renderer loaded but did not register itself.'))
    })
    script.addEventListener('error', () => reject(new Error('Could not load the diagram renderer.')))
    document.head.append(script)
  })

  return loading
}

/**
 * Renders one mermaid diagram. Rejects rather than returning partial output, so
 * the caller can fall back to showing the source.
 */
export async function renderMermaid(source: string, index: number): Promise<string> {
  await loadBundle()

  const renderer = globalThis.__gchatMermaid
  if (!renderer) throw new Error('The diagram renderer is unavailable.')

  // Mermaid needs a DOM id that is unique per render and valid as a CSS selector.
  return renderer.render(`gchat-diagram-${index}`, source)
}
