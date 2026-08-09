interface OpenIndexedDBOptions {
  name: string
  version: number
  signal?: AbortSignal
  upgrade: (db: IDBDatabase, transaction: IDBTransaction) => void
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/** Open an owned IndexedDB connection with prompt caller cancellation. */
export function openIndexedDB({
  name,
  version,
  signal,
  upgrade,
}: OpenIndexedDBOptions): Promise<IDBDatabase> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    let settled = false

    const removeAbortListener = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      removeAbortListener()
      try {
        request.transaction?.abort()
      } catch {
        // The upgrade transaction is not active or the request is blocked.
      }
      reject(abortReason(signal))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    request.onupgradeneeded = () => {
      // A blocked open cannot be cancelled natively. If it succeeds after the
      // caller aborts, finish the schema upgrade so the database is not left
      // at a new version with a partial schema; onsuccess closes it immediately.
      try {
        upgrade(request.result, request.transaction!)
      } catch (error) {
        try {
          request.transaction?.abort()
        } catch {
          // The upgrade transaction already finished.
        }
        if (!settled) {
          settled = true
          removeAbortListener()
          reject(error)
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (settled || signal?.aborted) {
        db.close()
        return
      }
      settled = true
      removeAbortListener()
      resolve(db)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      removeAbortListener()
      reject(request.error ?? new DOMException(`Failed to open ${name}`, 'UnknownError'))
    }

    if (signal?.aborted) onAbort()
  })
}
