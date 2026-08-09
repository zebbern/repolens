import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  InMemoryContentStore,
  IDBContentStore,
  LazyContentStore,
  clearAllRepoContent,
  deleteRepoContent,
  deleteStaleRepoContent,
} from '../content-store'
import { FetchQueue, type FetchQueueOptions } from '../fetch-queue'
import {
  IDBCursor as FakeIDBCursor,
  IDBDatabase as FakeIDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from 'fake-indexeddb'
import {
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
  batchIndexFiles,
  removeFromIndex,
  type CodeIndex,
} from '../code-index'

// ---------------------------------------------------------------------------
// InMemoryContentStore
// ---------------------------------------------------------------------------

describe('InMemoryContentStore', () => {
  it('constructor with no args creates empty store', () => {
    const store = new InMemoryContentStore()
    expect(store.size).toBe(0)
  })

  it('constructor with initial Map uses the provided data', () => {
    const initial = new Map([['a.ts', 'content-a']])
    const store = new InMemoryContentStore(initial)

    expect(store.size).toBe(1)
    expect(store.getSync('a.ts')).toBe('content-a')
  })

  it('put() stores content, getSync() retrieves it', () => {
    const store = new InMemoryContentStore()
    store.put('src/index.ts', 'export default 42;')

    expect(store.getSync('src/index.ts')).toBe('export default 42;')
  })

  it('get() returns Promise that resolves with content', async () => {
    const store = new InMemoryContentStore()
    store.put('file.ts', 'hello')

    const result = await store.get('file.ts')
    expect(result).toBe('hello')
  })

  it('getSync() returns null for missing path', () => {
    const store = new InMemoryContentStore()
    expect(store.getSync('nonexistent.ts')).toBeNull()
  })

  it('get() resolves to null for missing path', async () => {
    const store = new InMemoryContentStore()
    const result = await store.get('nonexistent.ts')
    expect(result).toBeNull()
  })

  it('getBatch() returns Map with only existing paths', async () => {
    const store = new InMemoryContentStore()
    store.put('a.ts', 'aaa')
    store.put('b.ts', 'bbb')

    const result = await store.getBatch(['a.ts', 'missing.ts', 'b.ts'])

    expect(result.size).toBe(2)
    expect(result.get('a.ts')).toBe('aaa')
    expect(result.get('b.ts')).toBe('bbb')
    expect(result.has('missing.ts')).toBe(false)
  })

  it('putBatch() stores multiple entries', () => {
    const store = new InMemoryContentStore()
    store.putBatch([
      { path: 'x.ts', content: 'x-content' },
      { path: 'y.ts', content: 'y-content' },
    ])

    expect(store.size).toBe(2)
    expect(store.getSync('x.ts')).toBe('x-content')
    expect(store.getSync('y.ts')).toBe('y-content')
  })

  it('has() returns true for stored, false for missing', () => {
    const store = new InMemoryContentStore()
    store.put('exists.ts', 'data')

    expect(store.has('exists.ts')).toBe(true)
    expect(store.has('missing.ts')).toBe(false)
  })

  it('delete() removes content', () => {
    const store = new InMemoryContentStore()
    store.put('temp.ts', 'temporary')
    expect(store.has('temp.ts')).toBe(true)

    store.delete('temp.ts')

    expect(store.has('temp.ts')).toBe(false)
    expect(store.getSync('temp.ts')).toBeNull()
    expect(store.size).toBe(0)
  })

  it('getAllSync() returns copy of all entries', () => {
    const store = new InMemoryContentStore()
    store.put('a.ts', 'aaa')
    store.put('b.ts', 'bbb')

    const all = store.getAllSync()

    expect(all.size).toBe(2)
    expect(all.get('a.ts')).toBe('aaa')

    // Returned map is a copy — mutating it does not affect the store
    all.set('c.ts', 'ccc')
    expect(store.size).toBe(2)
  })

  it('size reflects current entry count', () => {
    const store = new InMemoryContentStore()
    expect(store.size).toBe(0)

    store.put('one.ts', '1')
    expect(store.size).toBe(1)

    store.put('two.ts', '2')
    expect(store.size).toBe(2)

    store.delete('one.ts')
    expect(store.size).toBe(1)
  })

  it('flush() is an immediate durability barrier and clear() removes all content', async () => {
    const store = new InMemoryContentStore()
    store.put('one.ts', '1')
    store.put('two.ts', '2')

    await expect(store.flush()).resolves.toBeUndefined()
    await expect(store.clear()).resolves.toBeUndefined()

    expect(store.size).toBe(0)
  })
})

describe('IDBContentStore publication cancellation', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('does not publish a queued write after its repository session aborts', async () => {
    const controller = new AbortController()
    const stale = new IDBContentStore('acme/repo', controller.signal)
    stale.put('stale.ts', 'stale')
    controller.abort()
    await expect(stale.flush()).rejects.toMatchObject({ name: 'AbortError' })

    const current = new IDBContentStore('acme/repo')
    expect(await current.get('stale.ts')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CodeIndex Phase 3 dual-write
// ---------------------------------------------------------------------------

describe('CodeIndex Phase 3 dual-write', () => {
  it('createEmptyIndex() creates meta Map and InMemoryContentStore', () => {
    const idx = createEmptyIndex()

    expect(idx.meta).toBeInstanceOf(Map)
    expect(idx.meta!.size).toBe(0)
    expect(idx.contentStore).toBeInstanceOf(InMemoryContentStore)
    expect(idx.contentStore!.size).toBe(0)
  })

  it('indexFile() populates meta and contentStore alongside files', () => {
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'src/app.ts', 'const x = 1;\n', 'typescript')

    expect(idx.files.has('src/app.ts')).toBe(true)
    expect(idx.meta!.has('src/app.ts')).toBe(true)
    expect(idx.contentStore!.has('src/app.ts')).toBe(true)
  })

  it('indexFile() meta entry has correct fields', () => {
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'src/utils/helpers.ts', 'line1\nline2\nline3', 'typescript')

    const meta = idx.meta!.get('src/utils/helpers.ts')
    expect(meta).toBeDefined()
    expect(meta!.path).toBe('src/utils/helpers.ts')
    expect(meta!.name).toBe('helpers.ts')
    expect(meta!.language).toBe('typescript')
    expect(meta!.lineCount).toBe(3)
  })

  it('indexFile() contentStore has the file content', () => {
    const content = 'export function greet() { return "hi"; }'
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'greet.ts', content, 'typescript')

    expect(idx.contentStore!.getSync('greet.ts')).toBe(content)
  })

  it('batchIndexFiles() populates meta and contentStore for all entries', () => {
    const updates = [
      { path: 'a.ts', content: 'const a = 1;', language: 'typescript' },
      { path: 'b.py', content: 'b = 2', language: 'python' },
      { path: 'c.rs', content: 'let c = 3;', language: 'rust' },
    ]

    const idx = batchIndexFiles(createEmptyIndex(), updates)

    expect(idx.meta!.size).toBe(3)
    expect(idx.contentStore!.size).toBe(3)

    for (const u of updates) {
      expect(idx.meta!.has(u.path)).toBe(true)
      expect(idx.contentStore!.getSync(u.path)).toBe(u.content)
    }
  })

  it('removeFromIndex() removes from meta and contentStore', () => {
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'keep.ts', 'keep', 'typescript')
    idx = indexFile(idx, 'remove.ts', 'remove', 'typescript')

    idx = removeFromIndex(idx, 'remove.ts')

    expect(idx.files.has('remove.ts')).toBe(false)
    expect(idx.meta!.has('remove.ts')).toBe(false)
    expect(idx.contentStore!.has('remove.ts')).toBe(false)

    // The other file is still there
    expect(idx.files.has('keep.ts')).toBe(true)
    expect(idx.meta!.has('keep.ts')).toBe(true)
    expect(idx.contentStore!.has('keep.ts')).toBe(true)
  })

  it('contentStore.size always equals totalFiles', () => {
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'a.ts', 'a')
    expect(idx.contentStore!.size).toBe(idx.totalFiles)

    idx = indexFile(idx, 'b.ts', 'b')
    expect(idx.contentStore!.size).toBe(idx.totalFiles)

    idx = removeFromIndex(idx, 'a.ts')
    expect(idx.contentStore!.size).toBe(idx.totalFiles)
  })

  it('meta.size always equals totalFiles', () => {
    let idx = createEmptyIndex()
    idx = indexFile(idx, 'a.ts', 'a')
    expect(idx.meta!.size).toBe(idx.totalFiles)

    idx = batchIndexFiles(idx, [
      { path: 'b.ts', content: 'b' },
      { path: 'c.ts', content: 'c' },
    ])
    expect(idx.meta!.size).toBe(idx.totalFiles)

    idx = removeFromIndex(idx, 'b.ts')
    expect(idx.meta!.size).toBe(idx.totalFiles)
  })

  it('backward compat: indexFile() works on a CodeIndex without meta/contentStore', () => {
    // Simulate a legacy CodeIndex that has no meta/contentStore fields
    const legacyIndex: CodeIndex = {
      files: new Map(),
      totalFiles: 0,
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: new InMemoryContentStore(),
    }

    const result = indexFile(legacyIndex, 'legacy.ts', 'const x = 1;\n', 'typescript')

    expect(result.totalFiles).toBe(1)
    expect(result.files.has('legacy.ts')).toBe(true)
    // Phase 3 fields are populated even when starting from a legacy index
    expect(result.meta!.has('legacy.ts')).toBe(true)
    expect(result.contentStore!.has('legacy.ts')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// IDBContentStore
// ---------------------------------------------------------------------------

describe('IDBContentStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('put() and get() round-trip', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('src/index.ts', 'export default 42;')

    await store.flush()

    const result = await store.get('src/index.ts')
    expect(result).toBe('export default 42;')
  })

  it('getSync() returns null (IDB is async)', () => {
    const store = new IDBContentStore('owner/repo')
    store.put('file.ts', 'content')

    expect(store.getSync('file.ts')).toBeNull()
  })

  it('getBatch() returns multiple files', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: 'a.ts', content: 'aaa' },
      { path: 'b.ts', content: 'bbb' },
    ])

    await store.flush()

    const result = await store.getBatch(['a.ts', 'b.ts', 'missing.ts'])
    expect(result.size).toBe(2)
    expect(result.get('a.ts')).toBe('aaa')
    expect(result.get('b.ts')).toBe('bbb')
    expect(result.has('missing.ts')).toBe(false)
  })

  it('getBatch() returns empty map for empty paths array', async () => {
    const store = new IDBContentStore('owner/repo')
    const result = await store.getBatch([])
    expect(result.size).toBe(0)
  })

  it('putBatch() stores multiple entries', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: 'x.ts', content: 'x-content' },
      { path: 'y.ts', content: 'y-content' },
    ])

    await store.flush()

    expect(await store.get('x.ts')).toBe('x-content')
    expect(await store.get('y.ts')).toBe('y-content')
  })

  it('has() returns true/false correctly', () => {
    const store = new IDBContentStore('owner/repo')
    store.put('exists.ts', 'data')

    expect(store.has('exists.ts')).toBe(true)
    expect(store.has('missing.ts')).toBe(false)
  })

  it('delete() removes content', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('temp.ts', 'temporary')
    expect(store.has('temp.ts')).toBe(true)

    store.delete('temp.ts')

    expect(store.has('temp.ts')).toBe(false)
    expect(store.size).toBe(0)

    await store.flush()
    expect(await store.get('temp.ts')).toBeNull()
  })

  it('size reflects entry count', () => {
    const store = new IDBContentStore('owner/repo')
    expect(store.size).toBe(0)

    store.put('one.ts', '1')
    expect(store.size).toBe(1)

    store.put('two.ts', '2')
    expect(store.size).toBe(2)

    store.delete('one.ts')
    expect(store.size).toBe(1)
  })

  it('getAllSync() throws', () => {
    const store = new IDBContentStore('owner/repo')
    expect(() => store.getAllSync()).toThrow(
      'IDBContentStore does not support synchronous getAllSync()'
    )
  })

  it('clear() removes all repo content', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: 'a.ts', content: 'aaa' },
      { path: 'b.ts', content: 'bbb' },
    ])

    await new Promise((r) => setTimeout(r, 10))

    await store.clear()

    expect(store.size).toBe(0)
    expect(store.has('a.ts')).toBe(false)
    expect(await store.get('a.ts')).toBeNull()
    expect(await store.get('b.ts')).toBeNull()
  })

  it('get() returns null for missing paths', async () => {
    const store = new IDBContentStore('owner/repo')
    const result = await store.get('nonexistent.ts')
    expect(result).toBeNull()
  })

  it('keys are scoped to repoKey (isolation between repos)', async () => {
    const storeA = new IDBContentStore('alice/repo')
    const storeB = new IDBContentStore('bob/repo')

    storeA.put('file.ts', 'alice-content')
    storeB.put('file.ts', 'bob-content')

    await Promise.all([storeA.flush(), storeB.flush()])

    expect(await storeA.get('file.ts')).toBe('alice-content')
    expect(await storeB.get('file.ts')).toBe('bob-content')
  })

  it('flush() aggregates every outstanding transaction', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('a.ts', 'a')
    store.put('b.ts', 'b')
    store.delete('a.ts')
    store.put('c.ts', 'c')

    await store.flush()

    expect(await store.getBatch(['a.ts', 'b.ts', 'c.ts'])).toEqual(new Map([
      ['b.ts', 'b'],
      ['c.ts', 'c'],
    ]))
  })

  it('flush() snapshots its boundary while retaining later failures for the next flush', async () => {
    const originalTransaction = FakeIDBDatabase.prototype.transaction
    let readwriteTransactions = 0
    vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: InstanceType<typeof FakeIDBDatabase>,
      ...args
    ) {
      const tx = originalTransaction.apply(this, args)
      if (args[1] === 'readwrite' && ++readwriteTransactions === 2) {
        queueMicrotask(() => tx.abort())
      }
      return tx
    })

    const store = new IDBContentStore('owner/repo')
    store.put('before.ts', 'before')
    const firstFlush = store.flush()
    store.put('after.ts', 'after')

    await expect(firstFlush).resolves.toBeUndefined()
    await expect(store.flush()).rejects.toMatchObject({ name: 'AbortError' })
    expect(await store.get('before.ts')).toBe('before')
    expect(await store.get('after.ts')).toBeNull()
  })

  it('flush() rejects a synchronous quota failure instead of losing it', async () => {
    vi.spyOn(FakeIDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const store = new IDBContentStore('owner/repo')

    store.put('too-large.ts', 'content')

    await expect(store.flush()).rejects.toMatchObject({ name: 'QuotaExceededError' })
  })
})

