# Sample attachments

Six files — one per `AttachmentKind`, plus one for the `remoteAssets` path — for
verifying a build against live Google Chat. Upload all six into a test space and run
the [verify-live](../.claude/skills/verify-live/SKILL.md) checklist against them.

They are fixtures, not demos. Each one is aimed at a rule that has broken before or
that the security posture rests on, so a file that renders *prettily* is not the same
as a file that passes — read the "Expected" lines inside each one.

| File | What it is aimed at |
| --- | --- |
| `sample.html` | Scripts off by default, `img-src` closing the beacon channel, `form-action 'none'`, no frame escape |
| `sample.md` | The double-escaping trap, scheme filtering incl. `java<TAB>script:`, highlighting incl. unknown languages, raw HTML shown as text |
| `sample.json` | Escaping of keys *and* values, `AUTO_OPEN_DEPTH`, array index labels, expand-all reaching every level |
| `sample.mmd` | A whole file as one diagram, drawn locally; source shown when drawing is off |
| `sample.puml` | The deflate URL path — deliberately large enough that the old hex form would fail |
| `sample-cdn.html` | `remoteAssets`: a CDN stylesheet, a font behind `url()`, an image, a CDN script, a blocked host, and two decoys |

## The CDN fixture is an assertion sheet, not a demo

`sample-cdn.html` carries a table of "Expected" rows and the modal's warning bar is where
three of them are checked. It must name **`cdn.skypack.dev` and nothing else** — the file
also holds a `<link>` inside an HTML comment pointing at `commented-out.invalid` and one
inside a JavaScript string pointing at `in-a-string.invalid`. Either of those appearing in
the bar means the scanner rewrote inside a comment or a string literal.

Its `<img>` has `alt="a > b tick"` on purpose: a `[^>]*` attribute scan stops at that `>`,
never finds `src`, and leaves the image remote with no error anywhere. And with the whole
feature switched off the file must render as unstyled text exactly as it did before the
feature existed — that is the regression check, and it is worth running first.

## Two of them are calibrated, not arbitrary

**`sample.puml` is 6.4 KB on purpose.** The old `~h` hex URL form doubled the source and
the server answered HTTP 400 somewhere past 8 KB, so every `.puml` over roughly 3.5 KB
failed. Measured for this file: a hex URL would be 12 882 characters and would 400,
while the deflate + custom-base64 URL is 3 756. If it draws, the `CompressionStream`
path is working; if it fails, something fell back to hex. Keep it over ~4 KB if you edit it.

**`sample.mmd` has no bare `%%` lines.** A line holding nothing but `%%` is not an empty
comment to mermaid: several in a row get stripped and rejoined into `%%%%%%flowchart`,
and the parse fails on line 1. Both diagrams here were checked against the extension's
own `dist/mermaid.js`, not just eyeballed. Use a blank line to separate comment blocks.

## What the fixtures cannot tell you

They exercise rendering. They say nothing about **detection**, which is the fragile part
— that depends on Chat's markup, and the only way to test it is a real attachment in a
real space, in both the normal view and the detailed-thread view.

`sample.html` contains a deliberately fake login form. It exists to demonstrate that a
static render makes one useless, which is the reason `allowScriptsByDefault` is `false`.
It carries no third-party branding and is not meant to leave this repo.
