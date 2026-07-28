import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * Syntax colouring for fenced code blocks in Markdown previews.
 *
 * The colouring has to be baked into the document as `<span>`s here, at build
 * time. The frame that renders the document is built with `sandbox=""`, so a
 * client-side highlighter injected into the document would never run — the same
 * constraint that shapes the JSON tree.
 *
 * Languages are registered one by one rather than importing the package root.
 * The root registers all ~190 grammars; this list is the ones a file shared in a
 * work chat plausibly contains, and it is a tenth of the size. An unregistered
 * language is not an error — `highlight` returns null and the caller falls back
 * to a plain escaped code block, which is exactly what shipped before.
 *
 * hljs resolves aliases itself, so this list covers more than it looks: `js`,
 * `jsx` and `mjs` reach `javascript`, `ts`/`tsx` reach `typescript`, `html` and
 * `svg` reach `xml`, `sh`/`zsh` reach `bash`, `toml` reaches `ini`, `yml`
 * reaches `yaml`, `py` reaches `python`, `md` reaches `markdown`.
 */

const LANGUAGES: Record<string, unknown> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition as Parameters<typeof hljs.registerLanguage>[1])
}

/**
 * Colours one code block, or returns null when the language is unknown.
 *
 * Null is a normal outcome, not a failure: a fence tagged with something not in
 * the list above, or with nothing at all, stays a plain code block. Auto
 * detection is deliberately not attempted — it guesses wrong often enough on
 * short snippets that mislabelled colouring would be worse than none.
 *
 * The returned string is HTML. hljs escapes the source as it tokenises, so what
 * comes back is markup-free apart from its own `<span>`s; `highlight.test.ts`
 * pins that, because this string is inserted into the document unescaped.
 */
export function highlight(source: string, lang: string): string | null {
  const name = lang.trim().toLowerCase()
  if (!name || !hljs.getLanguage(name)) return null

  try {
    // ignoreIllegals: a snippet is usually a fragment, not a whole valid file,
    // and a fragment that trips a grammar's illegal rule should still get colour.
    return hljs.highlight(source, { language: name, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

/** True when a fence's language tag will actually produce colouring. */
export function isHighlightable(lang: string): boolean {
  const name = lang.trim().toLowerCase()
  return Boolean(name) && Boolean(hljs.getLanguage(name))
}

/**
 * The theme, as a stylesheet fragment for the generated document.
 *
 * Written by hand rather than imported from `highlight.js/styles/*.css` for two
 * reasons: those themes style `.hljs` itself with their own background and
 * padding, which would fight the `pre` rules already in the document, and Vite
 * would have to inline a CSS asset into an IIFE bundle to get it here.
 *
 * The palette is the one the JSON tree already uses, so a `.md` file and a
 * `.json` file previewed side by side agree on what a string looks like.
 */
export const HIGHLIGHT_STYLES = `
  .hljs-comment,
  .hljs-quote { color: #80868b; font-style: italic; }

  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-literal,
  .hljs-type,
  .hljs-built_in,
  .hljs-doctag { color: #9334e6; }

  .hljs-string,
  .hljs-regexp,
  .hljs-char.escape_,
  .hljs-addition { color: #137333; }

  .hljs-number,
  .hljs-symbol,
  .hljs-bullet,
  .hljs-link { color: #b06000; }

  .hljs-title,
  .hljs-title.class_,
  .hljs-title.function_,
  .hljs-section,
  .hljs-name,
  .hljs-selector-id,
  .hljs-selector-class { color: #1967d2; }

  .hljs-attr,
  .hljs-attribute,
  .hljs-variable,
  .hljs-template-variable,
  .hljs-property,
  .hljs-params { color: #b31412; }

  .hljs-meta,
  .hljs-meta .hljs-keyword,
  .hljs-tag,
  .hljs-punctuation,
  .hljs-operator { color: #5f6368; }

  .hljs-deletion { color: #c5221f; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }
`
