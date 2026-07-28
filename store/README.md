# Releasing to the Chrome Web Store

Three files live here:

| File | What it is |
| --- | --- |
| `README.md` | This checklist, plus how to automate later releases |
| [listing.md](listing.md) | Every Developer Dashboard field, paste-ready |
| [privacy-policy.md](privacy-policy.md) | The policy text, for reading in the repo |
| [privacy-policy.html](privacy-policy.html) | The same text as a standalone page — **this** is what gets hosted |

Keep the two policy files in step. The `.md` is the readable copy; the `.html` is
the one reviewers open, and it is the one that must be accurate.

## Build the upload

```bash
npm run package     # typecheck + test + clean build + zip
```

Output: `release/gchat-preview-files-<version>.zip`, with `manifest.json` at the
archive **root**.

That root placement is the whole reason `scripts/package.mjs` exists. Zipping the
`dist/` folder itself produces `dist/manifest.json` inside the archive, and the
Store rejects it with *"Manifest file is missing or unreadable"* — which reads
like a manifest bug and is not one. The old `gchat-preview-files.zip` at the
project root has this shape and cannot be uploaded; delete it.

To bump a version, change `version` in **both** `public/manifest.json` and
`package.json`. The packaging script refuses to run if they disagree, because the
Store rejects a re-upload of a version number it has already seen.

## Release notes

Paste into the version's *What's new* field in the dashboard.

### 1.1.0

Not yet uploaded — 1.0.0 was still in review when this was built, so both
features below ship together rather than as two versions.

```text
Mermaid and PlantUML files can now be previewed on their own: a .mmd or .puml
attachment opens as the diagram rather than as text. Each has its own switch in
the options page, separate from whether diagrams are drawn — with drawing off the
file still opens as source, so a PlantUML file can be read without its source
being sent anywhere.

Fenced code blocks in Markdown previews are now syntax-coloured, in around 25
languages and their usual aliases. A fence tagged with a language the extension
does not know, or with no language at all, stays a plain code block rather than
being coloured wrongly.

Fixes: attachments in the detailed thread view were not detected at all, so no
Preview button appeared for them. PlantUML diagrams larger than about 3.5 KB
failed to render because of a URL length limit. A file that failed to build now
says why instead of opening a blank pane.
```

### 1.0.0

First release.

## Before the first submission

### 1. Developer account

- A Google account with 2-Step Verification on.
- A one-time **US$5** registration fee at
  <https://chrome.google.com/webstore/devconsole>.
- Publisher verification: confirm a contact email in the dashboard. Unverified
  publishers cannot publish.
- If this ships as an HBLAB product rather than a personal one, create the item
  under a **group publisher** so it does not sit in one person's account
  permanently.

### 2. Host the privacy policy

A privacy policy URL is mandatory once you disclose data collection, and
[listing.md](listing.md) discloses it (attachment content passes through the
extension). Publish [privacy-policy.html](privacy-policy.html) anywhere public and
stable that you control — a GitHub Pages site or a page on an HBLAB domain both
work. Paste the resulting URL into the Privacy tab **and** into the placeholder
near the end of the detailed description.

**Version 1.1.0 was rejected on exactly this field** — *"Privacy policy link does
not lead to a valid privacy policy"*, reference **Purple Nickel**. The policy text
was never the problem. What the reviewer requires of the URL:

- It **lands on the policy itself**, not on a site that contains one. A company
  homepage, a docs index, or a repository root all fail, and the rejection wording
  says so outright: *owner sites are not considered valid privacy policies*. A
  GitHub repo URL fails even when the file is one click away.
- It **renders as a web page**. A raw `.md` URL
  (`raw.githubusercontent.com/…/privacy-policy.md`) serves `text/plain` and shows
  markdown syntax — that is a text file, not a policy page. Hosting the `.html` is
  what avoids this, which is why it exists.
- It is **public and unauthenticated**. No login, no Workspace-internal domain, no
  Drive or Docs link with link-sharing, no IP allowlist. Reviewers browse from
  outside HBLAB's network. Anything on `*.hblab.vn` that sits behind SSO fails.
- It returns **HTTP 200 directly**. A 404, a redirect chain, or a shortener can all
  read as broken. A fresh GitHub Pages site takes a minute or two to go live —
  check it before resubmitting, not after.
