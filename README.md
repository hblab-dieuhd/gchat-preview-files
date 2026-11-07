# File Preview for Google Chat & Drive

A Chrome extension (Manifest V3) that adds a **Preview** button next to `.html`, `.md`, `.json`, `.mmd` and `.puml` attachments in Google Chat, so you can read them in place instead of downloading the file and opening it from your Downloads folder.

- **Markdown** is rendered — headings, lists, tables, code blocks and links — not shown as source.
- **Code blocks are syntax-coloured**, in about 25 languages and their usual aliases. A fence tagged with something unrecognised, or with nothing, stays a plain code block rather than being guessed at.
- **Diagrams in Markdown** render too: ```` ```mermaid ```` flowcharts and sequence diagrams are drawn locally on your machine, and ```` ```plantuml ```` blocks are drawn by plantuml.com.
- **Diagram files** open as the diagram: a whole `.mmd`/`.mermaid` file drawn locally, or a `.puml`/`.plantuml`/`.pu`/`.iuml`/`.wsd` file drawn by a PlantUML server. Turn drawing off and the file still opens, showing its source — so a PlantUML file can be read without its source going anywhere.
- **JSON** opens as a collapsible tree with syntax colouring, array indices and key counts, plus *Expand all* / *Collapse all*. Broken JSON still opens, showing the parse error above the raw file.

Plain `.txt` is left alone — Google Chat already previews it.

**In Google Drive**, `.html`, `.mmd` and `.puml` files get the same button, in the file list, the grid, and the viewer — which otherwise shows these files as source text. `.md` and `.json` are not offered there.

**A note appears above an HTML preview only when there is something to say.** The file is read on your machine before it is shown, and the note names what was found: scripts, a password field, a page that looks like a sign-in, or scripts that look deliberately disguised. No note does not mean a file is safe, only that nothing was found. The sandbox is what protects you, either way.

## Settings

Right-click the extension → **Options**, or open it from `chrome://extensions`. You can choose which file types get a Preview button, whether scripts start enabled in HTML previews (off by default), whether Mermaid and PlantUML diagrams render, which PlantUML server to use, how much of a JSON tree opens by default, and the size limit.

## Install for development

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Open [chat.google.com](https://chat.google.com) and reload the tab.

While iterating, `npm run dev` rebuilds on save. Chrome still needs the reload icon on the extension card, plus a hard reload of the Chat tab, to pick up changes.

## How it works

Attachment bytes are fetched by the background service worker, passed to the content script as an inert string, and rendered inside a doubly-sandboxed iframe that has no access to Google Chat, the extension, or your cookies. The attachment's HTML is never inserted into the Chat page. Files over 5 MB are refused.

## Security

A previewed file is treated as hostile, because anyone can send you one.

- **It cannot touch your Google session.** Both frames run in opaque origins with no `allow-same-origin`, so cookies, the Chat DOM, and the extension's APIs are all out of reach.
- **It cannot phone home.** The sandbox CSP is `default-src 'none'`; images and fonts must be inlined as `data:` URIs, and network calls, form posts, popups and remote scripts are all blocked. Nothing a previewed file learns can leave your browser.
- **Its scripts do not run** until you click **Enable scripts** on that preview. Without scripts a file cannot capture what you type, which is what makes a fake login page in an attachment harmless. Markdown and JSON previews have no such toggle: the extension builds those documents itself and escapes every tag in them, so a JSON value full of `<script>` is just characters on screen. The JSON tree stays clickable anyway — it is built from `<details>`, which needs no JavaScript.

**One thing worth knowing:** PlantUML has no browser renderer, so `plantuml` blocks send their diagram source to a PlantUML server to be drawn — by default the public plantuml.com. Mermaid diagrams never leave your machine. If your diagrams describe internal systems, either switch PlantUML off in the settings or point it at a server inside your own network; Chrome will ask for permission to reach it.

The other cost: files that pull images, fonts, or libraries from a CDN will render without them.

## Status

HTML previews are confirmed working end to end against a live Google Workspace account. The Markdown, JSON and diagram paths have been rendered through the real `dist/sandbox.html` in headless Chrome, but not yet opened from a live Chat attachment.

Detection is built around the real markup Google Chat emits — a thumbnail `<img>` whose `src` points at `get_attachment_url` and whose `alt` is the file name — and `npm test` pins that logic. It is also the part that will break when Google ships a Chat update: if the Preview button stops appearing, `src/content/detector.ts` is where to look.

## Releasing

`npm run package` produces `release/gchat-preview-files-<version>.zip`, ready to upload. See [store/README.md](store/README.md) for the Chrome Web Store checklist, [store/listing.md](store/listing.md) for the listing copy, and [store/privacy-policy.md](store/privacy-policy.md) for the policy that needs hosting.
