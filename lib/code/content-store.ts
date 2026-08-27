// Content store abstraction for Phase 3 tiered repo loading.
// Wave 1: InMemoryContentStore only. Wave 2 adds IDBContentStore.
// Phase 4: LazyContentStore for repos at or above 250 MB (on-demand content loading).

import type { FetchQueue } from './fetch-queue'
import type { CacheMutationLease } from '@/lib/cache/cache-mutation-lock'
import { assertActiveCacheMutationLease } from '@/lib/cache/cache-mutation-lock'
import { openIndexedDB } from './open-indexed-db'

/**
 * Metadata-only file record — no content field.
 * Stays in heap for fast metadata access (search, UI, AI).
 */
export interface CodeIndexMeta {
  path: string
  name: string
  language?: string
  lineCount: number
  /** False only when the source has not been loaded and no durable count exists. */
  lineCountKnown?: boolean
}

/**
 * Abstraction for storing and retrieving file content.
 * InMemoryContentStore (Wave 1): sync, zero-overhead.
 * IDBContentStore (Wave 2): async, IndexedDB-backed.
 */
export interface ContentStore {
  /** Whether bulk reads can resolve every durable path or resident source only. */
  readonly bulkReadMode: 'complete' | 'resident-only'

  /** Monotonic version when source can change without replacing the store. */
  readonly contentRevision?: number

  /** Get file content by path. Always resolves for in-memory store. */
  get(path: string): Promise<string | null>

  /**
   * Synchronous get — only works for InMemoryContentStore. Returns null for IDB stores.
   * Consumers that MUST be sync (searchIndex, getFileLines) use this.
   */
  getSync(path: string): string | null

  /** Get multiple files' content in a single operation. */
  getBatch(paths: string[]): Promise<Map<string, string>>

  /** Store a single file's content. */
  put(path: string, content: string): void

  /** Store multiple files' content. */
  putBatch(entries: Array<{ path: string; content: string }>): void

  /** Check if content exists for a path (sync — based on metadata). */
  has(path: string): boolean

  /** Remove content for a path. */
  delete(path: string): void

  /** Wait for every mutation issued before this call to commit. */
  flush(): Promise<void>

  /** Remove all content owned by this store. */
  clear(): Promise<void>

  /** Number of stored files. */
  readonly size: number
}

/**
 * In-memory content store — wraps a simple Map<string, string>.
 * Zero overhead over the current approach. All operations are synchronous.
 */
export class InMemoryContentStore implements ContentStore {
  readonly bulkReadMode = 'complete' as const
  private store: Map<string, string>

  constructor(initial?: Map<string, string>) {
    this.store = initial ? new Map(initial) : new Map()
  }

  get(path: string): Promise<string | null> {
    return Promise.resolve(this.store.get(path) ?? null)
  }

  getSync(path: string): string | null {
    return this.store.get(path) ?? null
  }

  getBatch(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    for (const p of paths) {
      const content = this.store.get(p)
      if (content !== undefined) result.set(p, content)
    }
    return Promise.resolve(result)
  }

  put(path: string, content: string): void {
    this.store.set(path, content)
  }

  putBatch(entries: Array<{ path: string; content: string }>): void {
    for (const { path, content } of entries) {
      this.store.set(path, content)
    }
  }

  has(path: string): boolean {
    return this.store.has(path)
  }

  delete(path: string): void {
    this.store.delete(path)
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.store.clear()
    return Promise.resolve()
  }

  getAllSync(): Map<string, string> {
    return new Map(this.store)
  }

  get size(): number {
    return this.store.size
  }
}

