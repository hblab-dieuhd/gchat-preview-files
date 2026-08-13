import { strict as assert } from 'node:assert'
import test from 'node:test'
import { requestFromBackground } from './background-request.ts'
import type { RuntimeRequest } from '../shared/protocol.ts'

/**
 * Guards the service-worker wake retry.
 *
 * The bug this exists for: a preview failing with "Could not establish
 * connection. Receiving end does not exist." for some users and not others,
 * because an idle-terminated MV3 worker only loses a message that lands during
 * its shutdown. Nothing here needs a DOM — the module reads `chrome` lazily, so
 * a fake global is enough.
 */

const REQUEST: RuntimeRequest = { type: 'FETCH_ATTACHMENT', url: 'https://x/', maxBytes: 1 }
const NO_DELAY = { retryDelaysMs: [0, 0, 0] }

/** Replies per attempt: a string becomes lastError, anything else a response. */
function fakeChrome(replies: unknown[], id: string | null = 'abc') {
  const sent: RuntimeRequest[] = []
  const runtime = {
    id,
    lastError: undefined as { message: string } | undefined,
    sendMessage(request: RuntimeRequest, callback: (response: unknown) => void) {
      sent.push(request)
      const reply = replies[sent.length - 1]
      if (typeof reply === 'string') {
        runtime.lastError = { message: reply }
        callback(undefined)
      } else {
        runtime.lastError = undefined
        callback(reply)
      }
      // Chrome clears lastError once the callback returns.
      runtime.lastError = undefined
    },
  }
  ;(globalThis as { chrome?: unknown }).chrome = { runtime }
  return { sent }
}

test('returns the response when the worker answers first time', async () => {
  const { sent } = fakeChrome([{ ok: true }])
  assert.deepEqual(await requestFromBackground(REQUEST, NO_DELAY), { ok: true })
  assert.equal(sent.length, 1)
})

test('retries a shutting-down worker and returns its answer', async () => {
  const { sent } = fakeChrome([
    'Could not establish connection. Receiving end does not exist.',
    { ok: true, text: 'hi' },
  ])
  assert.deepEqual(await requestFromBackground(REQUEST, NO_DELAY), { ok: true, text: 'hi' })
  assert.equal(sent.length, 2, 'the second send is what wakes the worker')
})

test('gives up with an actionable message when the worker never starts', async () => {
  const { sent } = fakeChrome(Array(9).fill('Receiving end does not exist.'))
  await assert.rejects(requestFromBackground(REQUEST, NO_DELAY), (error: Error) => {
    assert.match(error.message, /chrome:\/\/extensions/)
    assert.doesNotMatch(error.message, /receiving end/i)
    return true
  })
  assert.equal(sent.length, 4, 'one attempt per delay, plus the first')
})

test('does not retry an answer — only a missing receiver', async () => {
  const { sent } = fakeChrome(['The diagram server must use https.', { ok: true }])
  await assert.rejects(requestFromBackground(REQUEST, NO_DELAY), /must use https/)
  assert.equal(sent.length, 1)
})

test('an orphaned content script is told to reload the tab, not to retry', async () => {
  // null, not undefined: an explicit undefined would take the default.
  const { sent } = fakeChrome([{ ok: true }], null)
  await assert.rejects(requestFromBackground(REQUEST, NO_DELAY), /Reload this Google Chat tab/)
  assert.equal(sent.length, 0, 'sending from an invalidated context only throws')
})
