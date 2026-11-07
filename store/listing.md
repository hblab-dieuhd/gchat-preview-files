# Chrome Web Store listing — paste-ready copy

Every field below maps to one input in the Developer Dashboard. Character limits
are the Store's, counted as written.

---

## Store listing tab

### Item name (max 75)

```
File Preview for Google Chat & Drive
```

The Store shows the name in `public/manifest.json` once the item exists, so keep the
two identical. See "Naming and trademark" in [README.md](README.md).

### Short description (max 132)

```
Preview .html, .md, .json and diagram files inside Google Chat, and .html and diagram files in Google Drive. No download needed.
```

(130 characters.)

### Detailed description (max 16,000)

```
Someone drops an .html report, a .md spec or a .json export into a Google Chat
thread, and reading it costs you four steps: download, find it in Downloads,
open it, come back. This extension adds a Preview button next to the attachment
and shows you the file in place.

WHAT IT PREVIEWS

• HTML — rendered as the page it is, exactly as the sender built it.
• Markdown — headings, lists, tables, code blocks and links, properly rendered
  rather than shown as source. Fenced code is syntax-coloured in around 25
  languages: JavaScript, TypeScript, Python, Java, Kotlin, Dart, Go, Rust, PHP,
  Ruby, C, C++, C#, Swift, SQL, shell, JSON, YAML, HTML, CSS, SCSS, Dockerfile,
  diff and more. A fence tagged with something unrecognised stays a plain code
  block rather than being coloured wrongly.
• Mermaid and PlantUML files — a whole .mmd or .puml attachment opens as the
  diagram itself, not as text. Mermaid is drawn on your own machine. Turn drawing
  off in the settings and the file still opens, showing its source, so a PlantUML
  file can be read without its source going anywhere.
• JSON — a collapsible tree with syntax colouring, array indices and key counts,
  plus Expand all and Collapse all. A file that fails to parse still opens: you
  get the parse error above the raw text, because seeing why it is broken is
  usually the point.

Plain .txt is deliberately left alone — Google Chat already previews it, and a
second button next to Google's own preview would only be noise.

DIAGRAMS IN MARKDOWN

Fenced ```mermaid blocks are drawn as flowcharts, sequence diagrams and the rest,
rendered entirely on your own machine — nothing is sent anywhere. Fenced
```plantuml blocks are drawn too; PlantUML has no browser renderer, so those
send the diagram source to a PlantUML server. That is on by default using the
public plantuml.com, and you can switch it off or point it at a server inside
your own network. Mermaid diagrams never leave your browser.

BUILT FOR FILES YOU DID NOT WRITE

Anyone in a chat can send you a file, so every previewed file is treated as
hostile.

• It cannot reach your Google session. The preview renders in a doubly sandboxed
  iframe with no same-origin access — your cookies, the Chat page and the
  extension's own APIs are all out of reach. The file's markup is never inserted
  into the Google Chat page.
• It cannot phone home. Network access inside a preview is switched off at the
  Content Security Policy level: no fetch, no XHR, no WebSocket, no form posts,
  no popups, no remote images, fonts or scripts. Nothing a previewed file
  observes can leave your browser. That holds whether or not you switch on the
  linked-resources setting below — it never gives the page network access, it
  only has the extension fetch and embed the files beforehand.
• Its scripts do not run until you say so. HTML previews start fully static and
  gain scripting only when you click Enable scripts on that specific preview. A
  page that cannot run code cannot capture what you type, which is what makes a
  fake login form in an attachment harmless. Markdown and JSON previews have no
  such toggle at all — the extension builds those documents itself and escapes
  every tag, so a JSON value containing <script> is just characters on screen.

LINKED RESOURCES FROM A CDN

The cost of that last rule, stated plainly: a file that pulls its styling, fonts
or scripts from a CDN renders without them, as unformatted text.

If you would rather see those files the way they were written, you can switch it
on and list the hosts you trust — the common CDNs are suggested for you. The
extension then downloads what the file links to, over https and without your
cookies, and builds it into the preview before showing it. The page itself still
reaches nothing; what changes is that a host you allowed can tell you opened a
file linking to it. That is why it is off until you turn it on, limited to hosts
you name, and why turning it back off hands those permissions back.

SETTINGS

Open the options page from chrome://extensions to choose which file types get a
Preview button, whether HTML previews start with scripts enabled (off by
default), whether linked resources are loaded and from which hosts (off by
default), whether Mermaid and PlantUML render, which PlantUML server to use, how
much of a JSON tree opens by default, and the maximum file size to preview
(5 MB by default).

PRIVACY

The extension has no analytics, no account, no server of its own, and sends
nothing anywhere except the three cases it tells you about: fetching the
attachment you asked to preview from Google's own servers; if you leave PlantUML
enabled, the source of a PlantUML diagram to the PlantUML server you have
configured; and if you switch linked resources on, the files an HTML attachment
links to, from the hosts you allowed. Full policy: https://hblab-dieuhd.github.io/gchat-preview-files/

Not affiliated with, endorsed by, or sponsored by Google. Google Chat is a
trademark of Google LLC.
```

