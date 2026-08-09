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

const SUPERSEDED_PUBLICATION = new DOMException('Repository cache publication was superseded', 'AbortError')

interface RepoPublicationState {
  generation: number
  active?: { token: symbol; controller: AbortController }
  cleanupControllers: Set<AbortController>
}

interface PublicationLease {
  signal: AbortSignal
  isCurrent: () => boolean
  finish: () => void
}

interface CleanupLease {
  signal: AbortSignal
  isCurrent: () => boolean
  finish: () => void
}

const repoPublicationStates = new Map<string, RepoPublicationState>()

function getPublicationState(key: string): RepoPublicationState {
  let state = repoPublicationStates.get(key)
  if (!state) {
    state = { generation: 0, cleanupControllers: new Set() }
    repoPublicationStates.set(key, state)
  }
  return state
}

function beginPublication(key: string, callerSignal?: AbortSignal): PublicationLease {
  const state = getPublicationState(key)
  state.generation++
  state.active?.controller.abort(SUPERSEDED_PUBLICATION)
  for (const controller of state.cleanupControllers) controller.abort(SUPERSEDED_PUBLICATION)
  state.cleanupControllers.clear()

  const token = Symbol(key)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(
    callerSignal?.reason ?? new DOMException('The operation was aborted', 'AbortError'),
  )
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  if (callerSignal?.aborted) abortFromCaller()
  state.active = { token, controller }

  return {
    signal: controller.signal,
    isCurrent: () => state.active?.token === token && !controller.signal.aborted,
    finish: () => {
      callerSignal?.removeEventListener('abort', abortFromCaller)
      if (state.active?.token === token) state.active = undefined
    },
  }
}

function beginCleanup(key: string): CleanupLease | null {
  const state = getPublicationState(key)
  if (state.active) return null
  const generation = state.generation
  const controller = new AbortController()
  state.cleanupControllers.add(controller)
  return {
    signal: controller.signal,
    isCurrent: () => (
      state.generation === generation
      && state.active === undefined
      && state.cleanupControllers.has(controller)
      && !controller.signal.aborted
    ),
    finish: () => state.cleanupControllers.delete(controller),
  }
}

function supersedeAllRepoWork(): void {
  for (const state of repoPublicationStates.values()) {
    state.generation++
    state.active?.controller.abort(SUPERSEDED_PUBLICATION)
    state.active = undefined
    for (const controller of state.cleanupControllers) controller.abort(SUPERSEDED_PUBLICATION)
    state.cleanupControllers.clear()
  }
}

