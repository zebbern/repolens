import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchIndexFiles,
  batchIndexMetadataOnly,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
  searchIndexAsync,
} from '@/lib/code/code-index'
import { InMemoryContentStore, LazyContentStore } from '@/lib/code/content-store'
import { FetchQueue } from '@/lib/code/fetch-queue'
import type { SearchWorkerRequest, SearchWorkerResponse } from '../search.worker'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: SearchWorkerRequest[] = []
  terminated = false

  constructor(_url: URL) {
    FakeWorker.instances.push(this)
  }

  postMessage(message: SearchWorkerRequest): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(response: SearchWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }))
  }
}

describe('searchInWorker', () => {
  beforeEach(() => {
    vi.resetModules()
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not run repository content search on the browser main thread when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const { searchInWorker } = await import('../search-worker-client')
    const index = indexFile(createEmptyIndex(), 'src/app.ts', 'const hello = true', 'typescript')

    await expect(searchInWorker(index, 'hello')).rejects.toThrow(/web worker unavailable/i)
  })

  it('returns a rejected promise when worker construction fails', async () => {
    class BlockedWorker {
      constructor() {
        throw new Error('worker construction blocked')
      }
    }
    vi.stubGlobal('Worker', BlockedWorker)
    const { searchInWorker } = await import('../search-worker-client')

    let result: ReturnType<typeof searchInWorker> | undefined
    expect(() => {
      result = searchInWorker(createEmptyIndex(), 'hello')
    }).not.toThrow()
    await expect(result).rejects.toThrow('worker construction blocked')
  })

  it('threads finite limits through the worker and restores coverage metadata', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    const index = indexFile(createEmptyIndex(), 'src/app.ts', 'hello hello', 'typescript')
    const pending = searchInWorker(index, 'hello', { maxMatches: 7, maxMatchesPerFile: 2 })
    const fake = FakeWorker.instances[0]
    const searchMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search',
    )!

    expect(searchMessage.options).toEqual({ maxMatches: 7, maxMatchesPerFile: 2 })

    const workerResults = [{
      file: 'src/app.ts',
      language: 'typescript',
      matches: [{ line: 1, content: 'hello hello', column: 0, length: 5 }],
    }]
    fake.emit({
      type: 'result',
      id: searchMessage.id,
      results: workerResults,
      unsearchedPaths: ['src/lazy.ts'],
      unavailablePaths: ['src/lazy.ts'],
      truncated: true,
    })

    const result = await pending
    expect(result).toEqual(workerResults)
    expect(result.unsearchedPaths).toEqual(['src/lazy.ts'])
    expect(result.truncated).toBe(true)
  })

  it('transfers only resident lazy-store content to the worker', async () => {
    const fetchFile = vi.fn(async () => 'network content')
    const store = new LazyContentStore('owner/repo', new FetchQueue({ fetchFn: fetchFile }))
    store.registerPaths(['src/resident.ts', 'src/lazy.ts'])
    store.put('src/resident.ts', 'const residentNeedle = true')
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/resident.ts', language: 'typescript', lineCount: 1 },
      { path: 'src/lazy.ts', language: 'typescript', lineCount: 1 },
    ])
    const { searchInWorker } = await import('../search-worker-client')

    const pending = searchInWorker(index, 'residentNeedle')
    const fake = FakeWorker.instances[0]
    await vi.waitFor(() => expect(fake.messages.some(message => message.type === 'setIndex')).toBe(true))
    const setIndexMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'setIndex' }> => message.type === 'setIndex',
    )!

    expect(setIndexMessage.codeIndex.files.find(([path]) => path === 'src/resident.ts')?.[1].content)
      .toBe('const residentNeedle = true')
    expect(setIndexMessage.codeIndex.files.find(([path]) => path === 'src/lazy.ts')?.[1].content)
      .toBeUndefined()
    expect(fetchFile).not.toHaveBeenCalled()

    const searchMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search',
    )!
    fake.emit({
      type: 'result',
      id: searchMessage.id,
      results: [],
      unsearchedPaths: ['src/lazy.ts'],
      unavailablePaths: ['src/lazy.ts'],
      truncated: false,
    })
    await pending
  })

  it('refreshes the worker snapshot after content loads into the same lazy index', async () => {
    const store = new LazyContentStore(
      'owner/repo',
      new FetchQueue({ fetchFn: vi.fn(async () => 'network content') }),
    )
    store.registerPaths(['src/lazy.ts'])
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/lazy.ts', language: 'typescript', lineCount: 1 },
    ])
    const { searchInWorker } = await import('../search-worker-client')

    const firstSearch = searchInWorker(index, 'loadedNeedle')
    const fake = FakeWorker.instances[0]
    await vi.waitFor(() => expect(fake.messages.filter(message => message.type === 'setIndex')).toHaveLength(1))
    const firstRequest = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search',
    )!
    fake.emit({
      type: 'result',
      id: firstRequest.id,
      results: [],
      unsearchedPaths: ['src/lazy.ts'],
      unavailablePaths: ['src/lazy.ts'],
      truncated: false,
    })

    const firstResult = await firstSearch
    expect(firstResult).toEqual([])
    expect(firstResult.unavailablePaths).toEqual(['src/lazy.ts'])

    const loadedSource = 'export const loadedNeedle = true'
    const indexedFile = index.files.get('src/lazy.ts')!
    indexedFile.content = loadedSource
    indexedFile.lineCount = 1
    store.put('src/lazy.ts', loadedSource)

    const secondSearch = searchInWorker(index, 'loadedNeedle')
    await vi.waitFor(() => expect(fake.messages.filter(message => message.type === 'setIndex')).toHaveLength(2))
    const refreshedIndex = fake.messages
      .filter((message): message is Extract<SearchWorkerRequest, { type: 'setIndex' }> => message.type === 'setIndex')
      .at(-1)!
    expect(refreshedIndex.codeIndex.files).toContainEqual([
      'src/lazy.ts',
      expect.objectContaining({ content: loadedSource }),
    ])

    const secondRequest = fake.messages
      .filter((message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search')
      .at(-1)!
    const workerResults = [{
      file: 'src/lazy.ts',
      language: 'typescript',
      matches: [{ line: 1, content: loadedSource, column: 13, length: 12 }],
    }]
    fake.emit({
      type: 'result',
      id: secondRequest.id,
      results: workerResults,
      unsearchedPaths: [],
      unavailablePaths: [],
      truncated: false,
    })

    await expect(secondSearch).resolves.toEqual(workerResults)
  })

  it('transfers a session-local IDB rename overlay to the worker', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    const { IDBContentStore } = await import('@/lib/code/content-store')
    const store = new IDBContentStore('owner/repo@tree', undefined, { kind: 'disabled' })
    store.registerPaths(['src/original.ts'])
    store.applySessionOverlay({
      deletedPaths: ['src/original.ts'],
      entries: [{ path: 'src/renamed.ts', content: 'const renamedNeedle = true' }],
    })
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/renamed.ts', language: 'typescript', lineCount: 1 },
    ])
    const pending = searchInWorker(index, 'renamedNeedle')
    const fake = FakeWorker.instances[0]
    const setIndexMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'setIndex' }> => message.type === 'setIndex',
    )!

    expect(setIndexMessage).toMatchObject({
      storeKey: 'owner/repo@tree',
      contentOverlay: {
        deletedPaths: ['src/original.ts'],
        entries: [{ path: 'src/renamed.ts', content: 'const renamedNeedle = true' }],
      },
    })

    const searchMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search',
    )!
    fake.emit({
      type: 'result',
      id: searchMessage.id,
      results: [],
      unsearchedPaths: [],
      unavailablePaths: [],
      truncated: false,
    })
    await pending
  })

  it('cancels a request through its AbortSignal and ignores a later worker response', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    const controller = new AbortController()
    const pending = searchInWorker(createEmptyIndex(), 'hello', { signal: controller.signal })
    const rejection = pending.then(() => null, error => error)
    const fake = FakeWorker.instances[0]
    const searchMessage = fake.messages.find(
      (message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search',
    )!

    controller.abort()

    expect(fake.messages).toContainEqual({ type: 'cancel', id: searchMessage.id })
    expect(await rejection).toMatchObject({ name: 'AbortError' })
    expect(() => fake.emit({
      type: 'result',
      id: searchMessage.id,
      results: [],
      unsearchedPaths: [],
      unavailablePaths: [],
      truncated: false,
    })).not.toThrow()
  })

  it('cancels every pending worker request', async () => {
    const { cancelPendingSearches, searchInWorker } = await import('../search-worker-client')
    const index = createEmptyIndex()
    const first = searchInWorker(index, 'one')
    const second = searchInWorker(index, 'two')
    const firstRejection = first.then(() => null, error => error)
    const secondRejection = second.then(() => null, error => error)
    const fake = FakeWorker.instances[0]
    const ids = fake.messages
      .filter((message): message is Extract<SearchWorkerRequest, { type: 'search' }> => message.type === 'search')
      .map(message => message.id)

    cancelPendingSearches()

    expect(fake.messages.filter(message => message.type === 'cancel')).toEqual(
      ids.map(id => ({ type: 'cancel', id })),
    )
    expect(await firstRejection).toMatchObject({ name: 'AbortError' })
    expect(await secondRejection).toMatchObject({ name: 'AbortError' })
  })

  it('keeps async search results identical for inline and content-store-only source', async () => {
    const source = 'const first = "needle"\nconst second = needle\n'
    const inline = indexFile(createEmptyIndex(), 'parity.ts', source, 'typescript')
    const stored = batchIndexFiles(
      createEmptyIndexWithStore(new InMemoryContentStore()),
      [{ path: 'parity.ts', content: source, language: 'typescript' }],
      { retainContent: false },
    )

    await expect(searchIndexAsync(stored, 'needle')).resolves.toEqual(
      await searchIndexAsync(inline, 'needle'),
    )
  })
})
