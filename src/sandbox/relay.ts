/**
 * The plumbing behind every network request this page makes.
 *
 * The sandbox page has an opaque origin and no `chrome.*` APIs, so it cannot
 * fetch anything itself. Everything is relayed — sandbox -> content script ->
 * service worker -> back — and every request carries an id, because replies come
 * back concurrently and out of order: one document can be waiting on a dozen
 * stylesheets and a PlantUML diagram at the same time.
 *
 * Both relays share this table rather than keeping one each. Their ids are
 * independent, which is safe: a reply is matched inside the relay that sent it,
 * and the two use different message types.
 */

interface Pending<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface Relay<T> {
  /** Posts the request built for a fresh id, and resolves when its reply lands. */
  send(build: (id: number) => unknown): Promise<T>
  /** Settles the request with this id. Unknown ids are ignored — a late reply to
   *  something that already timed out must not throw. */
  settle(id: number, result: { ok: true; value: T } | { ok: false; error: string }): void
}

export function createRelay<T>(timeoutMs: number, timeoutMessage: string): Relay<T> {
  const pending = new Map<number, Pending<T>>()
  let nextId = 1

  return {
    send(build) {
      const id = nextId++

      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(timeoutMessage))
        }, timeoutMs)

        pending.set(id, { resolve, reject, timer })

        // targetOrigin "*": an opaque origin cannot name its parent.
        window.parent.postMessage(build(id), '*')
      })
    },

    settle(id, result) {
      const entry = pending.get(id)
      if (!entry) return

      pending.delete(id)
      clearTimeout(entry.timer)

      if (result.ok) entry.resolve(result.value)
      else entry.reject(new Error(result.error))
    },
  }
}
