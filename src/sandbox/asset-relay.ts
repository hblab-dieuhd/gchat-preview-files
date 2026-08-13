import type { AssetRequestMessage, AssetResultMessage } from '../shared/protocol.ts'
import type { Asset } from './inline-assets.ts'
import { createRelay } from './relay.ts'

/**
 * Asks the content script to fetch one resource an HTML attachment links to.
 *
 * Shorter timeout than the diagram relay, and deliberately so: a document can be
 * waiting on dozens of these, a missing stylesheet degrades to an unstyled block
 * rather than an empty preview, and the reader should not sit through half a
 * minute of blank white because one CDN is slow.
 */

const TIMEOUT_MS = 12_000

const relay = createRelay<Asset>(TIMEOUT_MS, 'The server did not answer in time.')

export function requestAsset(url: string): Promise<Asset> {
  return relay.send((id): AssetRequestMessage => ({ type: 'ASSET_REQUEST', id, url }))
}

export function handleAssetResult(message: AssetResultMessage): void {
  relay.settle(
    message.id,
    message.result.ok
      ? {
          ok: true,
          value: {
            contentType: message.result.contentType,
            base64: message.result.base64,
            byteLength: message.result.byteLength,
          },
        }
      : { ok: false, error: message.result.error },
  )
}