function combineAbortSignals(...signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const listeners = signals.map(signal => {
    const abort = () => controller.abort(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    return { signal, abort }
  })
  return {
    signal: controller.signal,
    dispose: () => listeners.forEach(({ signal, abort }) => signal.removeEventListener('abort', abort)),
  }
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

function openDB(signal?: AbortSignal): Promise<IDBDatabase> {
  if (signal?.aborted) return Promise.reject(signal.reason)
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

    request.onsuccess = () => {
      if (signal?.aborted) {
        request.result.close()
        reject(signal.reason)
      } else {
        resolve(request.result)
      }
    }
    request.onerror = () => reject(request.error ?? new DOMException('Failed to open repository cache', 'UnknownError'))
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

async function touchRepoTimestamp(
  db: IDBDatabase,
  entry: CachedRepo,
  callerSignal?: AbortSignal,
): Promise<void> {
  const cleanup = beginCleanup(entry.key)
  if (!cleanup) return
  const combined = combineAbortSignals(...(callerSignal ? [callerSignal, cleanup.signal] : [cleanup.signal]))
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
    const done = transactionDone(tx, combined.signal)
    const request = tx.objectStore(STORE_NAME).get(entry.key)
    request.onsuccess = () => {
      const current = request.result as CachedRepo | undefined
      if (!cleanup.isCurrent() || !current || current.sha !== entry.sha) return
      current.timestamp = Date.now()
      tx.objectStore(STORE_NAME).put(current)
      entry.timestamp = current.timestamp
    }
    await done
    if (callerSignal?.aborted) throw callerSignal.reason
  } catch (error) {
    if (callerSignal?.aborted) throw error
    if (!cleanup.isCurrent()) return
    throw error
  } finally {
    combined.dispose()
    cleanup.finish()
  }
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

/** Run an LRU eviction pass without crossing active repository publications. */
async function evictLRU(db: IDBDatabase, publication: PublicationLease): Promise<void> {
  try {
    if (!publication.isCurrent()) throw publication.signal.reason
    const records = await getAllRepoRecords(db, publication.signal)
    if (!publication.isCurrent()) throw publication.signal.reason
    if (records.length <= MAX_REPOS) return

    records.sort((a, b) => a.timestamp - b.timestamp)
    const removalCount = records.length - MAX_REPOS
    let removed = 0
    for (const record of records) {
      if (removed >= removalCount) break
      if (!publication.isCurrent()) throw publication.signal.reason
      const cleanup = beginCleanup(record.key)
      if (!cleanup) continue
      const combined = combineAbortSignals(publication.signal, cleanup.signal)
      try {
        const current = await getRepoRecord(db, record.key, combined.signal)
        if (!publication.isCurrent() || !cleanup.isCurrent()) continue
        if (!current || current.sha !== record.sha) continue

        await deleteRepoManifest(db, record.key, combined.signal)
        if (!publication.isCurrent() || !cleanup.isCurrent()) continue
        await deleteRepoContent(record.key, combined.signal)
        if (!publication.isCurrent() || !cleanup.isCurrent()) continue
        removed++
      } catch (error) {
        if (!publication.isCurrent()) throw error
        if (!cleanup.isCurrent()) continue
        console.warn(`Failed to remove evicted repository content for ${record.key}:`, error)
      } finally {
        combined.dispose()
        cleanup.finish()
      }
    }
  } catch (error) {
    if (!publication.isCurrent()) throw error
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
    const db = await openDB(options.signal)
    throwIfAborted()
    const entry = await getRepoRecord(db, `${owner}/${repo}`, options.signal)
    throwIfAborted()

    if (entry && !isReusableCachedRepo(entry)) return null

    // Touch timestamp so LRU eviction keeps frequently-accessed repos
    if (entry) {
      try {
        await touchRepoTimestamp(db, entry, options.signal)
      } catch (error) {
        if (options.signal?.aborted) throw error
        console.warn(`Failed to update repository cache timestamp for ${entry.key}:`, error)
      }
      throwIfAborted()
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
  const key = `${owner}/${repo}`
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
  const publication = beginPublication(key, options.signal)
  const checkCurrent = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    }
    return publication.isCurrent()
  }

  try {
    if (!checkCurrent()) return
    const db = await openDB(publication.signal)
    if (!checkCurrent()) return
    const previous = await getRepoRecord(db, key, publication.signal)
    if (!checkCurrent()) return
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
    const done = transactionDone(tx, publication.signal)
    if (checkCurrent()) tx.objectStore(STORE_NAME).put(record)
    await done
    if (!checkCurrent()) return

    if (previous && previous.sha !== sha) {
      const currentManifest = await getRepoRecord(db, key, publication.signal)
      if (!checkCurrent()) return
      if (!currentManifest || currentManifest.sha !== sha) return
      try {
        if (options.contentPaths) {
          await deleteStaleRepoContent(key, new Set(options.contentPaths), publication.signal)
        } else {
          await deleteRepoContent(key, publication.signal)
        }
        if (!checkCurrent()) return
      } catch (error) {
        if (!checkCurrent()) return
        console.warn(`Failed to remove superseded repository content for ${key}:`, error)
      }
    }

    if (!checkCurrent()) return
    await evictLRU(db, publication)
    if (!checkCurrent()) return
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (!publication.isCurrent()) return
    throw error
  } finally {
    publication.finish()
  }
}

/** Remove a single repo from the cache. */
export async function clearCachedRepo(
  owner: string,
  repo: string,
): Promise<void> {
  const key = `${owner}/${repo}`
  const removal = beginPublication(key)
  try {
    await deleteRepoContent(key, removal.signal)
    if (!removal.isCurrent()) throw removal.signal.reason
    const db = await openDB(removal.signal)
    if (!removal.isCurrent()) throw removal.signal.reason
    await deleteRepoManifest(db, key, removal.signal)
    if (!removal.isCurrent()) throw removal.signal.reason
  } finally {
    removal.finish()
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
  supersedeAllRepoWork()
  await clearAllRepoContent()
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  const done = transactionDone(tx)
  tx.objectStore(STORE_NAME).clear()
  await done
}