// IDB database for runtime content storage (separate from repolens-cache)
const IDB_CONTENT_DB = 'repolens-content'
const IDB_CONTENT_STORE = 'files'
const IDB_CONTENT_VERSION = 1

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function openContentDB(signal?: AbortSignal): Promise<IDBDatabase> {
  return openIndexedDB({
    name: IDB_CONTENT_DB,
    version: IDB_CONTENT_VERSION,
    signal,
    upgrade: db => {
      if (!db.objectStoreNames.contains(IDB_CONTENT_STORE)) {
        db.createObjectStore(IDB_CONTENT_STORE)
      }
    },
  })
}

export type IDBContentWriteAccess =
  | { kind: 'coordinated'; lease: CacheMutationLease }
  | { kind: 'disabled' }
  | { kind: 'uncoordinated' }

/** Session-local source changes layered over a shared IndexedDB snapshot. */
export interface IDBSessionOverlay {
  entries: Array<{ path: string; content: string }>
  deletedPaths: string[]
}

function runContentTransaction(
  db: IDBDatabase,
  run: (store: IDBObjectStore) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_CONTENT_STORE, 'readwrite', { durability: 'strict' })
    let synchronousError: unknown
    let settled = false
    const settle = (result: 'resolve' | 'reject', error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (result === 'resolve') resolve()
      else reject(error)
    }
    const abort = () => {
      try {
        tx.abort()
      } catch {
        // The transaction already committed or aborted.
      }
    }

    signal?.addEventListener('abort', abort, { once: true })
    tx.oncomplete = () => settle('resolve')
    tx.onerror = () => {
      // A request error normally aborts the transaction. onabort carries the
      // final transaction error, including quota and commit failures.
    }
    tx.onabort = () => settle(
      'reject',
      synchronousError ?? tx.error ?? (signal?.aborted ? abortError(signal) : new DOMException('Transaction aborted', 'AbortError')),
    )

    if (signal?.aborted) {
      abort()
      return
    }

    try {
      run(tx.objectStore(IDB_CONTENT_STORE))
    } catch (error) {
      synchronousError = error
      abort()
      settle('reject', error)
    }
  })
}

async function deleteRepoContentByCursor(
  repoKey: string,
  retainedPaths?: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  const db = await openContentDB(signal)
  if (signal?.aborted) throw abortError(signal)
  const prefix = `${repoKey}:`
  const range = IDBKeyRange.lowerBound(prefix)
  await runContentTransaction(db, store => {
    const request = store.openCursor(range)
    request.onsuccess = () => {
      if (signal?.aborted) return
      const cursor = request.result
      if (!cursor) return
      const key = String(cursor.key)
      if (!key.startsWith(prefix)) return
      const path = key.slice(prefix.length)
      if (!retainedPaths?.has(path)) cursor.delete()
      cursor.continue()
    }
  }, signal)
  if (signal?.aborted) throw abortError(signal)
}

/** Delete every content record belonging to one repository. */
export function deleteRepoContent(repoKey: string, signal?: AbortSignal): Promise<void> {
  return deleteRepoContentByCursor(repoKey, undefined, signal)
}

/** Delete obsolete records while preserving a replacement's current paths. */
export function deleteStaleRepoContent(
  repoKey: string,
  retainedPaths: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  return deleteRepoContentByCursor(repoKey, retainedPaths, signal)
}

/** Delete content records for every repository. */
export async function clearAllRepoContent(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal)
  const db = await openContentDB(signal)
  if (signal?.aborted) throw abortError(signal)
  await runContentTransaction(db, store => {
    store.clear()
  }, signal)
  if (signal?.aborted) throw abortError(signal)
}

/**
 * IndexedDB-backed content store for medium+ repos.
 * Stores per-file content in IDB to reduce heap memory.
 *
 * Key format: `{repoKey}:{path}` where repoKey = `owner/repo`
 *
 * NOTE: In Wave 2, this is populated alongside the `files` Map in CodeIndex
 * (dual-write). Consumers don't read from IDB yet — that's Wave 3.
 */
