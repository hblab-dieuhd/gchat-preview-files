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

### 1.4.0

If 1.3.0 was never uploaded, paste its notes below this too: this build includes it.

```text
Renamed to File Preview for Google Chat & Drive, since it no longer works only in Chat.

The note above a preview now depends on the file. An HTML file is read on your
machine before it is shown, and the note says what was found: scripts, a password
field, a page that looks like a sign-in, or scripts that look deliberately disguised,
which are marked in red. If nothing was found there is no note. No file content is
sent anywhere for this, and previews stay as isolated as before. Markdown, JSON and
Mermaid previews no longer show a note, and PlantUML shows only where the source went.
```

### 1.3.0

```text
Now works in Google Drive too. .html, .mmd and .puml files get a Preview button in
the file list, the grid and the viewer, which otherwise shows these files as source
text. Previews from Drive run in the same sandbox as attachments in Chat. A .puml
file sends its source to the PlantUML server you have configured when drawn, as it
does in Chat; turn drawing off in the options page to read it as source instead.

The note above each preview no longer says a file was sent by someone else, since a
file in Drive may be your own. The advice to treat it as untrusted stays.
```

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

**Naming and trademark.** The name is `File Preview for Google Chat & Drive`, changed from
`GChat Preview Files` in 1.4.0. "GChat" no longer covered Drive, and it is a
shortening of Google's own product name, which is the kind of name the brand rules
and the Store's policy dislike. `<function> for <product>` is the conventional shape
for naming a product the item works with. The name is set in `public/manifest.json`,
which is what the Store displays once the item exists.

Keep the "Not affiliated with, endorsed by, or sponsored by Google"
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

`chrome-webstore-upload-cli` is already a devDependency, so `npm ci` is enough.
What is left is credentials — **five** values, not four. `PUBLISHER_ID` is the one
that gets missed: the CLI moved to the Web Store API v2, whose every endpoint is
`publishers/{publisherId}/items/{extensionId}`, and the underlying module lists it
in `requiredFields`. Without it the run dies on `Option "publisherId" is required`.
It is the account/group publisher ID from the Developer Dashboard URL.

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

6. The **extension ID** comes from the dashboard once the item exists.
7. The **publisher ID** is in the dashboard under **Publisher → Settings**. If this
   item lives under an HBLAB group publisher rather than a personal account, switch
   to that publisher first — a member of several publishers sees a different ID per
   publisher, and the wrong one fails against an item it does not own.
8. The token must be minted with the **Google account that owns the item**. Google's
   docs call this out because it need not be the account that created the Cloud
   project, and the two being different is normal for a group publisher.

Put the five values in the environment — never in the repo:

```bash
export EXTENSION_ID=...
export PUBLISHER_ID=...
export CLIENT_ID=...
export CLIENT_SECRET=...
export REFRESH_TOKEN=...
```

### Bumping the version

```bash
npm version patch     # or minor / major / 1.2.0
```

npm's `version` lifecycle runs [scripts/sync-version.mjs](../scripts/sync-version.mjs),
which writes the new number into `public/manifest.json` and stages it, so both
files move in one commit and one tag. `scripts/package.mjs` refuses to build when
they disagree — that guard stays, this just stops it from firing.

Update the *What's new* text under [Release notes](#release-notes) in the same
commit. Nothing enforces that one.

### Releasing locally

```bash
npm run package        # build and zip only, nothing leaves the machine
npm run release:draft  # package + upload, leaves a draft to publish by hand
npm run release        # package + upload + submit for review
```

**There is no `--auto-publish` flag.** An earlier version of this file and of the
`release` script both used one, and it does nothing: the CLI derives auto-publish
from `autoPublish: !command`, so `upload --auto-publish` uploads a draft and stops.
meow passes the unknown flag through without complaint, so the run looks like a
success and the version silently never reaches review. Omitting the command
entirely is what uploads *and* publishes.

### From CI

[.github/workflows/release.yml](../.github/workflows/release.yml) does it on a tag:

```bash
npm version minor
git push --follow-tags
```

Add the five values as repository secrets first (**Settings → Secrets and variables
→ Actions**). The workflow checks all five are present before building and names
the missing one — the CLI's own failure is an OAuth error that does not say which.

It also refuses when the tag disagrees with `package.json` and `manifest.json`.
`npm version` keeps all three in step; pushing a hand-made tag does not, and the
consequence is releasing the previous version's bytes under a new name, which
burns the version number permanently — the Store rejects any re-upload of a
number it has seen.

To upload a draft instead of submitting, run it from **Actions → Release → Run
workflow** with *Submit for review* unticked. Worth doing on the first CI run.

**Changing visibility breaks API publishing until you publish by hand once.** From
Google's API docs: items are always published with their existing visibility, and
if you change that setting in the dashboard you cannot publish through the API
again until you have manually published under the new setting at least once. So
switching this item between Public and Unlisted — an HBLAB-internal rollout, say —
means the next release is a manual one, and the CI failure will not explain why.

The build runs `npm run typecheck && npm test` before packaging, so a broken
build cannot reach the Store.
