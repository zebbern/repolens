// IndexedDB cache for repository data — avoids re-fetching file contents
// when the HEAD commit hasn't changed.

import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { isCoverageComplete } from '@/lib/repository'
import {
  clearAllRepoContent,
  deleteRepoContent,
  deleteStaleRepoContent,
} from '@/lib/code/content-store'

const DB_NAME = 'repolens-cache'
const STORE_NAME = 'repos'
const TOURS_STORE_NAME = 'tours'
const DB_VERSION = 2
const MAX_REPOS = 5
export const REPO_CACHE_SCHEMA_VERSION = 4

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
  /** Indexed file contents. */
  files: Array<{ path: string; content: string; language?: string }>
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
} {
  return entry.schemaVersion === REPO_CACHE_SCHEMA_VERSION
    && entry.complete === true
    && entry.coverage !== undefined
    && isCoverageComplete(entry.coverage)
}

export type ReusableCachedRepo = CachedRepo & {
  schemaVersion: number
  coverage: RepositoryCoverage
  complete: true
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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(TOURS_STORE_NAME)) {
        const tourStore = db.createObjectStore(TOURS_STORE_NAME, { keyPath: 'id' })
        tourStore.createIndex('repoKey', 'repoKey', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
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

async function getRepoRecord(db: IDBDatabase, key: string): Promise<CachedRepo | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error ?? new DOMException('Failed to read repository cache', 'UnknownError'))
  })
}

async function deleteRepoManifest(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx)
  tx.objectStore(STORE_NAME).delete(key)
  await done
}

/** Run an LRU eviction pass: keep only the MAX_REPOS most-recent entries. */
async function evictLRU(db: IDBDatabase): Promise<void> {
  try {
    const records = await new Promise<CachedRepo[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error ?? new DOMException('Failed to read cache entries', 'UnknownError'))
    })
    if (records.length <= MAX_REPOS) return

    records.sort((a, b) => a.timestamp - b.timestamp)
    const toRemove = records.slice(0, records.length - MAX_REPOS)
    const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE_NAME)
    for (const record of toRemove) store.delete(record.key)
    await done

    const cleanups = await Promise.allSettled(toRemove.map(record => deleteRepoContent(record.key)))
    cleanups.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to remove evicted repository content for ${toRemove[index].key}:`, result.reason)
      }
    })
  } catch (error) {
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
  options: { signal?: AbortSignal } = {},
): Promise<ReusableCachedRepo | null> {
  const throwIfAborted = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    }
  }

  try {
    throwIfAborted()
    const db = await openDB()
    throwIfAborted()
    const entry: CachedRepo | null = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(`${owner}/${repo}`)

      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => resolve(null)
    })
    throwIfAborted()

    if (entry && !isReusableCachedRepo(entry)) return null

    // Touch timestamp so LRU eviction keeps frequently-accessed repos
    if (entry) {
      entry.timestamp = Date.now()
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
        const done = transactionDone(tx)
        tx.objectStore(STORE_NAME).put(entry)
        await done
      } catch (error) {
        console.warn(`Failed to update repository cache timestamp for ${entry.key}:`, error)
      }
    }

    return entry
  } catch (error) {
    if (options.signal?.aborted) throw error
    return null
  }
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
  options: { signal?: AbortSignal; contentPaths?: readonly string[] } = {},
): Promise<void> {
  const throwIfAborted = () => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
  throwIfAborted()
  const db = await openDB()
  throwIfAborted()
  const key = `${owner}/${repo}`
  const previous = await getRepoRecord(db, key)
  throwIfAborted()
  const record: CachedRepo = {
    schemaVersion: REPO_CACHE_SCHEMA_VERSION,
    coverage,
    complete: isCoverageComplete(coverage),
    key,
    owner,
    repo,
    sha,
    timestamp: Date.now(),
    files,
    tree,
    ...(meta && {
      description: meta.description,
      stars: meta.stars,
      language: meta.language,
    }),
  }

  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx, options.signal)
  if (!options.signal?.aborted) tx.objectStore(STORE_NAME).put(record)
  await done

  throwIfAborted()
  if (previous && previous.sha !== sha) {
    try {
      if (options.contentPaths) {
        await deleteStaleRepoContent(key, new Set(options.contentPaths))
      } else {
        await deleteRepoContent(key)
      }
    } catch (error) {
      console.warn(`Failed to remove superseded repository content for ${key}:`, error)
    }
  }

  await evictLRU(db)
}

/** Remove a single repo from the cache. */
export async function clearCachedRepo(
  owner: string,
  repo: string,
): Promise<void> {
  const key = `${owner}/${repo}`
  await deleteRepoContent(key)
  const db = await openDB()
  await deleteRepoManifest(db, key)
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
        fileCount: r.files?.length ?? 0,
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
export async function clearAllCache(): Promise<void> {
  await clearAllRepoContent()
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx)
  tx.objectStore(STORE_NAME).clear()
  await done
}