export class IDBContentStore implements ContentStore {
  readonly bulkReadMode = 'complete' as const
  readonly storeKey: string
  private paths: Set<string> = new Set()
  private dbPromise: Promise<IDBDatabase> | null = null
  private unflushedWrites = new Set<Promise<void>>()
  private sessionContent = new Map<string, string>()
  private sessionDeletedPaths = new Set<string>()

  constructor(
    storeKey: string,
    private readonly signal?: AbortSignal,
    private readonly writeAccess: IDBContentWriteAccess = { kind: 'uncoordinated' },
  ) {
    this.storeKey = storeKey
  }

  private canWrite(): boolean {
    if (this.writeAccess.kind === 'disabled') return false
    if (this.writeAccess.kind === 'uncoordinated') return true
    try {
      assertActiveCacheMutationLease(this.writeAccess.lease)
      return this.writeAccess.lease.crossContextSafe
    } catch {
      return false
    }
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.signal?.aborted) return Promise.reject(abortError(this.signal))
    if (!this.dbPromise) {
      this.dbPromise = openContentDB(this.signal)
    }
    return this.dbPromise
  }

  private write(run: (store: IDBObjectStore) => void): void {
    const write = this.openDB().then(db => runContentTransaction(db, run, this.signal))
    this.unflushedWrites.add(write)
    // Mutations stay synchronous, so attach a handler immediately. flush()
    // still observes the original rejected promise from the tracked set.
    void write.catch(() => {})
  }

  private idbKey(path: string): string {
    return `${this.storeKey}:${path}`
  }

  async get(path: string): Promise<string | null> {
    const localContent = this.sessionContent.get(path)
    if (localContent !== undefined || this.sessionContent.has(path)) return localContent ?? ''
    if (this.sessionDeletedPaths.has(path)) return null
    try {
      const db = await this.openDB()
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_CONTENT_STORE, 'readonly')
        const store = tx.objectStore(IDB_CONTENT_STORE)
        const req = store.get(this.idbKey(path))
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
      })
    } catch {
      return null
    }
  }

  getSync(_path: string): string | null {
    return null
  }

  async getBatch(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const durablePaths: string[] = []
    for (const path of paths) {
      const localContent = this.sessionContent.get(path)
      if (localContent !== undefined || this.sessionContent.has(path)) {
        result.set(path, localContent ?? '')
      } else if (!this.sessionDeletedPaths.has(path)) {
        durablePaths.push(path)
      }
    }
    if (durablePaths.length === 0) return result
    try {
      const db = await this.openDB()
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_CONTENT_STORE, 'readonly')
        const store = tx.objectStore(IDB_CONTENT_STORE)
        let remaining = durablePaths.length
        if (remaining === 0) {
          resolve(result)
          return
        }

        for (const p of durablePaths) {
          const req = store.get(this.idbKey(p))
          req.onsuccess = () => {
            if (req.result != null) result.set(p, req.result)
            if (--remaining === 0) resolve(result)
          }
          req.onerror = () => {
            if (--remaining === 0) resolve(result)
          }
        }
      })
    } catch {
      return result
    }
  }

  /** Verify that every declared path has a durable source record without loading source bodies. */
  async containsAllDurablePaths(paths: Iterable<string>): Promise<boolean> {
    if (this.signal?.aborted) throw abortError(this.signal)
    const remaining = new Set(paths)
    if (remaining.size === 0) return true

    const db = await this.openDB()
    if (this.signal?.aborted) throw abortError(this.signal)
    const prefix = `${this.storeKey}:`

    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONTENT_STORE, 'readonly')
      const request = tx.objectStore(IDB_CONTENT_STORE).openKeyCursor(IDBKeyRange.lowerBound(prefix))
      let settled = false
      const settle = (result: boolean, error?: unknown) => {
        if (settled) return
        settled = true
        this.signal?.removeEventListener('abort', abort)
        if (error !== undefined && error !== null) reject(error)
        else resolve(result)
      }
      const abort = () => {
        try {
          tx.abort()
        } catch {
          // The readonly transaction already completed or aborted.
        }
      }

      this.signal?.addEventListener('abort', abort, { once: true })
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          settle(false)
          return
        }
        const key = String(cursor.key)
        if (!key.startsWith(prefix)) {
          settle(false)
          return
        }
        remaining.delete(key.slice(prefix.length))
        if (remaining.size === 0) {
          settle(true)
          return
        }
        cursor.continue()
      }
      request.onerror = () => settle(false, request.error)
      tx.onabort = () => settle(
        false,
        tx.error ?? (this.signal?.aborted ? abortError(this.signal) : new DOMException('Transaction aborted', 'AbortError')),
      )
    })
  }

  put(path: string, content: string): void {
    if (this.signal?.aborted) return
    if (this.writeAccess.kind === 'disabled') {
      this.applySessionOverlay({
        entries: [{ path, content }],
        deletedPaths: [],
      })
      return
    }
    if (!this.canWrite()) return
    this.sessionContent.delete(path)
    this.sessionDeletedPaths.delete(path)
    this.paths.add(path)
    this.write(store => store.put(content, this.idbKey(path)))
  }

  putBatch(entries: Array<{ path: string; content: string }>): void {
    if (this.signal?.aborted) return
    if (this.writeAccess.kind === 'disabled') {
      this.applySessionOverlay({ entries, deletedPaths: [] })
      return
    }
    if (!this.canWrite()) return
    for (const { path } of entries) {
      this.sessionContent.delete(path)
      this.sessionDeletedPaths.delete(path)
      this.paths.add(path)
    }
    this.write(store => {
      for (const { path, content } of entries) store.put(content, this.idbKey(path))
    })
  }

  has(path: string): boolean {
    if (this.sessionContent.has(path)) return true
    if (this.sessionDeletedPaths.has(path)) return false
    return this.paths.has(path)
  }

  delete(path: string): void {
    if (this.signal?.aborted) return
    if (this.writeAccess.kind === 'disabled') {
      this.applySessionOverlay({ entries: [], deletedPaths: [path] })
      return
    }
    if (!this.canWrite()) return
    this.sessionContent.delete(path)
    this.sessionDeletedPaths.delete(path)
    this.paths.delete(path)
    this.write(store => store.delete(this.idbKey(path)))
  }

  async flush(): Promise<void> {
    const writes = [...this.unflushedWrites]
    if (writes.length === 0) return

    const results = await Promise.allSettled(writes)
    for (const write of writes) this.unflushedWrites.delete(write)
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  getAllSync(): Map<string, string> {
    throw new Error(
      'IDBContentStore does not support synchronous getAllSync(). Use getBatch() instead.'
    )
  }

  get size(): number {
    return this.paths.size
  }

  /** Register metadata-backed paths without writing or hydrating their source. */
  registerPaths(paths: Iterable<string>): void {
    for (const path of paths) this.paths.add(path)
  }

  /** Apply virtual source changes without mutating the shared IndexedDB snapshot. */
  applySessionOverlay(overlay: IDBSessionOverlay): void {
    for (const path of overlay.deletedPaths) {
      this.sessionContent.delete(path)
      this.sessionDeletedPaths.add(path)
      this.paths.delete(path)
    }
    for (const { path, content } of overlay.entries) {
      this.sessionDeletedPaths.delete(path)
      this.sessionContent.set(path, content)
      this.paths.add(path)
    }
  }

  /** Return a transferable copy of the virtual source changes for workers. */
  getSessionOverlay(): IDBSessionOverlay {
    return {
      entries: Array.from(this.sessionContent, ([path, content]) => ({ path, content })),
      deletedPaths: Array.from(this.sessionDeletedPaths),
    }
  }

  /** Clear all content for this repo from IDB. */
  async clear(): Promise<void> {
    if (this.signal?.aborted) throw abortError(this.signal)
    if (!this.canWrite()) return
    await this.flush()
    if (this.signal?.aborted) throw abortError(this.signal)
    await deleteRepoContent(this.storeKey, this.signal)
    this.paths.clear()
    this.sessionContent.clear()
    this.sessionDeletedPaths.clear()
  }

  /** Reset cached DB connection (for testing). */
  _resetDBConnection(): void {
    this.dbPromise = null
  }
}

