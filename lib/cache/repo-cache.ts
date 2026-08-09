// IndexedDB cache for repository data — avoids re-fetching file contents
// when the HEAD commit hasn't changed.

import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { isCoverageComplete } from '@/lib/repository'

const DB_NAME = 'repolens-cache'
const STORE_NAME = 'repos'
const TOURS_STORE_NAME = 'tours'
const DB_VERSION = 2
const MAX_REPOS = 5
export const REPO_CACHE_SCHEMA_VERSION = 3

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

/** Run an LRU eviction pass: keep only the MAX_REPOS most-recent entries. */
async function evictLRU(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const allReq = store.getAll()

    allReq.onsuccess = () => {
      const records: CachedRepo[] = allReq.result ?? []
      if (records.length <= MAX_REPOS) {
        resolve()
        return
      }

      // Sort ascending by timestamp — oldest first
      records.sort((a, b) => a.timestamp - b.timestamp)
      const toRemove = records.slice(0, records.length - MAX_REPOS)

      for (const record of toRemove) {
        store.delete(record.key)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    }

    allReq.onerror = () => resolve()
  })
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
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(entry)
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
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const throwIfAborted = () => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
  try {
    throwIfAborted()
    const db = await openDB()
    throwIfAborted()
    const key = `${owner}/${repo}`
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

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const abort = () => { try { tx.abort() } catch { /* already complete */ } }
      options.signal?.addEventListener('abort', abort, { once: true })
      const store = tx.objectStore(STORE_NAME)
      if (options.signal?.aborted) abort()
      else store.put(record)

      tx.oncomplete = () => { options.signal?.removeEventListener('abort', abort); resolve() }
      tx.onerror = tx.onabort = () => { options.signal?.removeEventListener('abort', abort); reject(tx.error ?? new DOMException('The operation was aborted', 'AbortError')) }
    })

    throwIfAborted()
    await evictLRU(db)
  } catch (error) {
    if (options.signal?.aborted) throw error
    // Cache write failure is non-critical — silently ignore.
  }
}

/** Remove a single repo from the cache. */
export async function clearCachedRepo(
  owner: string,
  repo: string,
): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(`${owner}/${repo}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // Silently ignore.
  }
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
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // Silently ignore.
  }
}
