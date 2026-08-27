// IndexedDB CRUD for tour data — follows the repo-cache.ts pattern.

import type { Tour } from '@/types/tours'
import { withCacheMutationLock, type CacheMutationCoordinator } from '@/lib/cache/cache-mutation-lock'
import { getGitHubCredentialPrincipal } from '@/lib/github/client'

const DB_NAME = 'repolens-cache'
const TOURS_STORE = 'tours'
const DB_VERSION = 2

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('repos')) {
        db.createObjectStore('repos', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(TOURS_STORE)) {
        const tourStore = db.createObjectStore(TOURS_STORE, { keyPath: 'id' })
        tourStore.createIndex('repoKey', 'repoKey', { unique: false })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // If another tab upgrades the DB, close and re-open on next access.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Cached DB connection — opened once, reused for all operations. */
let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB().catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface TourCacheReadOptions {
  principal?: string | null
}

function effectivePrincipal(options: TourCacheReadOptions): string | null {
  return options.principal === undefined ? getGitHubCredentialPrincipal() : options.principal
}

function canReadTour(tour: Tour, principal: string | null): boolean {
  if (tour.visibility === 'public') return true
  if (tour.visibility !== 'private') return false
  return typeof principal === 'string' && principal.length > 0 && tour.principal === principal
}

function transactionDone<T>(
  tx: IDBTransaction,
  run: (store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result!: T
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    tx.oncomplete = () => settle(() => resolve(result))
    tx.onerror = () => settle(() => reject(
      tx.error ?? new DOMException('Transaction failed', 'UnknownError'),
    ))
    tx.onabort = () => settle(() => reject(
      tx.error ?? new DOMException('Transaction aborted', 'AbortError'),
    ))

    try {
      result = run(tx.objectStore(TOURS_STORE))
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // The transaction already completed or aborted.
      }
      settle(() => reject(error))
    }
  })
}

/** Reset the cached DB connection. Exported for tests only. */
export function _resetDBConnection(): void {
  dbPromise = null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Retrieve all tours for a given repository, sorted by updatedAt descending. */
export async function getToursByRepo(repoKey: string, options: TourCacheReadOptions = {}): Promise<Tour[]> {
  try {
    const tours = await withCacheMutationLock(undefined, async () => {
      const db = await getDB()
      const tx = db.transaction(TOURS_STORE, 'readonly')
      const store = tx.objectStore(TOURS_STORE)
      const index = store.index('repoKey')
      const tours = await wrapRequest(index.getAll(repoKey))
      const principal = effectivePrincipal(options)
      return tours.filter(tour => canReadTour(tour, principal))
    })

    tours.sort((a, b) => b.updatedAt - a.updatedAt)
    return tours
  } catch {
    return []
  }
}

/** Retrieve a single tour by id, or `null` if not found. */
export async function getTour(id: string, options: TourCacheReadOptions = {}): Promise<Tour | null> {
  try {
    const result = await withCacheMutationLock(undefined, async () => {
      const db = await getDB()
      const tx = db.transaction(TOURS_STORE, 'readonly')
      const store = tx.objectStore(TOURS_STORE)
      const tour = await wrapRequest(store.get(id))
      return tour && canReadTour(tour, effectivePrincipal(options)) ? tour : null
    })
    return result ?? null
  } catch {
    return null
  }
}

/** Persist (upsert) a tour record. Automatically updates `updatedAt`. */
export async function saveTour(
  tour: Tour,
  options: TourCacheReadOptions & { coordinator?: CacheMutationCoordinator } = {},
): Promise<void> {
  await withCacheMutationLock(undefined, async () => {
    const db = await getDB()
    const principal = effectivePrincipal(options)
    if (tour.visibility === 'private' && (!principal || principal.length === 0)) {
      throw new Error('Cannot cache private tour without a credential principal')
    }
    const record: Tour = {
      ...tour,
      ...(tour.visibility === 'private' && principal ? { principal } : { principal: undefined }),
      updatedAt: Date.now(),
    }
    const tx = db.transaction(TOURS_STORE, 'readwrite')
    await transactionDone(tx, store => { store.put(record) })
  }, options.coordinator)
}

/** Delete a single tour by id. */
export async function deleteTour(
  id: string,
  options: { coordinator?: CacheMutationCoordinator } = {},
): Promise<void> {
  await withCacheMutationLock(undefined, async () => {
    const db = await getDB()
    const tx = db.transaction(TOURS_STORE, 'readwrite')
    await transactionDone(tx, store => { store.delete(id) })
  }, options.coordinator)
}

/** Delete all tours for a given repository. */
export async function deleteToursForRepo(
  repoKey: string,
  options: { coordinator?: CacheMutationCoordinator } = {},
): Promise<void> {
  await withCacheMutationLock(undefined, async () => {
    const db = await getDB()
    const readTx = db.transaction(TOURS_STORE, 'readonly')
    const keys = await wrapRequest(readTx.objectStore(TOURS_STORE).index('repoKey').getAllKeys(repoKey))
    const deleteTx = db.transaction(TOURS_STORE, 'readwrite')
    await transactionDone(deleteTx, store => {
      for (const key of keys) store.delete(key)
    })
  }, options.coordinator)
}
