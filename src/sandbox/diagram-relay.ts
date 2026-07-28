import type { DiagramRequestMessage, DiagramResultMessage } from '../shared/protocol.ts'

/**
 * Asks the content script to fetch a diagram, because this page cannot.
 *
 * The sandbox page has an opaque origin and no `chrome.*` APIs, so every network
 * need is relayed: sandbox -> content script -> service worker -> back. Each
 * request carries an id so replies can be matched, since several diagrams in one
 * document resolve concurrently and out of order.
 */

/** Give up rather than leave a diagram spinning forever. */
const TIMEOUT_MS = 20_000

interface Pending {
  resolve: (dataUri: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, Pending>()
let nextId = 1

export function requestDiagram(url: string): Promise<string> {
  const id = nextId++

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('The diagram server did not answer in time.'))
    }, TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })

    const request: DiagramRequestMessage = { type: 'DIAGRAM_REQUEST', id, url }
    // targetOrigin "*": an opaque origin cannot name its parent.
    window.parent.postMessage(request, '*')
  })
}

export function handleDiagramResult(message: DiagramResultMessage): void {
  const entry = pending.get(message.id)
  if (!entry) return

  pending.delete(message.id)
  clearTimeout(entry.timer)

  if (message.result.ok) entry.resolve(message.result.dataUri)
  else entry.reject(new Error(message.result.error))
}
