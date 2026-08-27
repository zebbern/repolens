import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  batchIndexFiles,
  batchIndexMetadataOnly,
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

  it('searches a session-local rename overlay without changing the durable IDB snapshot', async () => {
    const source = 'export const renamedNeedle = true\n'
    const store = new IDBContentStore('owner/repo@renamed-tree')
    const original = batchIndexFiles(createEmptyIndexWithStore(store), [
      { path: 'src/original.ts', content: source, language: 'typescript' },
    ], { retainContent: false })
    await store.flush()
    const originalFile = original.files.get('src/original.ts')!
    const renamed = {
      ...original,
      files: new Map([[
        'src/renamed.ts',
        { ...originalFile, path: 'src/renamed.ts', name: 'renamed.ts' },
      ]]),
    }

    await send({
      type: 'setIndex',
      codeIndex: serializeCodeIndexMeta(renamed),
      storeKey: store.storeKey,
      contentOverlay: {
        deletedPaths: ['src/original.ts'],
        entries: [{ path: 'src/renamed.ts', content: source }],
      },
    })
    const response = await send({ type: 'search', id: 5, query: 'renamedNeedle', options: {} })

    expect(response).toMatchObject({
      type: 'result',
      id: 5,
      results: [{ file: 'src/renamed.ts' }],
      unsearchedPaths: [],
      unavailablePaths: [],
    })
    expect(await store.get('src/original.ts')).toBe(source)
    expect(await store.get('src/renamed.ts')).toBeNull()
  })

  it('searches a normal session edit without changing the durable IDB snapshot', async () => {
    const storeKey = 'owner/repo@edited-tree'
    const durable = new IDBContentStore(storeKey)
    durable.put('src/value.ts', 'export const oldNeedle = true\n')
    await durable.flush()

    const session = new IDBContentStore(storeKey, undefined, { kind: 'disabled' })
    session.registerPaths(['src/value.ts'])
    const metadata = batchIndexMetadataOnly(createEmptyIndexWithStore(session), [
      { path: 'src/value.ts', language: 'typescript', lineCount: 1 },
    ])
    const edited = indexFile(
      metadata,
      'src/value.ts',
      'export const newNeedle = true\n',
      'typescript',
    )

    await send({
      type: 'setIndex',
      codeIndex: serializeCodeIndexMeta(edited),
      storeKey,
      contentOverlay: session.getSessionOverlay(),
    })
    const newResponse = await send({ type: 'search', id: 6, query: 'newNeedle', options: {} })
    const oldResponse = await send({ type: 'search', id: 7, query: 'oldNeedle', options: {} })

    expect(newResponse).toMatchObject({
      type: 'result',
      id: 6,
      results: [{ file: 'src/value.ts' }],
    })
    expect(oldResponse).toMatchObject({ type: 'result', id: 7, results: [] })
    expect(await durable.get('src/value.ts')).toBe('export const oldNeedle = true\n')
  })

  it('applies serialized limits and returns coverage metadata', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'src/a.ts', content: 'needle needle', language: 'typescript' },
      { path: 'src/b.ts', content: 'needle', language: 'typescript' },
    ])
    await send({ type: 'setIndex', codeIndex: serializeCodeIndex(index) })

    const response = await send({
      type: 'search',
      id: 3,
      query: 'needle',
      options: { maxMatches: 1, maxMatchesPerFile: 1 },
    })

    expect(response).toMatchObject({
      type: 'result',
      id: 3,
      unsearchedPaths: ['src/b.ts'],
      unavailablePaths: [],
      truncated: true,
    })
    if (response.type !== 'result') throw new Error('Expected worker search result')
    expect(response.results.flatMap(file => file.matches)).toHaveLength(1)
  })

  it('excludes generated paths in the worker before the serialized global limit', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'dist/generated.js', content: 'needle', language: 'javascript' },
      { path: 'src/allowed.ts', content: 'needle', language: 'typescript' },
    ])
    await send({ type: 'setIndex', codeIndex: serializeCodeIndex(index) })

    const response = await send({
      type: 'search',
      id: 4,
      query: 'needle',
      options: {
        maxMatches: 1,
        pathFilter: { excludeGenerated: true },
      },
    })

    expect(response).toMatchObject({
      type: 'result',
      id: 4,
      results: [{ file: 'src/allowed.ts' }],
      unsearchedPaths: [],
      unavailablePaths: [],
      truncated: false,
    })
  })

  it.each([
    ['suffix', { kind: 'suffix' as const, value: '.ts' }, 'src/first.js', 'src/allowed.ts'],
    ['prefix', { kind: 'prefix' as const, value: 'src/' }, 'vendor/first.ts', 'src/allowed.ts'],
    ['contains', { kind: 'contains' as const, value: 'client' }, 'src/first.ts', 'packages/client/allowed.ts'],
  ])('applies a serialized %s include before the global limit', async (
    _kind,
    include,
    excludedPath,
    includedPath,
  ) => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: excludedPath, content: 'needle', language: 'typescript' },
      { path: includedPath, content: 'needle', language: 'typescript' },
    ])
    await send({ type: 'setIndex', codeIndex: serializeCodeIndex(index) })

    const response = await send({
      type: 'search',
      id: 10,
      query: 'needle',
      options: {
        maxMatches: 1,
        pathFilter: { includes: [include] },
      },
    })

    expect(response).toMatchObject({
      type: 'result',
      id: 10,
      results: [{ file: includedPath }],
      unsearchedPaths: [],
      unavailablePaths: [],
      truncated: false,
    })
  })
})
