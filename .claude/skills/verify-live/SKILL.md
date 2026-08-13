---
name: verify-live
description: Verify a build against live Google Chat — rebuild, relaunch the test Chrome with the fresh dist/, open the test space, and click through a Preview button for every attachment kind. Use after any change to src/ or public/, and whenever asked to check something works in the real UI rather than only in tests.
---

# Verify against live Google Chat

`npm test` covers the string-in/string-out paths. It cannot cover the two places
this extension actually breaks: detection against Chat's real markup, and what
the document looks like once it is in the frame. This is the loop for those.

## Prerequisites (one-time, done by the user — do not try to automate)

- The test profile at `~/.gchat-preview-test-profile` is signed in to the Google
  account that can see the test space. Sign-in cannot be scripted, and must not
  be worked around by pointing the debugging port at the everyday Chrome profile.
- A Chat space exists containing the five fixtures from [samples/](../../../samples/)
  — one per kind. Ask the user for its URL if it is not in memory. The fixtures carry
  their own "Expected" lines; read those rather than judging by whether it looks nice.

## The loop

1. **Build.** `npm run verify` — this is `npm run build` (typecheck + test + clean
   + all five bundles) followed by `scripts/test-chrome.mjs`. If typecheck or the
   tests fail, stop and report; do not launch a browser on a build that failed.

   Relaunching the browser **is** the extension reload — Chrome reads the unpacked
   extension from disk at load time. There is no hot reload, so every rebuild
   needs this script again, and a preview showing old behaviour is almost always
   a browser that was never relaunched.

2. **Open the space.** `node scripts/test-chrome.mjs <space-url>` navigates there
   on launch. Chat's message list is virtualized, so scroll the attachments into
   view before expecting buttons — a card that has never been mounted has no
   button because it has no DOM.

3. **Drive it.** Two routes, in order of preference:
   - The `chrome-devtools` MCP server, already registered against
     `http://127.0.0.1:9222`. Its tools only appear in sessions started **after**
     the browser is up, so if they are missing, use the CDP route rather than
     restarting anything.
   - Plain CDP from a scratch Node script — `fetch` `/json/version` for the
     websocket URL, `Target.attachToTarget` with `flatten: true`, then
     `Runtime.evaluate` / `Input.dispatchMouseEvent` / `Page.captureScreenshot`.
     Save the screenshot as a PNG and Read it; that is how to actually *see* the
     preview rather than assert about it.

4. **Check each kind.** Per attachment: a Preview button appears, the modal opens,
   and the content is right. What "right" means differs by kind, and the
   differences are the whole point of the kind split:

   | Kind | What to confirm |
   | --- | --- |
   | `.html` | Renders as the document. Scripts are **off** — the *Enable scripts* control is present and the page is static until it is used |
   | `.md` | Headings/lists/tables render; a fenced block with a language tag is coloured; raw HTML in the source shows as text, not markup |
   | `.json` | The `<details>` tree opens to depth 2; expand-all and collapse-all re-render; array items show their index |
   | `.mmd` | Draws as a diagram, not source |
   | `.puml` | Draws as an image (served as a `data:` URI through the worker, never an external `img src`) |

   Also worth one pass with diagrams switched off in the options page: `.mmd` and
   `.puml` must open showing their source with the note explaining why, because
   that is the behaviour the privacy promise rests on.

5. **Read the consoles when something is blank.** The failure is almost never
   where it looks. Check, in this order: the service worker (fetch/CORS,
   `url_type` fallbacks — every failed attempt is logged with its host and path),
   the Chat tab (detection, relay), and the sandbox page. A blank pane with a
   silent worker usually means detection never fired, not that rendering broke.

## Reporting

Say which kinds were confirmed **in the live UI** and which were not exercised.
`CLAUDE.md` tracks a "Verification status" line that has been honest about only
HTML being confirmed end to end — keep it that way, and update it when a kind
genuinely passes here.
