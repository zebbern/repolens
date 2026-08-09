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
  getContentStoreKey,
  publishCachedRepo,
  withHydratedCachedRepo,
} from '../repo-cache'
import { IDBContentStore } from '@/lib/code/content-store'
import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { installFakeWebLocks } from './fake-web-lock-manager'
import {
  CacheCoordinationUnavailableError,
  createCacheMutationCoordinator,
  withCacheMutationLock,
} from '../cache-mutation-lock'

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

async function publishIdbRepo(
  owner: string,
  repo: string,
  sha: string,
  files: Array<{ path: string; content: string; language?: string }> = SAMPLE_FILES,
): Promise<IDBContentStore> {
  const storeKey = getContentStoreKey(owner, repo, sha)
  await withCacheMutationLock(undefined, async lease => {
    const store = new IDBContentStore(storeKey, lease.signal, { kind: 'coordinated', lease })
    store.putBatch(files)
    await store.flush()
    await publishCachedRepo(lease, owner, repo, sha, {
      kind: 'idb',
      storeKey,
      files: files.map(file => ({
        path: file.path,
        language: file.language,
        lineCount: file.content.split('\n').length,
      })),
    }, SAMPLE_TREE, SAMPLE_COVERAGE)
  })
  const reader = new IDBContentStore(storeKey, undefined, { kind: 'disabled' })
  reader.registerPaths(files.map(file => file.path))
  return reader
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
    installFakeWebLocks()
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
    expect(cached!.content).toEqual({ kind: 'inline', files: SAMPLE_FILES })
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
    const alpha = await publishIdbRepo('owner', 'alpha', 'sha1', [
      { path: 'src/index.ts', content: 'alpha' },
    ])
    const beta = await publishIdbRepo('owner', 'beta', 'sha2', [
      { path: 'src/index.ts', content: 'beta' },
    ])

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
      stores.push(await publishIdbRepo('owner', `repo-${i}`, `sha-${i}`, [
        { path: 'index.ts', content: `repo-${i}` },
      ]))
    }

    expect(await stores[0].get('index.ts')).toBeNull()
    expect(await stores[1].get('index.ts')).toBe('repo-2')
  })

  it('observes background LRU content cleanup failures without failing publication', async () => {
    for (let i = 1; i <= 5; i++) {
      await publishIdbRepo('owner', `repo-${i}`, `sha-${i}`, [
        { path: 'index.ts', content: `repo-${i}` },
      ])
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
    const oldStore = await publishIdbRepo('owner', 'repo', 'sha-old', [
      { path: 'old.ts', content: 'old' },
      { path: 'keep.ts', content: 'old keep' },
    ])
    const writes: string[] = []
    const originalTransaction = FakeIDBDatabase.prototype.transaction
    vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: InstanceType<typeof FakeIDBDatabase>,
      ...args
    ) {
      if (args[1] === 'readwrite') writes.push(this.name)
      return originalTransaction.apply(this, args)
    })

    const newFiles = [
      { path: 'keep.ts', content: 'new keep' },
      { path: 'new.ts', content: 'new' },
    ]
    const newStoreKey = getContentStoreKey('owner', 'repo', 'sha-new')
    await withCacheMutationLock(undefined, async lease => {
      const newStore = new IDBContentStore(newStoreKey, lease.signal, { kind: 'coordinated', lease })
      newStore.putBatch(newFiles)
      await newStore.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-new', {
        kind: 'idb',
        storeKey: newStoreKey,
        files: newFiles.map(file => ({
          path: file.path,
          lineCount: file.content.split('\n').length,
        })),
      }, SAMPLE_TREE, SAMPLE_COVERAGE)
    })

    expect(writes.slice(0, 3)).toEqual(['repolens-content', 'repolens-cache', 'repolens-content'])
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-new')
    expect(await oldStore.get('old.ts')).toBeNull()
    expect(await oldStore.get('keep.ts')).toBeNull()
    const newStore = new IDBContentStore(newStoreKey, undefined, { kind: 'disabled' })
    expect(await newStore.get('keep.ts')).toBe('new keep')
    expect(await newStore.get('new.ts')).toBe('new')
  })

  it('retains the previous namespace when replacement manifest publication fails', async () => {
    const oldStore = await publishIdbRepo('owner', 'repo', 'sha-old', [
      { path: 'old.ts', content: 'old' },
    ])
    const originalTransaction = FakeIDBDatabase.prototype.transaction
    vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: InstanceType<typeof FakeIDBDatabase>,
      ...args
    ) {
      if (this.name === 'repolens-cache' && args[1] === 'readwrite') {
        throw new DOMException('manifest publication failed', 'UnknownError')
      }
      return originalTransaction.apply(this, args)
    })

    const newStoreKey = getContentStoreKey('owner', 'repo', 'sha-new')
    await expect(withCacheMutationLock(undefined, async lease => {
      const newStore = new IDBContentStore(newStoreKey, lease.signal, { kind: 'coordinated', lease })
      newStore.put('new.ts', 'new')
      await newStore.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-new', {
        kind: 'idb',
        storeKey: newStoreKey,
        files: [{ path: 'new.ts', lineCount: 1 }],
      }, SAMPLE_TREE, SAMPLE_COVERAGE)
    })).rejects.toMatchObject({ name: 'UnknownError' })

    vi.restoreAllMocks()
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-old')
    expect(await oldStore.get('old.ts')).toBe('old')
  })

  it('does not delete the active namespace when the same tree SHA is republished', async () => {
    const store = await publishIdbRepo('owner', 'repo', 'same-sha', [
      { path: 'index.ts', content: 'first' },
    ])
    const storeKey = getContentStoreKey('owner', 'repo', 'same-sha')

    await withCacheMutationLock(undefined, async lease => {
      const writer = new IDBContentStore(storeKey, lease.signal, { kind: 'coordinated', lease })
      writer.put('index.ts', 'second')
      await writer.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'same-sha', {
        kind: 'idb', storeKey, files: [{ path: 'index.ts', lineCount: 1 }],
      }, SAMPLE_TREE, SAMPLE_COVERAGE)
    })

    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('same-sha')
    expect(await store.get('index.ts')).toBe('second')
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

  it('does not publish shared cache state when only module-local coordination is available', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('old.ts', 'old')
    await store.flush()
    await setCachedRepo('owner', 'repo', 'sha-old', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)

    const fallback = createCacheMutationCoordinator(() => null)
    store.put('new.ts', 'new')
    await store.flush()
    await expect(setCachedRepo('owner', 'repo', 'sha-new', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
      coordinator: fallback, contentPaths: ['new.ts'],
    })).rejects.toBeInstanceOf(CacheCoordinationUnavailableError)

    expect(await store.get('old.ts')).toBe('old')
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-old')

    const secondRealm = createCacheMutationCoordinator(() => null)
    await expect(setCachedRepo('owner', 'repo', 'sha-other', [], SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
      coordinator: secondRealm,
    })).rejects.toBeInstanceOf(CacheCoordinationUnavailableError)
    expect(await getCachedRepo('owner', 'repo', { coordinator: fallback })).toBeNull()
  })

  it('surfaces explicit cleanup failure without cross-context coordination', async () => {
    const fallback = createCacheMutationCoordinator(() => null)
    await expect(clearCachedRepo('owner', 'repo', { coordinator: fallback }))
      .rejects.toBeInstanceOf(CacheCoordinationUnavailableError)
    await expect(clearAllCache({ coordinator: fallback }))
      .rejects.toBeInstanceOf(CacheCoordinationUnavailableError)
  })

  it('keeps independent fallback realms from publishing competing manifests', async () => {
    const firstRealm = createCacheMutationCoordinator(() => null)
    const secondRealm = createCacheMutationCoordinator(() => null)
    await Promise.all([
      expect(setCachedRepo('fallback', 'repo', 'sha-a', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
        coordinator: firstRealm,
      })).rejects.toBeInstanceOf(CacheCoordinationUnavailableError),
      expect(setCachedRepo('fallback', 'repo', 'sha-b', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE, undefined, {
        coordinator: secondRealm,
      })).rejects.toBeInstanceOf(CacheCoordinationUnavailableError),
    ])
    expect(await getCachedRepo('fallback', 'repo')).toBeNull()
  })

  it('does not look up or claim a cache hit in fallback mode', async () => {
    await setCachedRepo('owner', 'repo', 'sha', SAMPLE_FILES, SAMPLE_TREE, SAMPLE_COVERAGE)
    const consume = vi.fn()
    const fallback = createCacheMutationCoordinator(() => null)

    await expect(withHydratedCachedRepo('owner', 'repo', 'sha', {
      useIDB: true,
      coordinator: fallback,
    }, consume)).resolves.toBe(false)
    expect(consume).not.toHaveBeenCalled()
  })
})
