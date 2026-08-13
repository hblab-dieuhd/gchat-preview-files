#!/usr/bin/env node
/**
 * Launches the throwaway Chrome profile used to verify a build against live
 * Google Chat, loads dist/ into it, and leaves it driveable over CDP.
 *
 *   node scripts/test-chrome.mjs [url]
 *   node scripts/test-chrome.mjs --login    # same profile, no automation flags
 *
 * The --login mode exists for one failure: Google sometimes refuses to sign in on a
 * browser started for automation ("This browser or app may not be secure"). It opens
 * the same profile as a plain Chrome, so the sign-in goes through and the cookies land
 * in the same place; close it afterwards and the normal mode picks them up.
 *
 * Three things here are not free choices.
 *
 * 1. `--load-extension` does NOT work. Chrome disabled the switch, and the old
 *    `--disable-features=DisableLoadExtensionCommandLineSwitch` escape hatch is
 *    gone too — verified against Chrome 150, where both launch with only the
 *    three component extensions and every chrome-extension:// URL of ours dies
 *    with ERR_BLOCKED_BY_CLIENT. The supported route is the CDP call below,
 *    which is why the browser is started with --enable-unsafe-extension-debugging.
 *
 * 2. The profile lives OUTSIDE the repo. It holds a real Google login, so it must
 *    survive `npm run clean`, `git clean -fdx` and rm -rf dist. It is also why
 *    this is a dedicated profile and not the user's everyday one: Chrome refuses
 *    --remote-debugging-port on the default profile dir, and pointing an open
 *    debugging port at a profile holding personal cookies would be worse than
 *    logging in once here.
 *
 * 3. Relaunching IS the extension reload — for pages and content scripts. Chrome
 *    reads an unpacked extension from disk when it loads it, so killing the browser
 *    and calling loadUnpacked again picks up the newest dist/ with no clicking
 *    around in chrome://extensions. A rebuild therefore always needs this script
 *    run again; nothing hot-reloads. The **service worker is the exception** and
 *    needs `refreshServiceWorker` below — see the note there.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9222
const PROFILE = resolve(homedir(), '.gchat-preview-test-profile')

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const loginMode = process.argv.includes('--login')
const url = process.argv.slice(2).find((a) => !a.startsWith('--'))

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run `npm run build` first.')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}`)
  process.exit(1)
}

/** Speaks CDP over the browser-level websocket, for the handful of calls needed. */
async function cdp(fn) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
  const sock = new WebSocket(webSocketDebuggerUrl)
  const pending = new Map()
  let id = 0
  sock.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
  }
  await new Promise((ok, fail) => {
    sock.onopen = ok
    sock.onerror = fail
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((ok) => {
      const n = ++id
      pending.set(n, ok)
      sock.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  try {
    return await fn(send)
  } finally {
    sock.close()
  }
}

/**
 * Makes sure the running service worker is the one in dist/, not the registration
 * Chrome restored from the last session.
 *
 * Relaunching reloads the extension's pages and content scripts, but at startup
 * `Extensions.loadUnpacked` races Chrome's own restore of the profile's extension
 * state, and the worker can keep running the PREVIOUS build's background.js. That
 * failure is silent and vicious: pages and content script are new, the worker is
 * old, so a newly added message type gets no listener and the only symptom is
 * `The message port closed before a response was received` — which reads as a
 * broken feature and is a stale worker. Observed on Chrome 150, 2026-08-13.
 *
 * A second loadUnpacked once the browser has settled does replace it, which is all
 * this does. Verifying instead of repeating was tried and abandoned: reading the
 * running script means `Debugger.enable` on the worker target, and that hangs the
 * launch — Chrome pauses an extension worker when a debugger attaches to it.
 * loadUnpacked is idempotent and costs a few hundred milliseconds, so paying it
 * unconditionally is the cheaper trade.
 */
async function refreshServiceWorker(send) {
  await sleep(700)
  const again = await send('Extensions.loadUnpacked', { path: dist })
  if (again.error) throw new Error(`Extensions.loadUnpacked failed: ${JSON.stringify(again.error)}`)
}

// An already-running instance on this profile would swallow the relaunch as a
// new tab and keep serving the OLD build, so it has to go first.
try {
  execFileSync('pkill', ['-f', `--user-data-dir=${PROFILE}`], { stdio: 'ignore' })
  await sleep(1000)
} catch {
  // pkill exits 1 when nothing matched — that is the normal first-run case.
}

mkdirSync(PROFILE, { recursive: true })
const firstRun = !existsSync(resolve(PROFILE, 'Default'))

spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    ...(loginMode ? [] : [`--remote-debugging-port=${PORT}`, '--enable-unsafe-extension-debugging']),
    '--no-first-run',
    '--no-default-browser-check',
    url ?? (loginMode ? 'https://chat.google.com/' : 'about:blank'),
  ],
  { detached: true, stdio: 'ignore' },
).unref()

if (loginMode) {
  console.log('Sign-in window open on the test profile — no debugging port, no extension.')
  console.log('Sign in, then close the window and run `npm run verify` again.')
  process.exit(0)
}

let up = false
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (res.ok) {
      up = true
      break
    }
  } catch {
    // Not listening yet.
  }
  await sleep(500)
}
if (!up) {
  console.error(`Chrome did not open a debugging port on ${PORT} within 10s.`)
  process.exit(1)
}

const extensionId = await cdp(async (send) => {
  const loaded = await send('Extensions.loadUnpacked', { path: dist })
  if (loaded.error) throw new Error(`Extensions.loadUnpacked failed: ${JSON.stringify(loaded.error)}`)

  await refreshServiceWorker(send)

  // The startup tab opened BEFORE the extension existed, so no content script was
  // injected into it. Without this reload the space renders perfectly and simply has
  // no Preview buttons — which reads as a detection regression and is not one.
  if (url) {
    const { result } = await send('Target.getTargets')
    for (const target of result.targetInfos.filter((t) => t.type === 'page')) {
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      await send('Page.reload', {}, attached.result.sessionId)
    }
  }

  return loaded.result.id
})

console.log(`extension  ${extensionId}`)
console.log(`cdp        http://127.0.0.1:${PORT}`)
console.log(`profile    ${PROFILE}`)
console.log(`settings   chrome-extension://${extensionId}/options.html`)
if (firstRun) {
  console.log('\nFirst run on this profile — sign in to the Google account that can')
  console.log('see the test space, then run this script again.')
}