describe('repository content cleanup', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('deleteRepoContent() cursor-deletes only the requested repo prefix', async () => {
    const target = new IDBContentStore('owner/repo')
    const sibling = new IDBContentStore('owner/repository')
    target.putBatch([
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
    ])
    sibling.put('src/a.ts', 'sibling')
    await Promise.all([target.flush(), sibling.flush()])

    await deleteRepoContent('owner/repo')

    expect(await target.getBatch(['src/a.ts', 'src/b.ts'])).toEqual(new Map())
    expect(await sibling.get('src/a.ts')).toBe('sibling')
  })

  it('explicit prefix deletion includes paths whose suffix starts with U+FFFF', async () => {
    const target = new IDBContentStore('owner/repo')
    const sibling = new IDBContentStore('owner/repository')
    target.put('\uffff-tail.ts', 'target')
    sibling.put('\uffff-tail.ts', 'sibling')
    await Promise.all([target.flush(), sibling.flush()])

    await deleteRepoContent('owner/repo')

    expect(await target.get('\uffff-tail.ts')).toBeNull()
    expect(await sibling.get('\uffff-tail.ts')).toBe('sibling')
  })

  it('stale cleanup includes U+FFFF-tail paths while retaining current content', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: '\uffff-old.ts', content: 'old' },
      { path: 'keep.ts', content: 'keep' },
    ])
    await store.flush()

    await deleteStaleRepoContent('owner/repo', new Set(['keep.ts']))

    expect(await store.get('\uffff-old.ts')).toBeNull()
    expect(await store.get('keep.ts')).toBe('keep')
  })

  it('an aborted prefix deletion leaves repository content intact', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('keep.ts', 'keep')
    await store.flush()
    const controller = new AbortController()
    controller.abort()

    await expect(deleteRepoContent('owner/repo', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await store.get('keep.ts')).toBe('keep')
  })

  it('rolls back cursor deletions when cleanup aborts mid-transaction', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
    ])
    await store.flush()
    const controller = new AbortController()
    const originalDelete = FakeIDBCursor.prototype.delete
    vi.spyOn(FakeIDBCursor.prototype, 'delete').mockImplementationOnce(function (
      this: InstanceType<typeof FakeIDBCursor>,
    ) {
      const request = originalDelete.call(this)
      queueMicrotask(() => controller.abort())
      return request
    })

    await expect(deleteRepoContent('owner/repo', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(await store.get('a.ts')).toBe('a')
    expect(await store.get('b.ts')).toBe('b')
  })

  it('clearAllRepoContent() removes every repository content record', async () => {
    const first = new IDBContentStore('one/repo')
    const second = new IDBContentStore('two/repo')
    first.put('a.ts', 'a')
    second.put('b.ts', 'b')
    await Promise.all([first.flush(), second.flush()])

    await clearAllRepoContent()

    expect(await first.get('a.ts')).toBeNull()
    expect(await second.get('b.ts')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LazyContentStore
// ---------------------------------------------------------------------------

describe('LazyContentStore', () => {
  let mockFetchFn: ReturnType<typeof vi.fn>
  let fetchQueue: FetchQueue

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    mockFetchFn = vi.fn(async (path: string) => `fetched:${path}`)
    fetchQueue = new FetchQueue({ fetchFn: mockFetchFn as unknown as (path: string) => Promise<string> })
  })

  it('constructor initializes with empty metadataPaths and loadedPaths', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)

    expect(store.size).toBe(0)
    expect(store.hasContent('any.ts')).toBe(false)
    expect(store.getContentStatus()).toEqual({ total: 0, loaded: 0, pending: 0 })
  })

  it('registerPaths() adds paths to metadataPaths', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)

    store.registerPaths(['a.ts', 'b.ts', 'c.ts'])

    expect(store.size).toBe(3)
    expect(store.has('a.ts')).toBe(true)
    expect(store.has('b.ts')).toBe(true)
    expect(store.has('c.ts')).toBe(true)
  })

  it('registerPaths() is additive', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)

    store.registerPaths(['a.ts'])
    store.registerPaths(['b.ts', 'c.ts'])

    expect(store.size).toBe(3)
  })

  it('has() returns true for metadata paths, false for unknown', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['known.ts'])

    expect(store.has('known.ts')).toBe(true)
    expect(store.has('unknown.ts')).toBe(false)
  })

  it('hasContent() returns false before content is loaded', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['file.ts'])

    expect(store.hasContent('file.ts')).toBe(false)
  })

  it('put() stores content and marks path as loaded', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['file.ts'])

    store.put('file.ts', 'content-data')

    expect(store.hasContent('file.ts')).toBe(true)

    // Wait for IDB write to settle
    await new Promise((r) => setTimeout(r, 10))
    const result = await store.get('file.ts')
    expect(result).toBe('content-data')
  })

  it('putBatch() stores multiple files and marks all as loaded', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['a.ts', 'b.ts'])

    store.putBatch([
      { path: 'a.ts', content: 'aaa' },
      { path: 'b.ts', content: 'bbb' },
    ])

    expect(store.hasContent('a.ts')).toBe(true)
    expect(store.hasContent('b.ts')).toBe(true)

    await new Promise((r) => setTimeout(r, 10))
    expect(await store.get('a.ts')).toBe('aaa')
    expect(await store.get('b.ts')).toBe('bbb')
  })

  it('get() returns content from IDB for loaded files', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['file.ts'])
    store.put('file.ts', 'stored-content')

    await new Promise((r) => setTimeout(r, 10))

    const result = await store.get('file.ts')
    expect(result).toBe('stored-content')
    // Should NOT call fetchFn since content is in IDB
    expect(mockFetchFn).not.toHaveBeenCalled()
  })

  it('get() triggers FetchQueue for unloaded metadata paths', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['lazy.ts'])

    const result = await store.get('lazy.ts')

    expect(result).toBe('fetched:lazy.ts')
    expect(mockFetchFn).toHaveBeenCalledWith('lazy.ts')
    // After fetch, content should be loaded
    expect(store.hasContent('lazy.ts')).toBe(true)
  })

  it('get() returns null for completely unknown paths', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)

    const result = await store.get('unknown.ts')

    expect(result).toBeNull()
    expect(mockFetchFn).not.toHaveBeenCalled()
  })

  it('get() returns null when fetch fails', async () => {
    mockFetchFn.mockRejectedValue(new Error('Network error'))
    const failQueue = new FetchQueue({ fetchFn: mockFetchFn as unknown as (path: string) => Promise<string> })
    const store = new LazyContentStore('owner/repo', failQueue)
    store.registerPaths(['fail.ts'])

    const result = await store.get('fail.ts')

    expect(result).toBeNull()
  })

  it('getSync() always returns null', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['file.ts'])
    store.put('file.ts', 'content')

    expect(store.getSync('file.ts')).toBeNull()
  })

  it('getBatch() reads from IDB only — does not trigger fetches', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['loaded.ts', 'unloaded.ts'])
    store.put('loaded.ts', 'data')

    await new Promise((r) => setTimeout(r, 10))

    const result = await store.getBatch(['loaded.ts', 'unloaded.ts'])

    expect(result.size).toBe(1)
    expect(result.get('loaded.ts')).toBe('data')
    expect(result.has('unloaded.ts')).toBe(false)
    expect(mockFetchFn).not.toHaveBeenCalled()
  })

  it('getContentStatus() returns correct counts', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['a.ts', 'b.ts', 'c.ts'])
    store.put('a.ts', 'content-a')

    const status = store.getContentStatus()

    expect(status.total).toBe(3)
    expect(status.loaded).toBe(1)
    expect(status.pending).toBe(0)
  })

  it('delete() removes from all internal sets and IDB', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['file.ts'])
    store.put('file.ts', 'content')

    expect(store.has('file.ts')).toBe(true)
    expect(store.hasContent('file.ts')).toBe(true)

    store.delete('file.ts')

    expect(store.has('file.ts')).toBe(false)
    expect(store.hasContent('file.ts')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('size returns metadataPaths count', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    expect(store.size).toBe(0)

    store.registerPaths(['a.ts', 'b.ts'])
    expect(store.size).toBe(2)

    store.delete('a.ts')
    expect(store.size).toBe(1)
  })

  it('getFetchQueue() returns the underlying FetchQueue', () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    expect(store.getFetchQueue()).toBe(fetchQueue)
  })

  it('clear() resets all state and aborts pending fetches', async () => {
    const store = new LazyContentStore('owner/repo', fetchQueue)
    store.registerPaths(['a.ts', 'b.ts'])
    store.put('a.ts', 'content')

    await store.clear()

    expect(store.size).toBe(0)
    expect(store.has('a.ts')).toBe(false)
    expect(store.hasContent('a.ts')).toBe(false)
    expect(store.getContentStatus()).toEqual({ total: 0, loaded: 0, pending: 0 })
  })
})

