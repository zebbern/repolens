import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  batchIndexFiles,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
} from '../code-index'
import { IDBContentStore } from '../content-store'
import { serializeCodeIndex, serializeCodeIndexMeta } from '../scanner/serialization'
import type { SearchWorkerRequest, SearchWorkerResponse } from '../search.worker'
import '../search.worker'

async function send(request: SearchWorkerRequest): Promise<SearchWorkerResponse> {
  const responses: SearchWorkerResponse[] = []
  Object.defineProperty(globalThis, 'postMessage', {
    value: (response: SearchWorkerResponse) => responses.push(response),
    writable: true,
    configurable: true,
  })
  self.onmessage?.(new MessageEvent('message', { data: request }))
  if (request.type === 'search') {
    await vi.waitFor(() => expect(responses).toHaveLength(1))
  }
  return responses[0]
}

describe('search.worker serialization boundary', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('returns identical results for inline and metadata-only IDB indexes', async () => {
    let inline = createEmptyIndex()
    inline = indexFile(inline, 'src/value.ts', 'export const workerNeedle = true\n', 'typescript')
    inline = indexFile(inline, 'src/empty.ts', '', 'typescript')

    await send({ type: 'setIndex', codeIndex: serializeCodeIndex(inline) })
    const inlineResponse = await send({ type: 'search', id: 1, query: 'workerNeedle', options: {} })

    const store = new IDBContentStore('owner/repo@tree')
    const idb = batchIndexFiles(createEmptyIndexWithStore(store), [
      { path: 'src/value.ts', content: 'export const workerNeedle = true\n', language: 'typescript' },
      { path: 'src/empty.ts', content: '', language: 'typescript' },
    ], { retainContent: false })
    await store.flush()
    const serialized = serializeCodeIndexMeta(idb)
    expect(serialized.files.every(([, file]) => !Object.hasOwn(file, 'content'))).toBe(true)

    await send({ type: 'setIndex', codeIndex: serialized, storeKey: store.storeKey })
    const idbResponse = await send({ type: 'search', id: 2, query: 'workerNeedle', options: {} })

    expect(idbResponse).toEqual({ ...inlineResponse, id: 2 })
  })
})
