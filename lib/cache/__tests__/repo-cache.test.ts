import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  IDBDatabase as FakeIDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from 'fake-indexeddb'
import {
  getCachedRepo,
  setCachedRepo,
  clearCachedRepo,
  clearAllCache,
  isReusableCachedRepo,
} from '../repo-cache'
import { IDBContentStore } from '@/lib/code/content-store'
import type { FileNode, RepositoryCoverage } from '@/types/repository'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_FILES = [
  { path: 'src/index.ts', content: 'export const x = 1;' },
  { path: 'README.md', content: '# Readme' },
]

const SAMPLE_TREE: FileNode[] = [
  { name: 'src', path: 'src', type: 'directory', children: [
    { name: 'index.ts', path: 'src/index.ts', type: 'file' },
  ]},
  { name: 'README.md', path: 'README.md', type: 'file' },
]

const SAMPLE_COVERAGE: RepositoryCoverage = {
  treeStatus: 'complete',
  supportedFiles: { discovered: 2, loaded: 2 },
  failures: { count: 0, samples: [] },
  failedSubtrees: { count: 0, samples: [] },
  mode: 'full',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repo-cache (IndexedDB)', () => {
  beforeEach(() => {
    // Give each test a fresh IndexedDB instance to avoid cross-test leaks.
    // fake-indexeddb provides a proper IDBFactory that works reliably in Node.
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('does not publish an aborted same-repository cache replacement', async () => {
    await setCachedRepo('owner', 'repo', 'current', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    const controller = new AbortController()
    controller.abort()
    await expect(setCachedRepo('owner', 'repo', 'stale', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('current')
  })

  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  it('returns null for a repo that has not been cached', async () => {
    const result = await getCachedRepo('owner', 'repo')
    expect(result).toBeNull()
  })

  it('round-trips: setCachedRepo then getCachedRepo returns stored data', async () => {
    await setCachedRepo('owner', 'repo', 'sha123', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    const cached = await getCachedRepo('owner', 'repo')

    expect(cached).not.toBeNull()
    expect(cached!.key).toBe('owner/repo')
    expect(cached!.sha).toBe('sha123')
    expect(cached!.files).toEqual(SAMPLE_FILES)
    expect(cached!.tree).toEqual(SAMPLE_TREE)
  })

  it('overwrites existing entry when setCachedRepo is called again', async () => {
    await setCachedRepo('owner', 'repo', 'sha-old', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    await setCachedRepo('owner', 'repo', 'sha-new', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    const cached = await getCachedRepo('owner', 'repo')
    expect(cached!.sha).toBe('sha-new')
  })

  // -----------------------------------------------------------------------
  // clearCachedRepo
  // -----------------------------------------------------------------------

  it('clearCachedRepo removes a specific repo and leaves others intact', async () => {
    await setCachedRepo('owner', 'alpha', 'sha1', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    await setCachedRepo('owner', 'beta', 'sha2', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    await clearCachedRepo('owner', 'alpha')

    const alpha = await getCachedRepo('owner', 'alpha')
    const beta = await getCachedRepo('owner', 'beta')

    expect(alpha).toBeNull()
    expect(beta).not.toBeNull()
  })

  it('clearCachedRepo removes only the matching repository content', async () => {
    const alpha = new IDBContentStore('owner/alpha')
    const beta = new IDBContentStore('owner/beta')
    alpha.put('src/index.ts', 'alpha')
    beta.put('src/index.ts', 'beta')
    await Promise.all([alpha.flush(), beta.flush()])
    await setCachedRepo('owner', 'alpha', 'sha1', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    await setCachedRepo('owner', 'beta', 'sha2', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    await clearCachedRepo('owner', 'alpha')

    expect(await alpha.get('src/index.ts')).toBeNull()
    expect(await beta.get('src/index.ts')).toBe('beta')
  })

  it('clearCachedRepo rejects when explicit content cleanup fails', async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error -- exercises the user-visible cleanup failure contract.
    globalThis.indexedDB = undefined

    await expect(clearCachedRepo('owner', 'repo')).rejects.toBeInstanceOf(TypeError)

    globalThis.indexedDB = original
  })

  // -----------------------------------------------------------------------
  // clearAllCache
  // -----------------------------------------------------------------------

  it('clearAllCache removes all entries', async () => {
    await setCachedRepo('owner', 'a', 'sha1', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    await setCachedRepo('owner', 'b', 'sha2', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    await setCachedRepo('owner', 'c', 'sha3', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    await clearAllCache()

    expect(await getCachedRepo('owner', 'a')).toBeNull()
    expect(await getCachedRepo('owner', 'b')).toBeNull()
    expect(await getCachedRepo('owner', 'c')).toBeNull()
  })

  it('clearAllCache removes content records across repositories', async () => {
    const first = new IDBContentStore('owner/a')
    const second = new IDBContentStore('owner/b')
    first.put('a.ts', 'a')
    second.put('b.ts', 'b')
    await Promise.all([first.flush(), second.flush()])

    await clearAllCache()

    expect(await first.get('a.ts')).toBeNull()
    expect(await second.get('b.ts')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------------

  it('evicts the oldest entry when more than 5 repos are cached (LRU)', async () => {
    // Store 6 repos with staggered timestamps (Date.now() advances naturally)
    for (let i = 1; i <= 6; i++) {
      await setCachedRepo('owner', `repo-${i}`, `sha-${i}`, SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    }

    // repo-1 should have been evicted (oldest timestamp)
    const evicted = await getCachedRepo('owner', 'repo-1')
    expect(evicted).toBeNull()

    // repo-2 through repo-6 should still exist
    for (let i = 2; i <= 6; i++) {
      const cached = await getCachedRepo('owner', `repo-${i}`)
      expect(cached).not.toBeNull()
      expect(cached!.sha).toBe(`sha-${i}`)
    }
  })

  it('LRU eviction removes evicted repository content but preserves retained repos', async () => {
    const stores: IDBContentStore[] = []
    for (let i = 1; i <= 6; i++) {
      const store = new IDBContentStore(`owner/repo-${i}`)
      store.put('index.ts', `repo-${i}`)
      await store.flush()
      stores.push(store)
      await setCachedRepo('owner', `repo-${i}`, `sha-${i}`, SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
        contentPaths: ['index.ts'],
      })
    }

    expect(await stores[0].get('index.ts')).toBeNull()
    expect(await stores[1].get('index.ts')).toBe('repo-2')
  })

  it('observes background LRU content cleanup failures without failing publication', async () => {
    for (let i = 1; i <= 5; i++) {
      await setCachedRepo('owner', `repo-${i}`, `sha-${i}`, SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(FakeIDBObjectStore.prototype, 'openCursor').mockImplementationOnce(() => {
      throw new DOMException('cleanup failed', 'UnknownError')
    })

    await expect(
      setCachedRepo('owner', 'repo-6', 'sha-6', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'Failed to remove evicted repository content for owner/repo-1:',
      expect.objectContaining({ name: 'UnknownError' }),
    )
  })

  // -----------------------------------------------------------------------
  // SHA comparison (cache freshness)
  // -----------------------------------------------------------------------

  it('stored SHA can be compared for cache hit vs miss', async () => {
    await setCachedRepo('owner', 'repo', 'abc123', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    const cached = await getCachedRepo('owner', 'repo')

    // Cache hit: SHA matches
    expect(cached!.sha).toBe('abc123')

    // Cache miss scenario: new SHA from server would differ
    const serverSha = 'def456'
    expect(cached!.sha !== serverSha).toBe(true)
  })

  it('publishes a replacement manifest before deleting only superseded content', async () => {
    const store = new IDBContentStore('owner/repo')
    store.putBatch([
      { path: 'old.ts', content: 'old' },
      { path: 'keep.ts', content: 'old keep' },
    ])
    await store.flush()
    await setCachedRepo('owner', 'repo', 'sha-old', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
      contentPaths: ['old.ts', 'keep.ts'],
    })

    store.putBatch([
      { path: 'keep.ts', content: 'new keep' },
      { path: 'new.ts', content: 'new' },
    ])
    await store.flush()
    const writes: string[] = []
    const originalTransaction = FakeIDBDatabase.prototype.transaction
    vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: InstanceType<typeof FakeIDBDatabase>,
      ...args
    ) {
      if (args[1] === 'readwrite') writes.push(this.name)
      return originalTransaction.apply(this, args)
    })

    await setCachedRepo('owner', 'repo', 'sha-new', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
      contentPaths: ['keep.ts', 'new.ts'],
    })

    expect(writes.slice(0, 2)).toEqual(['repolens-cache', 'repolens-content'])
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-new')
    expect(await store.get('old.ts')).toBeNull()
    expect(await store.get('keep.ts')).toBe('new keep')
    expect(await store.get('new.ts')).toBe('new')
  })

  it('does not reuse partial or failure-bearing cache records', async () => {
    await setCachedRepo('owner', 'partial', 'sha', SAMPLE_FILES, SAMPLE_TREE, {
      ...SAMPLE_COVERAGE,
      treeStatus: 'partial',
      failedSubtrees: { count: 1, samples: ['vendor'] },
    })
    await setCachedRepo('owner', 'failed', 'sha', SAMPLE_FILES, SAMPLE_TREE, {
      ...SAMPLE_COVERAGE,
      supportedFiles: { discovered: 2, loaded: 1 },
      failures: { count: 1, samples: [{ path: 'README.md', error: 'missing' }] },
    })

    expect(await getCachedRepo('owner', 'partial')).toBeNull()
    expect(await getCachedRepo('owner', 'failed')).toBeNull()
  })

  it('treats legacy records without schema and coverage markers as misses', () => {
    expect(isReusableCachedRepo({
      key: 'owner/legacy', owner: 'owner', repo: 'legacy', sha: 'old', timestamp: 1,
      files: SAMPLE_FILES, tree: SAMPLE_TREE,
    })).toBe(false)
  })

  it('invalidates schema 3 trees that represented submodules as normal files', () => {
    expect(isReusableCachedRepo({
      schemaVersion: 3,
      complete: true,
      coverage: SAMPLE_COVERAGE,
      key: 'owner/old-tree', owner: 'owner', repo: 'old-tree', sha: 'old', timestamp: 1,
      files: SAMPLE_FILES, tree: SAMPLE_TREE,
    })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Graceful degradation
  // -----------------------------------------------------------------------

  it('getCachedRepo returns null when indexedDB is unavailable', async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error — intentionally removing indexedDB for test
    globalThis.indexedDB = undefined

    const result = await getCachedRepo('owner', 'repo')
    expect(result).toBeNull()

    globalThis.indexedDB = original
  })

  it('setCachedRepo rejects when indexedDB is unavailable', async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error — intentionally removing indexedDB for test
    globalThis.indexedDB = undefined

    await expect(
      setCachedRepo('owner', 'repo', 'sha', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE),
    ).rejects.toBeInstanceOf(TypeError)

    globalThis.indexedDB = original
  })
})