- It **names this extension** and is dated. A generic company-wide policy that
  never mentions the product is the other common bounce on this field.

Verify from outside your own browser before resubmitting — a private window is not
enough if the host is on the corporate network:

```bash
curl -sSIL "<PRIVACY_POLICY_URL>" | grep -E "^(HTTP|content-type|location)"
```

Want `HTTP/2 200` on the final hop and `content-type: text/html`.

#### Hosting it on GitHub Pages

[.github/workflows/privacy-policy.yml](../.github/workflows/privacy-policy.yml)
does this automatically. It copies `privacy-policy.html` into a one-file Pages
site, deploys it, and then curls the result to confirm `200` and `text/html` —
failing the run if either is wrong, so a broken policy URL is caught here instead
of in a review round.

**Which repo it runs in.** Pages needs a **public** repo on the free plan, and the
extension source is not being published, so the policy lives in a repo of its own:

| Repo | Contents | Visibility |
| --- | --- | --- |
| this one | the extension | private |
| `gchat-preview-files-privacy` | `privacy-policy.html` + the workflow | **public** |

The workflow is written to run unchanged in either — it publishes
`store/privacy-policy.html` if that exists, otherwise `privacy-policy.html` at the
root — so it is copied over as-is, no editing. Should this repo ever go public, the
same file already works here and the second repo can be dropped.

Creating the public one:

```bash
mkdir ../gchat-preview-files-privacy && cd ../gchat-preview-files-privacy
git init -b main
mkdir -p .github/workflows
cp ../gchat_preview_files/store/privacy-policy.html .
cp ../gchat_preview_files/.github/workflows/privacy-policy.yml .github/workflows/
git add . && git commit -m "Privacy policy for the GChat Preview Files extension"
gh repo create gchat-preview-files-privacy --public --source=. --push
```

Then, one time:

1. **Settings → Pages → Source: GitHub Actions.** Do this *before* the first run.
   Not "Deploy from a branch" — there is no `gh-pages` branch in this arrangement
   and nothing to point a branch source at; the site is uploaded as an artifact.
2. **Actions** tab → *Privacy policy* → *Run workflow*. Trigger it by hand the first
   time: a `paths` filter has no previous commit to diff against on the initial push
   to a new repo, so it may not fire on its own. Every later push that touches the
   file does.
3. The run summary prints the exact URL to paste.

**The copy in the public repo is a deployment, not a fork.** The version here stays
the source of truth, so a policy change is: edit both files here, then copy the
`.html` over and push. Nothing enforces that — automating it would mean a PAT with
write access to another repo sitting in this one's secrets, which is a lot of
standing permission for a file that changes about once a year. What does catch a
mistake is the workflow: it deploys whatever it was given and prints the URL, so
open it and read the date.

Step 2 cannot be automated away, and the failure if you skip it is worth
recognising:

```text
Warning: Get Pages site failed. Error: Not Found
Error: Create Pages site failed. Error: Resource not accessible by integration
```

The warning is benign — it just means Pages is not enabled yet. The error is the
real stop. `configure-pages` has an `enablement: true` input that looks like the
fix, and it is not: its own `action.yml` says the option "requires a token other
than `GITHUB_TOKEN`", since creating a Pages site needs `administration:write`.
Passing a PAT with `repo` scope through secrets would work, and is a poor trade for
one click done once.

The URL is `https://<user>.github.io/<repo>/privacy-policy.html`. The site root
serves the same page, so `https://<user>.github.io/<repo>/` works too — but paste
the explicit filename: it reads as a policy page to a reviewer skimming the field,
and a bare root reads like a site.

Editing `privacy-policy.md` alone deploys nothing — the workflow watches the
`.html`. Change both, in the same commit.

**If the source has to live on an HBLAB domain instead**, the same five conditions
in the list above apply, and the SSO one is the trap: a page that resolves inside
the office network and 302s to a login screen from outside fails review while
looking fine to you. Check it from a phone on mobile data.

### 3. Capture screenshots

At least one 1280×800 screenshot is required and the first one is your search
result thumbnail. [listing.md](listing.md) lists the five shots to take and the
order. Blur real names, avatars and message text first — these are public.

### 4. Decisions to make before you paste anything

