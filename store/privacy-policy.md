# Privacy Policy — GChat Preview Files

**Last updated: 13 August 2026**

GChat Preview Files is a Chrome extension that renders `.html`, `.md`, `.json`,
`.mmd` and `.puml` attachments inline in Google Chat. This policy describes every piece of data the
extension touches and where it goes.

## The short version

The extension has no server, no account, no analytics and no telemetry. Nothing
is collected about you, and nothing is sent anywhere except in the three
situations described below. Two of the three are optional: one is on by default
and can be switched off, and one is off until you switch it on.

## What the extension handles

**Attachment content.** When you click *Preview* on an attachment, the extension
requests that file from Google's own attachment endpoint using your existing
browser session, and renders it inside a sandboxed frame in your browser. The
file content stays in memory for as long as the preview is open. It is not
stored, not written to disk by the extension, not logged, and not transmitted to
the developer or to any third party.

**Your settings.** Your choices on the options page — which file types get a
Preview button, whether HTML previews start with scripts enabled, whether Mermaid
and PlantUML diagrams render, the PlantUML server address, whether linked
resources in HTML previews are loaded and from which hosts, the JSON expand depth
and the maximum file size — are stored using Chrome's `storage.sync`. That means
they are held in your own Google account so they follow you between machines. The
developer has no access to them. No file content is ever written to storage.

## What leaves your browser

**1. The attachment request.** Fetching the file you asked to preview goes to
Google's own servers, the same ones Google Chat would use if you had clicked
Download. Nothing is added to that request.

**2. PlantUML diagram source — only if you leave PlantUML enabled.** PlantUML has
no browser renderer, so a ```` ```plantuml ```` block inside a previewed Markdown
file, or a previewed `.puml` file, can only be drawn by a PlantUML server. When
one is present, the extension
sends **the source text of that diagram** — not the rest of the file, and nothing
about you — to the PlantUML server configured in the settings. By default that is
the public server at `https://www.plantuml.com/plantuml`, which is operated by a
third party under [its own terms](https://plantuml.com/). Its handling of that
data is outside the developer's control.

You have three ways to change this:

- turn PlantUML rendering off in the options page, and no diagram source ever
  leaves your machine — a `.puml` file then opens showing its source instead;
- point the setting at a PlantUML server inside your own network; or
- leave it as it is, having read this.

Mermaid diagrams are rendered locally and are never sent anywhere.

**3. Linked resources in an HTML preview — only if you switch this on.** This is
off when you install the extension and stays off until you enable it and name the
hosts you trust. An HTML attachment often links to a stylesheet, font, image or
script on a CDN. With the setting on, the extension downloads those files — over
`https`, **without cookies or any other credentials** — and builds them into the
preview before it is shown.

What that discloses, stated exactly: a host you have allowed learns your IP
address and that you opened a file linking to it, at roughly the time you opened
it. Nothing else. Only the URLs the sender already wrote into the file are
requested, only from hosts on your list, and only once, before the page is
displayed. Each host on that list is a Chrome permission you granted, and turning
the setting off gives those permissions back.

There is no fourth case, and case 3 does not widen the first three. Previewed file
content itself still cannot make network requests at all: the preview runs under a
Content Security Policy of `default-src 'none'` with `connect-src 'none'` and
`form-action 'none'`, which blocks fetch, XHR, WebSockets, beacons, remote images,
remote fonts, remote scripts and form submissions from inside a previewed file.
That is why the resources are fetched by the extension and embedded, rather than
by letting the page reach the network: whatever a previewed file does while you
read it, it has no way to send what it sees anywhere.

## What the extension never does

- No analytics, tracking, fingerprinting or usage reporting of any kind.
- No selling or transfer of user data to third parties.
- No use of your data for advertising, credit scoring or lending decisions.
- No use of your data for anything unrelated to previewing the attachment you
  clicked on.
- No reading of your chat messages. The extension looks only at attachment cards,
  to find the file name and the attachment URL.

## Permissions and why they exist

| Permission | Why |
| --- | --- |
| `storage` | Saving your options-page preferences. Preferences only. |
| `chat.google.com`, `mail.google.com` | The two places Google Chat runs; needed to add the Preview button and fetch the attachment. |
| `*.googleusercontent.com`, `*.usercontent.google.com`, `drive.google.com` | Google's file-serving hosts, which the attachment request is redirected to. |
| `www.plantuml.com` | Drawing PlantUML diagrams, as described above. |
| Optional `https://*/*` | Never requested at install, and never requested in full. Requested only for the specific hosts you name — a self-hosted PlantUML server, or the CDN hosts on your linked-resources list — at the moment you save that setting. Declining abandons the setting, and switching the setting off releases the hosts again. |

## Children

The extension is a workplace tool and is not directed at children under 13.

## Changes

Any change to this policy will be published at this URL with an updated date, and
a change affecting what leaves your browser will also be described in the
extension's Chrome Web Store release notes.

## Contact

Questions about this policy: **dieuhd@hblab.vn**
