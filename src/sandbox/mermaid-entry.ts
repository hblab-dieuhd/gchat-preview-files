import mermaid from 'mermaid'

/**
 * Separate bundle, loaded on demand.
 *
 * Mermaid is ~3.2 MB — larger than the rest of the extension by a factor of
 * thirty. Bundling it into `sandbox.js` would make every preview, including a
 * one-line JSON file, parse all of it. So it lives in its own `mermaid.js` and
 * `src/sandbox/mermaid.ts` injects a <script> for it only when a document
 * actually contains a mermaid block.
 *
 * It runs in the sandbox page, which has `allow-scripts`, and hands back an SVG
 * string. The frame that finally displays that SVG still has `sandbox=""`, so
 * even a mermaid bug that emitted live markup could not run anything.
 */

declare global {
  // eslint-disable-next-line no-var
  var __gchatMermaid: { render(id: string, source: string): Promise<string> } | undefined
}

mermaid.initialize({
  startOnLoad: false,
  // Sanitises labels and refuses click-handler directives in the diagram source.
  securityLevel: 'strict',
  theme: 'default',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
})

globalThis.__gchatMermaid = {
  async render(id: string, source: string): Promise<string> {
    const { svg } = await mermaid.render(id, source)
    return svg
  },
}

export {}