> Replace `<PRIVACY_POLICY_URL>` before pasting.

### Category

`Workflow & Planning`

### Language

`English`

---

## Graphics tab

| Asset | Size | Required | Status |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Yes | ✅ `public/icons/icon128.png` |
| Screenshots | 1280×800 PNG/JPEG, 1–5 | Yes (≥1) | ❌ must be captured |
| Small promo tile | 440×280 PNG | No | ❌ optional |
| Marquee promo tile | 1400×560 PNG | No | ❌ optional |

**Screenshots to capture** — 1280×800, from a real Chat thread, in this order.
The first one is the thumbnail shown in search results, so it carries the pitch.

1. **The Preview button in context** — a Chat message with an `.html` attachment
   card, the extension's Preview button visible next to it. This is the "what
   does it add" shot.
2. **An HTML preview open** — the modal over the Chat window, showing a rendered
   report. Include the *Enable scripts* control so the security story is visible.
3. **A Markdown preview with a Mermaid diagram** — proves the rendering is real,
   not a text dump.
4. **The JSON tree** — a few levels expanded, array indices and key counts
   visible, Expand all / Collapse all in shot.
5. **The options page** — one screenshot of the settings, so the permissions
   story ("you can turn PlantUML off") is visible before install.

Blur or replace any real colleague names, avatars and message text before
uploading. The screenshots are public.

---

## Privacy tab

### Single purpose description

```
Previews files rendered in place in Google Chat and Google Drive (.html, .md,
.json and diagram files in Chat; .html and diagram files in Drive), so they can be
read without downloading the file and opening it locally.
```

### Permission justifications

Paste each into the box next to the matching permission.

**`storage`**

```
Stores the user's own preferences from the options page — which file types get a
Preview button, whether HTML previews start with scripts enabled, whether linked
resources are loaded and from which hosts, whether Mermaid and PlantUML diagrams
render, the PlantUML server address, the JSON expand depth and the maximum file
size. Preference data only; no file content and no user data is ever written to
storage.
```

**Host permission — `https://chat.google.com/*`, `https://mail.google.com/*`**

```
These are the two places Google Chat runs: chat.google.com and Chat embedded in
Gmail at mail.google.com/chat. The extension needs to run on those pages to spot
attachment cards and add the Preview button, and needs to fetch the attachment
bytes from the get_attachment_url endpoint that serves them.
```

**Host permission — `https://*.googleusercontent.com/*`,
`https://*.usercontent.google.com/*`, `https://drive.google.com/*`**