/**
 * Lazy content store for repos at or above 250 MB.
 * Uses resident memory plus a FetchQueue for on-demand content loading.
 * SHA-less lazy content is deliberately not written to shared IndexedDB.
 *
 * - `get(path)` triggers a fetch if content is not resident and path is known
 * - `getBatch` reads resident content only (no fetch trigger)
 * - `getSync` always returns null (async-only store)
 */
export class LazyContentStore implements ContentStore {
  readonly bulkReadMode = 'resident-only' as const
  readonly repoKey: string
  private readonly contentStore = new InMemoryContentStore()
  private readonly fetchQueue: FetchQueue
  private readonly metadataPaths = new Set<string>()
  private readonly loadedPaths = new Set<string>()
  private revision = 0

  constructor(
    repoKey: string,
    fetchQueue: FetchQueue,
    private readonly signal?: AbortSignal,
  ) {
    this.repoKey = repoKey
    this.fetchQueue = fetchQueue
  }

  async get(path: string): Promise<string | null> {
    const stored = await this.contentStore.get(path)
    if (stored !== null) return stored

    if (this.metadataPaths.has(path)) {
      try {
        const content = await this.fetchQueue.enqueue(path, 'normal')
        this.put(path, content)
        return content
      } catch {
        return null
      }
    }

    return null
  }

