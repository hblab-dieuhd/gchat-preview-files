/**
 * highlight.js ships types for its package root but declares no `types`
 * condition on the `./lib/core` and `./lib/languages/*` subpaths, which is what
 * this file fills in.
 *
 * Importing the root instead would type-check without this — and pull in all
 * ~190 bundled languages, several megabytes of grammars, into a bundle that
 * loads on every preview. The subpath imports are the point; these declarations
 * are the cost of using them.
 */

declare module 'highlight.js/lib/core' {
  import type { HLJSApi } from 'highlight.js'
  const hljs: HLJSApi
  export default hljs
}

declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const language: LanguageFn
  export default language
}