```
Google's attachment endpoint answers with a cross-origin redirect to whichever
file-serving host holds the file. A fetch that is not permitted for the redirect
target dies at the redirect, so every possible target host must be listed. These
are Google's own file-serving hosts; the extension only ever requests the exact
attachment URL the user clicked Preview on.

drive.google.com is also a page the extension runs on: it adds a Preview button
to .html, .mmd and .puml files in Google Drive, whose own viewer shows those as
source text. It reads file names and file ids from the page to decide which files
get a button. Nothing read there leaves the browser, and a file is only downloaded
when the user clicks Preview on it.
```

**Host permission — `https://www.plantuml.com/*`**

```
Renders ```plantuml code blocks found inside a previewed Markdown file. PlantUML
is a Java program with no browser renderer, so the diagram source must be sent to
a PlantUML server to be drawn; www.plantuml.com is the public default. The user
can switch this feature off entirely in the options page, or point it at a server
inside their own network. Only the diagram source travels — never the rest of the
file.
```

**Optional host permission — `https://*/*`**

```
Optional, never requested at install time, and never requested in full. It exists
so that a user can name specific hosts in the options page and grant access to
those hosts only. There are two such settings:

1. A self-hosted PlantUML server, so a team can draw diagrams without sending the
   source to the public plantuml.com.
2. Linked resources in HTML previews. An HTML attachment often references a
   stylesheet, font, image or script on a CDN, and the extension's Content
   Security Policy blocks the preview from loading any of it, so such a file
   renders as unformatted text. If the user switches this on, the extension
   fetches those URLs itself — with credentials omitted — and embeds the bytes in
   the document before rendering it. This is off by default and limited to a list
   of hosts the user maintains.

In both cases Chrome's optional-permission flow requests only the specific origins
the user typed, from inside the Save click, and the setting is abandoned if the
user declines. Switching a setting off releases the origins it was granted. The
extension never requests this pattern in full and has no code path that reaches
any host the user has not configured.

Note this does not loosen the preview's sandbox: the CSP stays default-src 'none'
with connect-src 'none', so previewed content still cannot reach any host itself.
Only the extension fetches, only URLs already written into the file by its sender,
and only before the document is rendered.
```

### Remote code

Answer: **No, I am not using remote code.**

All executable code ships inside the package (`background.js`, `content.js`,
`sandbox.js`, `options.js`, `mermaid.js`). Nothing is fetched and executed, and
there is no `eval` of downloaded source in the extension's own contexts.

If a reviewer queries this because previewed HTML can contain `<script>`, the
answer is:

```
Previewed file content is data the user asked to view, not extension code. It is
rendered inside a manifest-declared sandboxed page in an opaque origin, in a
nested iframe built with sandbox="" — every restriction on. Scripts in the file do
not execute unless the user clicks Enable scripts on that individual preview, and
even then they run only inside that opaque-origin frame, under a CSP of
default-src 'none' with connect-src 'none' and form-action 'none'. They cannot
reach the extension's APIs, the Google Chat page, the user's cookies, or the
network.
```

### Data usage — what the extension collects

Tick these:

- ☑ **Personal communications** — the contents of attachments sent in chat pass
  through the extension in order to be rendered.
- ☑ **Website content** — same reason.

Leave unticked: PII, health, financial and payment, authentication information,
location, web history, user activity.

### Certifications — all three can be certified

- ☑ I do not sell or transfer user data to third parties, outside of the approved
  use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes

> The one transfer to a third party — PlantUML diagram source going to a PlantUML
> server — falls under the approved "necessary to the user-facing feature the user
> requested" case: it is what draws the diagram, the user can switch it off, and
> it is disclosed in both the description and the privacy policy. Do not skip
> either disclosure.

### Privacy policy URL

Required, because data collection is disclosed above. Host
[privacy-policy.md](privacy-policy.md) at a public URL you control and paste it
here.

---

## Distribution tab

| Field | Value |
| --- | --- |
| Visibility | `Public` (or `Unlisted` for an HBLAB-internal rollout) |
| Distribution | All regions, unless HBLAB wants otherwise |
| Pricing | Free |