  getSync(_path: string): string | null {
    return null
  }

  /** Reads resident content only — does NOT trigger fetches for missing files. */
  getBatch(paths: string[]): Promise<Map<string, string>> {
    return this.contentStore.getBatch(paths)
  }

  put(path: string, content: string): void {
    if (this.signal?.aborted) return
    this.contentStore.put(path, content)
    this.loadedPaths.add(path)
    this.revision++
  }

  putBatch(entries: Array<{ path: string; content: string }>): void {
    if (this.signal?.aborted || entries.length === 0) return
    this.contentStore.putBatch(entries)
    for (const { path } of entries) {
      this.loadedPaths.add(path)
    }
    this.revision++
  }

  has(path: string): boolean {
    return this.metadataPaths.has(path)
  }

  delete(path: string): void {
    this.contentStore.delete(path)
    this.loadedPaths.delete(path)
    this.metadataPaths.delete(path)
    this.revision++
  }

  flush(): Promise<void> {
    return this.contentStore.flush()
  }

  get size(): number {
    return this.metadataPaths.size
  }

  /** Whether content has been loaded (fetched + stored in IDB) for this path. */
  hasContent(path: string): boolean {
    return this.loadedPaths.has(path)
  }

  /** Monotonic version of the resident source snapshot. */
  get contentRevision(): number {
    return this.revision
  }

  /** Current content loading status. */
  getContentStatus(): { total: number; loaded: number; pending: number } {
    return {
      total: this.metadataPaths.size,
      loaded: this.loadedPaths.size,
      pending: this.fetchQueue.stats.pending,
    }
  }

  /** Register known file paths from the Git tree (metadata indexing). */
  registerPaths(paths: string[]): void {
    for (const p of paths) {
      this.metadataPaths.add(p)
    }
  }

  /** Clear all content and abort pending fetches. */
  async clear(): Promise<void> {
    this.metadataPaths.clear()
    this.loadedPaths.clear()
    this.fetchQueue.abort()
    await this.contentStore.clear()
    this.revision++
  }

  /** Access the underlying FetchQueue (e.g., for progress tracking). */
  getFetchQueue(): FetchQueue {
    return this.fetchQueue
  }
}
