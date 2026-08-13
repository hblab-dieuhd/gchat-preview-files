import type { DiagramRequestMessage, DiagramResultMessage } from '../shared/protocol.ts'
import { createRelay } from './relay.ts'

/**
 * Asks the content script to fetch a PlantUML diagram, because this page cannot.
 *
 * The result is a `data:` URI rather than a URL the document loads itself: the
 * sandbox CSP's `img-src` is static and stays at `data: blob:`, so no host is ever
 * reachable from previewed content. See `relay.ts` for the id/reply mechanics.
 */

/** Give up rather than leave a diagram spinning forever. */
const TIMEOUT_MS = 20_000

const relay = createRelay<string>(TIMEOUT_MS, 'The diagram server did not answer in time.')

export function requestDiagram(url: string): Promise<string> {
  return relay.send((id): DiagramRequestMessage => ({ type: 'DIAGRAM_REQUEST', id, url }))
}

export function handleDiagramResult(message: DiagramResultMessage): void {
  relay.settle(
    message.id,
    message.result.ok
      ? { ok: true, value: message.result.dataUri }
      : { ok: false, error: message.result.error },
  )
}