// ---------------------------------------------------------------------------
// createEmptyIndexWithStore
// ---------------------------------------------------------------------------

describe('createEmptyIndexWithStore', () => {
  it('uses the provided InMemoryContentStore', () => {
    const store = new InMemoryContentStore(new Map([['a.ts', 'aaa']]))
    const idx = createEmptyIndexWithStore(store)

    expect(idx.contentStore).toBe(store)
    expect(idx.files.size).toBe(0)
    expect(idx.meta!.size).toBe(0)
  })

  it('uses the provided IDBContentStore', () => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange

    const store = new IDBContentStore('owner/repo')
    const idx = createEmptyIndexWithStore(store)

    expect(idx.contentStore).toBe(store)
    expect(idx.totalFiles).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CodeIndex operations with IDBContentStore
// ---------------------------------------------------------------------------

describe('CodeIndex with IDBContentStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('batchIndexFiles() works with IDBContentStore', () => {
    const store = new IDBContentStore('owner/repo')
    const idx = createEmptyIndexWithStore(store)

    const updates = [
      { path: 'a.ts', content: 'const a = 1;', language: 'typescript' },
      { path: 'b.py', content: 'b = 2', language: 'python' },
    ]

    const result = batchIndexFiles(idx, updates)

    expect(result.totalFiles).toBe(2)
    expect(result.files.has('a.ts')).toBe(true)
    expect(result.files.has('b.py')).toBe(true)
    expect(result.meta!.size).toBe(2)
    // IDB store is the same reference (mutated in-place)
    expect(result.contentStore).toBe(store)
    expect(store.has('a.ts')).toBe(true)
    expect(store.has('b.py')).toBe(true)
    expect(store.size).toBe(2)
  })

  it('indexFile() works with IDBContentStore', () => {
    const store = new IDBContentStore('owner/repo')
    const idx = createEmptyIndexWithStore(store)

    const result = indexFile(idx, 'src/main.ts', 'const x = 1;', 'typescript')

    expect(result.totalFiles).toBe(1)
    expect(result.contentStore).toBe(store)
    expect(store.has('src/main.ts')).toBe(true)
    expect(store.size).toBe(1)
  })

  it('removeFromIndex() works with IDBContentStore', () => {
    const store = new IDBContentStore('owner/repo')
    let idx = createEmptyIndexWithStore(store)
    idx = indexFile(idx, 'keep.ts', 'keep', 'typescript')
    idx = indexFile(idx, 'remove.ts', 'remove', 'typescript')

    idx = removeFromIndex(idx, 'remove.ts')

    expect(idx.files.has('remove.ts')).toBe(false)
    expect(idx.meta!.has('remove.ts')).toBe(false)
    expect(store.has('remove.ts')).toBe(false)
    // Kept file is still there
    expect(idx.files.has('keep.ts')).toBe(true)
    expect(store.has('keep.ts')).toBe(true)
    expect(idx.contentStore).toBe(store)
  })

  it('IDB store is shared (same reference) across index operations', () => {
    const store = new IDBContentStore('owner/repo')
    const idx = createEmptyIndexWithStore(store)

    const idx2 = indexFile(idx, 'a.ts', 'a')
    const idx3 = indexFile(idx2, 'b.ts', 'b')
    const idx4 = removeFromIndex(idx3, 'a.ts')

    expect(idx2.contentStore).toBe(store)
    expect(idx3.contentStore).toBe(store)
    expect(idx4.contentStore).toBe(store)
    expect(store.size).toBe(1)
    expect(store.has('b.ts')).toBe(true)
  })
})
