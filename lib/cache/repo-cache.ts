// IndexedDB cache for repository data — avoids re-fetching file contents
// when the HEAD commit hasn't changed.

import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { isCoverageComplete } from '@/lib/repository'
import {
  clearAllRepoContent,
  deleteRepoContent,
  IDBContentStore,
} from '@/lib/code/content-store'
import {
  requireCrossContextCacheCoordination,
  throwIfCacheMutationAborted,
  withCacheMutationLock,
  type CacheMutationCoordinator,
  type CacheMutationLease,
} from '@/lib/cache/cache-mutation-lock'
import type { CodeIndex } from '@/lib/code/code-index'
import { batchIndexFiles, batchIndexMetadataOnly, createEmptyIndex, createEmptyIndexWithStore } from '@/lib/code/code-index'
import { openIndexedDB } from '@/lib/code/open-indexed-db'

const DB_NAME = 'repolens-cache'
const STORE_NAME = 'repos'
const TOURS_STORE_NAME = 'tours'
const DB_VERSION = 2
const MAX_REPOS = 5
export const REPO_CACHE_SCHEMA_VERSION = 5

export interface CachedFileMetadata {
  path: string
  language?: string
  lineCount: number
}

export type CachedContent =
  | {
      kind: 'inline'
      files: Array<{ path: string; content: string; language?: string }>
    }
  | {
      kind: 'idb'
      storeKey: string
      files: CachedFileMetadata[]
    }