**Naming and trademark.** The manifest currently says `GChat Preview Files`.
Google's brand and the Store's policy both dislike third-party items whose name
suggests an official product. The conventional safe shape is `<function> for
<product>`:

- Safer: `Attachment Preview for Google Chat` — change `name` in
  `public/manifest.json`, since the Store displays the manifest name once the item
  exists.
- Keep as-is: defensible, but a rejection on this point costs a review round.

Either way, keep the "Not affiliated with, endorsed by, or sponsored by Google"
line at the end of the description. It is already in the copy.

**The `https://*/*` optional host permission.** This is the single most likely
reason for a slow or bounced review — reviewers treat all-hosts patterns as a
serious ask, even optional ones. It buys exactly one feature: pointing PlantUML
at a self-hosted server. Options, in order of how much friction they remove:

1. **Drop it.** Users keep the public plantuml.com default or turn PlantUML off.
   Fewest questions asked, one feature gone.
2. **Narrow it** to the HBLAB-internal PlantUML hosts, if a fixed set exists.
3. **Keep it** and lean on the justification already written in
   [listing.md](listing.md), which spells out that it is requested per-origin from
   inside a user gesture and never in full.

The Store review verdict does not change the code either way — only your
tolerance for a longer first review.

### 5. Submit

1. Dashboard → **Add new item** → upload the zip from `release/`.
2. Fill **Store listing**, **Privacy** and **Distribution** from
   [listing.md](listing.md).
3. **Submit for review.** First reviews typically take a few days; an item asking
   for broad host permissions can take longer and may come back with questions.

## Automating later releases

**Short answer: yes for everything after the first submission — the first one has
to be done by hand.**

The Chrome Web Store API can upload a new package and publish an existing item.
It cannot create the listing: description, screenshots, category, the privacy
answers and the permission justifications are dashboard-only. So the first release
is manual, and every release after it can be one command or one CI job.

Note that "publish" still means "submit for review". Automation removes the
clicking, not the wait.

### One-time setup

```bash
npm i -D chrome-webstore-upload-cli
```

Then get API credentials:

1. <https://console.cloud.google.com> → new project.
2. **APIs & Services → Library** → enable **Chrome Web Store API**.
3. **OAuth consent screen** → External → add yourself as a user.
   **Then set it to "In production".** Left in "Testing", Google expires the
   refresh token after 7 days and your release job breaks a week later with an
   `invalid_grant` that gives no hint why. This step is the one people skip.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Keep the
   client ID and secret.
5. Get a refresh token — open this in a browser, approve, and copy the `code` from
   the redirect URL:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=http://localhost:8818
   ```

   ```bash
   curl -s "https://accounts.google.com/o/oauth2/token" \
     -d "client_id=<CLIENT_ID>" \
     -d "client_secret=<CLIENT_SECRET>" \
     -d "code=<CODE>" \
     -d "grant_type=authorization_code" \
     -d "redirect_uri=http://localhost:8818"
   ```

   The `refresh_token` in the response is what you keep. It does not expire once
   the consent screen is in production.

6. The **extension ID** comes from the dashboard after the item exists.

Put the four values in the environment — never in the repo:

```bash
export EXTENSION_ID=...
export CLIENT_ID=...
export CLIENT_SECRET=...
export REFRESH_TOKEN=...
```

### Releasing

```bash
npm run package     # verify locally first
npm run release     # package + upload + publish
```

`npm run release` is already wired in `package.json`. Drop `--auto-publish` from
it if you would rather upload a draft and press publish yourself — worth doing for
the first few automated runs, so you can eyeball what landed.

### From CI

Only worth setting up once this is in git. Store the four values as repository
secrets, then tag-triggered releases look like this:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run package
      - run: npx chrome-webstore-upload-cli upload --source release/*.zip --auto-publish
        env:
          EXTENSION_ID: ${{ secrets.EXTENSION_ID }}
          CLIENT_ID: ${{ secrets.CLIENT_ID }}
          CLIENT_SECRET: ${{ secrets.CLIENT_SECRET }}
          REFRESH_TOKEN: ${{ secrets.REFRESH_TOKEN }}
```

The build runs `npm run typecheck && npm test` before packaging, so a broken
build cannot reach the Store.
