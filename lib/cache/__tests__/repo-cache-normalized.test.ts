import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { IDBContentStore } from '@/lib/code/content-store'
import { withCacheMutationLock } from '../cache-mutation-lock'
import { installFakeWebLocks } from './fake-web-lock-manager'
import {
  REPO_CACHE_SCHEMA_VERSION,
  getContentStoreKey,
  getRepoKey,
  getCachedRepo,
  isReusableCachedRepo,
  listCachedRepos,
  publishCachedRepo,
  withHydratedCachedRepo,
  type CachedRepo,
} from '../repo-cache'

const TREE: FileNode[] = [{ name: 'index.ts', path: 'index.ts', type: 'file' }]
const COVERAGE: RepositoryCoverage = {
  treeStatus: 'complete',
  supportedFiles: { discovered: 1, loaded: 1 },
  failures: { count: 0, samples: [] },
  failedSubtrees: { count: 0, samples: [] },
  mode: 'full',
}

async function readRawManifest(key: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('repolens-cache', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('repos')) {
        request.result.createObjectStore('repos', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('repos', 'readonly').objectStore('repos').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function writeRawManifest(value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('repolens-cache', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('repos')) {
        request.result.createObjectStore('repos', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('repos', 'readwrite')
      transaction.objectStore('repos').put(value)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

describe('normalized repository cache content', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    installFakeWebLocks()
  })

  it('derives the repository key and exact tree-SHA content namespace consistently', () => {
    expect(getRepoKey('acme', 'project')).toBe('acme/project')
    expect(getContentStoreKey('acme', 'project', 'tree-123')).toBe('acme/project@tree-123')
  })

  it('rejects records without a valid inline/idb discriminator even when completeness markers pass', () => {
    const base = {
      schemaVersion: REPO_CACHE_SCHEMA_VERSION,
      coverage: COVERAGE,
      complete: true,
      key: 'acme/project',
      owner: 'acme',
      repo: 'project',
      sha: 'tree-123',
      timestamp: 1,
      tree: TREE,
    }

    expect(isReusableCachedRepo({ ...base } as CachedRepo)).toBe(false)
    expect(isReusableCachedRepo({ ...base, content: { kind: 'inline' } } as CachedRepo)).toBe(false)
    expect(isReusableCachedRepo({
      ...base,
      content: { kind: 'idb', storeKey: 'wrong', files: [{ path: 'index.ts', lineCount: 1 }] },
    } as CachedRepo)).toBe(false)
    expect(isReusableCachedRepo({
      ...base,
      content: { kind: 'future-format', files: [] },
    } as unknown as CachedRepo)).toBe(false)
  })

  it('invalidates an unknown runtime discriminator instead of listing or reusing it', async () => {
    await writeRawManifest({
      schemaVersion: REPO_CACHE_SCHEMA_VERSION,
      coverage: COVERAGE,
      complete: true,
      key: 'acme/bogus',
      owner: 'acme',
      repo: 'bogus',
      sha: 'tree-123',
      timestamp: 1,
      tree: TREE,
      content: { kind: 'future-format', files: [] },
    })

    expect(await listCachedRepos()).toEqual([])
    expect(await readRawManifest('acme/bogus')).toBeUndefined()
    expect(await getCachedRepo('acme', 'bogus')).toBeNull()
  })

  it('invalidates a current-schema manifest with a missing content payload', async () => {
    await writeRawManifest({
      schemaVersion: REPO_CACHE_SCHEMA_VERSION,
      coverage: COVERAGE,
      complete: true,
      key: 'acme/missing',
      owner: 'acme',
      repo: 'missing',
      sha: 'tree-123',
      timestamp: 1,
      tree: TREE,
    })

    expect(await listCachedRepos()).toEqual([])
    expect(await readRawManifest('acme/missing')).toBeUndefined()
    expect(await getCachedRepo('acme', 'missing')).toBeNull()
  })

  it('rehydrates an idb manifest as metadata without duplicating source in the manifest or file map', async () => {
    const storeKey = getContentStoreKey('acme', 'project', 'tree-123')
    await withCacheMutationLock(undefined, async lease => {
      const store = new IDBContentStore(storeKey, lease.signal, { kind: 'coordinated', lease })
      store.put('index.ts', 'export const sourceOnlyInIdb = true')
      await store.flush()
      await publishCachedRepo(lease, 'acme', 'project', 'tree-123', {
        kind: 'idb',
        storeKey,
        files: [{ path: 'index.ts', language: 'typescript', lineCount: 1 }],
      }, TREE, COVERAGE)
    })

    const cached = await getCachedRepo('acme', 'project')
    expect(cached?.content).toEqual({
      kind: 'idb',
      storeKey: 'acme/project@tree-123',
      files: [{ path: 'index.ts', language: 'typescript', lineCount: 1 }],
    })
    expect(JSON.stringify(cached)).not.toContain('sourceOnlyInIdb')

    let hydratedSource: string | null = null
    const hit = await withHydratedCachedRepo('acme', 'project', 'tree-123', {}, async ({ index }) => {
      expect(index.files.get('index.ts')).not.toHaveProperty('content')
      hydratedSource = await index.contentStore.get('index.ts')
    })
    expect(hit).toBe(true)
    expect(hydratedSource).toBe('export const sourceOnlyInIdb = true')
  })

  it('does not publish partial coverage', async () => {
    await withCacheMutationLock(undefined, lease => publishCachedRepo(
      lease,
      'acme',
      'partial',
      'tree-123',
      { kind: 'inline', files: [{ path: 'index.ts', content: 'partial' }] },
      TREE,
      {
        ...COVERAGE,
        supportedFiles: { discovered: 1, loaded: 0 },
        failures: { count: 1, samples: [{ path: 'index.ts', error: 'failed' }] },
      },
    ))

    expect(await getCachedRepo('acme', 'partial')).toBeNull()
    expect(await readRawManifest('acme/partial')).toBeUndefined()
  })
})