export function getRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`
}

export function getContentStoreKey(owner: string, repo: string, treeSha: string): string {
  return `${getRepoKey(owner, repo)}@${treeSha}`
}

export interface CachedRepo {
  schemaVersion?: number
  coverage?: RepositoryCoverage
  complete?: boolean
  /** Primary key: `${owner}/${repo}` */
  key: string
  owner: string
  repo: string
  /** Tree SHA — used for freshness comparison. */
  sha: string
  /** Unix-ms timestamp for LRU eviction. */
  timestamp: number
  /** Normalized source representation. Missing on disposable legacy records. */
  content?: CachedContent
  /** Legacy schema field retained only so old IndexedDB records can be invalidated. */
  files?: Array<{ path: string; content: string; language?: string }>
  /** Serialized file tree for potential offline use. */
  tree: FileNode[]
  /** GitHub metadata — optional for backward compat with older cached entries. */
  description?: string | null
  stars?: number
  language?: string | null
}

export function isReusableCachedRepo(entry: CachedRepo): entry is CachedRepo & {
  schemaVersion: number
  coverage: RepositoryCoverage
  complete: true
  content: CachedContent
} {
  if (entry.schemaVersion !== REPO_CACHE_SCHEMA_VERSION
    || entry.complete !== true
    || entry.coverage === undefined
    || !isCoverageComplete(entry.coverage)
    || entry.key !== getRepoKey(entry.owner, entry.repo)
    || !entry.content
  ) return false

  switch (entry.content.kind) {
    case 'inline':
      return Array.isArray(entry.content.files) && entry.content.files.every(file => (
        typeof file.path === 'string'
        && typeof file.content === 'string'
        && (file.language === undefined || typeof file.language === 'string')
      ))
    case 'idb':
      return entry.content.storeKey === getContentStoreKey(entry.owner, entry.repo, entry.sha)
        && Array.isArray(entry.content.files)
        && entry.content.files.every(file => (
          typeof file.path === 'string'
          && Number.isInteger(file.lineCount)
          && file.lineCount >= 0
          && (file.language === undefined || typeof file.language === 'string')
        ))
    default: {
      const exhaustive: never = entry.content
      return exhaustive
    }
  }
}

export type ReusableCachedRepo = CachedRepo & {
  schemaVersion: number
  coverage: RepositoryCoverage
  complete: true
  content: CachedContent
}

/** Lightweight metadata for listing cached repos without loading file contents. */
export interface CachedRepoMeta {
  key: string
  owner: string
  repo: string
  sha: string
  timestamp: number
  fileCount: number
  description?: string | null
  stars?: number
  language?: string | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function openDB(signal?: AbortSignal): Promise<IDBDatabase> {
  return openIndexedDB({
    name: DB_NAME,
    version: DB_VERSION,
    signal,
    upgrade: db => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(TOURS_STORE_NAME)) {
        const tourStore = db.createObjectStore(TOURS_STORE_NAME, { keyPath: 'id' })
        tourStore.createIndex('repoKey', 'repoKey', { unique: false })
      }
    },
  })
}

function transactionDone(tx: IDBTransaction, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      try {
        tx.abort()
      } catch {
        // The transaction already completed.
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    tx.oncomplete = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    tx.onerror = () => {
      // onabort carries the final transaction error.
    }
    tx.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(tx.error ?? signal?.reason ?? new DOMException('Transaction aborted', 'AbortError'))
    }
    if (signal?.aborted) abort()
  })
}

async function getRepoRecord(
  db: IDBDatabase,
  key: string,
  signal?: AbortSignal,
): Promise<CachedRepo | null> {
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = transactionDone(tx, signal)
  const requestResult = new Promise<CachedRepo | null>((resolve, reject) => {
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error ?? new DOMException('Failed to read repository cache', 'UnknownError'))
  })
  const [entry] = await Promise.all([requestResult, done])
  if (signal?.aborted) throw signal.reason
  return entry
}

async function deleteRepoManifest(db: IDBDatabase, key: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx, signal)
  tx.objectStore(STORE_NAME).delete(key)
  await done
  if (signal?.aborted) throw signal.reason
}

async function deleteRepoManifestIfIdentity(
  db: IDBDatabase,
  candidate: CachedRepo,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) throw signal.reason
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx, signal)
  let removed = false
  const request = tx.objectStore(STORE_NAME).get(candidate.key)
  request.onsuccess = () => {
    const current = request.result as CachedRepo | undefined
    if (!current || !sameManifestIdentity(current, candidate)) return
    tx.objectStore(STORE_NAME).delete(candidate.key)
    removed = true
  }
  await done
  if (signal?.aborted) throw signal.reason
  return removed
}

async function touchRepoTimestamp(
  db: IDBDatabase,
  entry: CachedRepo,
  signal?: AbortSignal,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx, signal)
  const request = tx.objectStore(STORE_NAME).get(entry.key)
  request.onsuccess = () => {
    const current = request.result as CachedRepo | undefined
    if (!current || !sameManifestIdentity(current, entry)) return
    current.timestamp = Date.now()
    tx.objectStore(STORE_NAME).put(current)
    entry.timestamp = current.timestamp
  }
  await done
  if (signal?.aborted) throw signal.reason
}

async function getAllRepoRecords(db: IDBDatabase, signal?: AbortSignal): Promise<CachedRepo[]> {
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = transactionDone(tx, signal)
  const requestResult = new Promise<CachedRepo[]>((resolve, reject) => {
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(request.error ?? new DOMException('Failed to read cache entries', 'UnknownError'))
  })
  const [records] = await Promise.all([requestResult, done])
  if (signal?.aborted) throw signal.reason
  return records
}

function sameManifestIdentity(current: CachedRepo, candidate: CachedRepo): boolean {
  return current.key === candidate.key
    && current.owner === candidate.owner
    && current.repo === candidate.repo
    && current.sha === candidate.sha
    && current.timestamp === candidate.timestamp
    && current.schemaVersion === candidate.schemaVersion
    && current.complete === candidate.complete
}

function contentNamespaceForDeletion(record: CachedRepo): string | null {
  if (record.content?.kind === 'idb') {
    const expectedPrefix = `${getRepoKey(record.owner, record.repo)}@`
    return record.content.storeKey.startsWith(expectedPrefix) ? record.content.storeKey : null
  }
  return record.schemaVersion === REPO_CACHE_SCHEMA_VERSION ? null : record.key
}

async function deleteRecordContent(record: CachedRepo, signal?: AbortSignal): Promise<void> {
  const storeKey = contentNamespaceForDeletion(record)
  if (storeKey) await deleteRepoContent(storeKey, signal)
}

async function invalidateCachedRecord(
  db: IDBDatabase,
  record: CachedRepo,
  signal?: AbortSignal,
): Promise<void> {
  await deleteRecordContent(record, signal)
  await deleteRepoManifestIfIdentity(db, record, signal)
}

/** Run an LRU eviction pass while the origin-wide mutation lease is held. */
async function evictLRU(db: IDBDatabase, lease: CacheMutationLease): Promise<void> {
  if (!lease.crossContextSafe) return
  try {
    throwIfCacheMutationAborted(lease)
    const records = await getAllRepoRecords(db, lease.signal)
    throwIfCacheMutationAborted(lease)
    if (records.length <= MAX_REPOS) return

    records.sort((a, b) => a.timestamp - b.timestamp)
    const removalCount = records.length - MAX_REPOS
    let removed = 0
    for (const record of records) {
      if (removed >= removalCount) break
      throwIfCacheMutationAborted(lease)
      try {
        const removedManifest = await deleteRepoManifestIfIdentity(db, record, lease.signal)
        throwIfCacheMutationAborted(lease)
        if (!removedManifest) continue
        await deleteRecordContent(record, lease.signal)
        throwIfCacheMutationAborted(lease)
        removed++
      } catch (error) {
        if (lease.signal?.aborted) throw error
        console.warn(`Failed to remove evicted repository content for ${record.key}:`, error)
      }
    }
  } catch (error) {
    if (lease.signal?.aborted) throw error
    console.warn('Failed to evict old repository cache entries:', error)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Retrieve a cached repo record, or `null` if not found / DB unavailable. */
export async function getCachedRepo(
  owner: string,
  repo: string,
  options: { signal?: AbortSignal; coordinator?: CacheMutationCoordinator } = {},
): Promise<ReusableCachedRepo | null> {
  const throwIfAborted = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    }
  }

  try {
    return await withCacheMutationLock(options.signal, async lease => {
      throwIfCacheMutationAborted(lease)
      if (!lease.crossContextSafe) return null
      const db = await openDB(lease.signal)
      throwIfCacheMutationAborted(lease)
      const entry = await getRepoRecord(db, getRepoKey(owner, repo), lease.signal)
      throwIfCacheMutationAborted(lease)

      if (entry && !isReusableCachedRepo(entry)) {
        await invalidateCachedRecord(db, entry, lease.signal)
        return null
      }

      // Touch timestamp so LRU eviction keeps frequently-accessed repos.
      if (entry) {
        try {
          await touchRepoTimestamp(db, entry, lease.signal)
        } catch (error) {
          if (lease.signal?.aborted) throw error
          console.warn(`Failed to update repository cache timestamp for ${entry.key}:`, error)
        }
        throwIfCacheMutationAborted(lease)
      }

      return entry
    }, options.coordinator)
  } catch (error) {
    throwIfAborted()
    if (options.signal?.aborted) throw error
    return null
  }
}

export interface HydratedCachedRepo {
  cached: ReusableCachedRepo
  index: CodeIndex
  contentHydratedDurably: boolean
  hydrationError?: unknown
}

/**
 * Look up, validate, hydrate, touch, and consume a cache hit under one origin lock.
 * The consumer runs before the lease is released so clear/publication cannot
 * interleave between manifest validation and the publication decision.
 */
export async function withHydratedCachedRepo(
  owner: string,
  repo: string,
  expectedSha: string,
  options: {
    signal?: AbortSignal
    /** @deprecated Storage representation is selected by the cached discriminator. */
    useIDB?: boolean
    coordinator?: CacheMutationCoordinator
  },
  consume: (result: HydratedCachedRepo) => void | Promise<void>,
): Promise<boolean> {
  try {
    return await withCacheMutationLock(options.signal, async lease => {
      throwIfCacheMutationAborted(lease)
      if (!lease.crossContextSafe) return false

      const db = await openDB(lease.signal)
      throwIfCacheMutationAborted(lease)
      const entry = await getRepoRecord(db, getRepoKey(owner, repo), lease.signal)
      throwIfCacheMutationAborted(lease)
      if (!entry) return false
      if (!isReusableCachedRepo(entry)) {
        await invalidateCachedRecord(db, entry, lease.signal)
        return false
      }
      if (entry.sha !== expectedSha) return false

      let index: CodeIndex
      switch (entry.content.kind) {
        case 'inline':
          index = batchIndexFiles(createEmptyIndex(), entry.content.files)
          break
        case 'idb': {
          const store = new IDBContentStore(entry.content.storeKey, lease.signal, { kind: 'disabled' })
          store.registerPaths(entry.content.files.map(file => file.path))
          index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), entry.content.files)
          break
        }
        default: {
          const exhaustive: never = entry.content
          throw new Error(`Unsupported cached content: ${String(exhaustive)}`)
        }
      }
      index.coverage = entry.coverage

      try {
        await touchRepoTimestamp(db, entry, lease.signal)
      } catch (error) {
        if (lease.signal?.aborted) throw error
        console.warn(`Failed to update repository cache timestamp for ${entry.key}:`, error)
      }
      throwIfCacheMutationAborted(lease)
      await consume({ cached: entry, index, contentHydratedDurably: true })
      return true
    }, options.coordinator)
  } catch (error) {
    if (options.signal?.aborted) throw error
    return false
  }
}

export interface CachePublicationOptions {
  /** @deprecated Content namespaces are derived from the cached idb discriminator. */
  contentPaths?: readonly string[]
}

/** Publish a manifest and perform maintenance while an origin-wide mutation lease is held. */
export async function publishCachedRepo(
  lease: CacheMutationLease,
  owner: string,
  repo: string,
  sha: string,
  content: CachedContent,
  tree: FileNode[],
  coverage: RepositoryCoverage,
  meta?: { description?: string | null; stars?: number; language?: string | null },
  options: CachePublicationOptions = {},
): Promise<void> {
  void options
  if (!isCoverageComplete(coverage)) return
  const key = getRepoKey(owner, repo)
  if (content.kind === 'idb' && content.storeKey !== getContentStoreKey(owner, repo, sha)) {
    throw new Error(`Invalid content store key for ${key}@${sha}`)
  }
  requireCrossContextCacheCoordination(lease)
  throwIfCacheMutationAborted(lease)
  const db = await openDB(lease.signal)
  throwIfCacheMutationAborted(lease)
  const previous = await getRepoRecord(db, key, lease.signal)
  throwIfCacheMutationAborted(lease)
  const record: CachedRepo = {
    schemaVersion: REPO_CACHE_SCHEMA_VERSION,
    coverage,
    complete: isCoverageComplete(coverage),
    key,
    owner,
    repo,
    sha,
    timestamp: Date.now(),
    content,
    tree,
    ...(meta && {
      description: meta.description,
      stars: meta.stars,
      language: meta.language,
    }),
  }

  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx, lease.signal)
  tx.objectStore(STORE_NAME).put(record)
  await done
  throwIfCacheMutationAborted(lease)

  // Cross-context cleanup is unsafe without Web Locks. The manifest remains
  // valid; orphaned content is preferable to deleting another tab's writes.
  if (lease.crossContextSafe && previous && previous.sha !== sha) {
    const currentManifest = await getRepoRecord(db, key, lease.signal)
    throwIfCacheMutationAborted(lease)
    if (currentManifest && sameManifestIdentity(currentManifest, record)) {
      try {
        const previousNamespace = contentNamespaceForDeletion(previous)
        const currentNamespace = content.kind === 'idb' ? content.storeKey : null
        if (previousNamespace && previousNamespace !== currentNamespace) {
          await deleteRepoContent(previousNamespace, lease.signal)
        }
        throwIfCacheMutationAborted(lease)
      } catch (error) {
        if (lease.signal?.aborted) throw error
        console.warn(`Failed to remove superseded repository content for ${key}:`, error)
      }
    }
  }

  await evictLRU(db, lease)
  throwIfCacheMutationAborted(lease)
}

/** Persist indexed file data for a repo, then run LRU eviction. */
export async function setCachedRepo(
  owner: string,
  repo: string,
  sha: string,
  files: Array<{ path: string; content: string; language?: string }>,
  tree: FileNode[],
  coverage: RepositoryCoverage,
  meta?: { description?: string | null; stars?: number; language?: string | null },
  options: CachePublicationOptions & {
    signal?: AbortSignal
    coordinator?: CacheMutationCoordinator
  } = {},
): Promise<void> {
  return withCacheMutationLock(options.signal, lease => publishCachedRepo(
    lease,
    owner,
    repo,
    sha,
    { kind: 'inline', files },
    tree,
    coverage,
    meta,
    options,
  ), options.coordinator)
}

/** Remove a single repo from the cache. */
export async function clearCachedRepo(
  owner: string,
  repo: string,
  options: { signal?: AbortSignal; coordinator?: CacheMutationCoordinator } = {},
): Promise<void> {
  return withCacheMutationLock(options.signal, async lease => {
    requireCrossContextCacheCoordination(lease)
    const key = getRepoKey(owner, repo)
    const db = await openDB(lease.signal)
    throwIfCacheMutationAborted(lease)
    const record = await getRepoRecord(db, key, lease.signal)
    throwIfCacheMutationAborted(lease)
    if (record) await deleteRecordContent(record, lease.signal)
    throwIfCacheMutationAborted(lease)
    await deleteRepoManifest(db, key, lease.signal)
    throwIfCacheMutationAborted(lease)
  }, options.coordinator)
}

/** List lightweight metadata for all cached repos, sorted by most-recent first. */
export async function listCachedRepos(): Promise<CachedRepoMeta[]> {
  try {
    const db = await openDB()
    const records: CachedRepo[] = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => resolve([])
    })

    return records
      .filter(isReusableCachedRepo)
      .map((r) => ({
        key: r.key,
        owner: r.owner,
        repo: r.repo,
        sha: r.sha,
        timestamp: r.timestamp,
        fileCount: r.content.files.length,
        description: r.description,
        stars: r.stars,
        language: r.language,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
  } catch {
    return []
  }
}

/** Clear all cached repos. */
export async function clearAllCache(
  options: { signal?: AbortSignal; coordinator?: CacheMutationCoordinator } = {},
): Promise<void> {
  return withCacheMutationLock(options.signal, async lease => {
    requireCrossContextCacheCoordination(lease)
    await clearAllRepoContent(lease.signal)
    throwIfCacheMutationAborted(lease)
    const db = await openDB(lease.signal)
    throwIfCacheMutationAborted(lease)
    const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
    const done = transactionDone(tx, lease.signal)
    tx.objectStore(STORE_NAME).clear()
    await done
    throwIfCacheMutationAborted(lease)
  }, options.coordinator)
}
