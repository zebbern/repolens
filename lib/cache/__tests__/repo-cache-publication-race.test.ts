import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb'
import type { FileNode, RepositoryCoverage } from '@/types/repository'

const cleanupRace = vi.hoisted(() => {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  return { entered, released, enter, release, calls: 0 }
})

vi.mock('@/lib/code/content-store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/code/content-store')>()
  return {
    ...actual,
    deleteStaleRepoContent: async (
      repoKey: string,
      retainedPaths: ReadonlySet<string>,
      signal?: AbortSignal,
    ) => {
      cleanupRace.calls++
      if (cleanupRace.calls === 1) {
        cleanupRace.enter()
        await cleanupRace.released
      }
      return actual.deleteStaleRepoContent(repoKey, retainedPaths, signal)
    },
  }
})

import { getCachedRepo, setCachedRepo } from '../repo-cache'
import { IDBContentStore } from '@/lib/code/content-store'

const TREE: FileNode[] = [{ name: 'index.ts', path: 'index.ts', type: 'file' }]
const COVERAGE: RepositoryCoverage = {
  treeStatus: 'complete',
  supportedFiles: { discovered: 1, loaded: 1 },
  failures: { count: 0, samples: [] },
  failedSubtrees: { count: 0, samples: [] },
  mode: 'full',
}

describe('repository cache publication generations', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })

  it('prevents obsolete cleanup and LRU work after a newer same-repo publication', async () => {
    const store = new IDBContentStore('owner/repo')
    store.put('old-only.ts', 'old')
    await store.flush()
    await setCachedRepo('owner', 'repo', 'sha-old', [
      { path: 'old-only.ts', content: 'old' },
    ], TREE, COVERAGE, undefined, { contentPaths: ['old-only.ts'] })

    const getAllSpy = vi.spyOn(FakeIDBObjectStore.prototype, 'getAll')
    store.put('a-only.ts', 'a')
    await store.flush()
    const publishA = setCachedRepo('owner', 'repo', 'sha-a', [
      { path: 'a-only.ts', content: 'a' },
    ], TREE, COVERAGE, undefined, { contentPaths: ['a-only.ts'] })
    await cleanupRace.entered

    store.put('b-only.ts', 'b')
    await store.flush()
    await setCachedRepo('owner', 'repo', 'sha-b', [
      { path: 'b-only.ts', content: 'b' },
    ], TREE, COVERAGE, undefined, { contentPaths: ['b-only.ts'] })
    const lruReadsAfterB = getAllSpy.mock.calls.length

    cleanupRace.release()
    await publishA

    expect(getAllSpy).toHaveBeenCalledTimes(lruReadsAfterB)
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-b')
    expect(await store.get('b-only.ts')).toBe('b')
    expect(await store.get('a-only.ts')).toBeNull()
  })
})
