import { defineConfig } from 'vite'

/**
 * Each extension entry point is built as a separate, self-contained IIFE bundle.
 *
 * Why three passes instead of one multi-entry build: MV3 content scripts declared
 * in the manifest are NOT loaded as ES modules, so they cannot use `import` at
 * runtime and must be bundled into a single file. Rollup only emits `iife` for a
 * single input, so each entry gets its own `vite build --mode <target>` pass.
 * Keeping the service worker and the sandbox page on the same IIFE format means
 * no entry point depends on module loading, which also avoids ES-module fetches
 * from the sandbox page's opaque origin.
 */
const TARGETS = {
  background: { entry: 'src/background/index.ts', fileName: 'background.js' },
  content: { entry: 'src/content/index.ts', fileName: 'content.js' },
  sandbox: { entry: 'src/sandbox/sandbox.ts', fileName: 'sandbox.js' },
  options: { entry: 'src/options/index.ts', fileName: 'options.js' },
  // Loaded on demand by the sandbox page, not from the manifest: mermaid is
  // ~3.2 MB and only markdown files with diagrams should pay for it.
  mermaid: { entry: 'src/sandbox/mermaid-entry.ts', fileName: 'mermaid.js' },
} as const

export default defineConfig(({ mode }) => {
  const target = TARGETS[mode as keyof typeof TARGETS]
  if (!target) {
    throw new Error(
      `Unknown build mode "${mode}". Expected one of: ${Object.keys(TARGETS).join(', ')}.`,
    )
  }

  return {
    // public/ (manifest, icons, sandbox.html) only needs copying once per build.
    publicDir: mode === 'background' ? 'public' : false,
    build: {
      outDir: 'dist',
      // Passes run sequentially into the same dist/; `npm run build` cleans first.
      emptyOutDir: false,
      target: 'chrome120',
      // Readable output makes Chrome Web Store review and DevTools debugging easier.
      // Mermaid is far too large to ship unminified.
      minify: mode === 'mermaid',
      rollupOptions: {
        input: target.entry,
        output: {
          format: 'iife',
          entryFileNames: target.fileName,
        },
      },
    },
  }
})
