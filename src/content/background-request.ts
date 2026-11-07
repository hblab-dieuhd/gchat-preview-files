import type { RuntimeRequest } from '../shared/protocol.ts'

/**
 * Sends a message to the service worker, retrying the one failure that is a race
 * rather than a fault.
 *
 * An MV3 service worker is idle-terminated after ~30 seconds, and this extension
 * gives it nothing else to do — a user who previews one file per hour talks to a
 * worker that is asleep every single time. Waking it is normally Chrome's job,
 * but a message that arrives while the worker is *shutting down* is delivered to
 * a context whose listeners are already gone, and comes back as
 * "Could not establish connection. Receiving end does not exist."
 *
 * That is why the failure looks like it only affects some people: it depends on
 * hitting a window a few milliseconds wide, so one user sees it constantly and
 * their colleague never does. Retrying sends the second message to a worker that
 * has finished shutting down, which Chrome then starts cleanly.
 *
 * Retries are confined to that error. Anything else the worker says — an HTTP
 * status, a size rejection — is an answer, and re-asking would only be slower.
 */

/** Waits between attempts, growing to cover a slow worker start. */
const RETRY_DELAYS_MS = [150, 400, 1000]

/**
 * The lastError text Chrome uses when no listener received the message. Matched
 * on both halves because the wording has changed between Chrome releases and
 * only one of the two has ever been present at a time.
 */
const NO_RECEIVER = /receiving end does not exist|could not establish connection/i

/** Reload-the-tab territory: the extension was updated under a live page. */
const CONTEXT_GONE =
  'The extension was updated or reloaded. Reload this Google Chat tab and try again.'

/** Nothing the page can do about it; the worker itself is not starting. */
const WORKER_DEAD =
  'The extension background did not respond. Open chrome://extensions, reload ' +
  'File Preview for Google Chat & Drive (or restart Chrome), then try again.'

export interface BackgroundRequestOptions {
  /** Overridable so tests do not sit through the real backoff. */
  retryDelaysMs?: readonly number[]
}

/**
 * Resolves with the worker's response, or rejects with a message worth showing.
 *
 * Rejection text is user-facing: it ends up in the preview modal, which is the
 * only place an affected user will ever see it. "Receiving end does not exist"
 * told them nothing actionable, and produced bug reports instead of a reload.
 */
export async function requestFromBackground<T>(
  request: RuntimeRequest,
  options: BackgroundRequestOptions = {},
): Promise<T> {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS

  for (let attempt = 0; ; attempt += 1) {
    // An orphaned content script — the extension was reloaded while this page
    // stayed open — loses `chrome.runtime.id` first. Sending anyway throws
    // "Extension context invalidated", which is true but unhelpful.
    if (!chrome.runtime?.id) throw new Error(CONTEXT_GONE)

    const outcome = await sendOnce<T>(request)
    if ('value' in outcome) return outcome.value

    const retryable = NO_RECEIVER.test(outcome.error)
    if (!retryable) throw new Error(outcome.error)
    if (attempt >= delays.length) throw new Error(WORKER_DEAD)

    await delay(delays[attempt] ?? 0)
  }
}

type Outcome<T> = { value: T } | { error: string }

function sendOnce<T>(request: RuntimeRequest): Promise<Outcome<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (response: T | undefined) => {
        // A worker that never woke surfaces here, not as a thrown error.
        const lastError = chrome.runtime.lastError
        if (lastError) {
          resolve({ error: lastError.message ?? 'The extension background is unavailable.' })
          return
        }
        if (response === undefined) {
          resolve({ error: 'No response from the extension background.' })
          return
        }
        resolve({ value: response })
      })
    } catch (error) {
      // Synchronous throw is the invalidated-context case.
      resolve({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
