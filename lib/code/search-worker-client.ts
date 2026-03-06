import type { CodeIndex, SearchResult } from './code-index'
import { searchIndex } from './code-index'
import { serializeCodeIndex } from './scanner/serialization'
import type { SearchWorkerResponse } from './search.worker'

let worker: Worker | null = null
let requestId = 0
let lastIndexRef: WeakRef<CodeIndex> | null = null
const pending = new Map<number, { resolve: (r: SearchResult[]) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./search.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const { id } = event.data
      const handlers = pending.get(id)
      if (!handlers) return
      pending.delete(id)
      if (event.data.type === 'result') {
        handlers.resolve(event.data.results)
      } else {
        handlers.reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      for (const [, handlers] of pending) {
        handlers.reject(new Error(event.message))
      }
      pending.clear()
      // Discard broken worker so next call creates a fresh one
      worker?.terminate()
      worker = null
      lastIndexRef = null
    }
  }
  return worker
}

function ensureIndex(w: Worker, codeIndex: CodeIndex): void {
  if (lastIndexRef?.deref() === codeIndex) return
  w.postMessage({
    type: 'setIndex',
    codeIndex: serializeCodeIndex(codeIndex),
  })
  lastIndexRef = new WeakRef(codeIndex)
}

/**
 * Search code index in a Web Worker thread.
 * Falls back to synchronous searchIndex when Workers are unavailable (SSR/tests).
 */
export function searchInWorker(
  codeIndex: CodeIndex,
  query: string,
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {},
): Promise<SearchResult[]> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return Promise.resolve(searchIndex(codeIndex, query, options))
  }

  const id = ++requestId
  const w = getWorker()
  ensureIndex(w, codeIndex)

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({
      type: 'search',
      id,
      query,
      options,
    })
  })
}

/** Cancel all pending searches, rejecting their promises. */
export function cancelPendingSearches(): void {
  for (const [, handlers] of pending) {
    handlers.reject(new Error('Search cancelled'))
  }
  pending.clear()
}

export function terminateSearchWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
    lastIndexRef = null
    for (const [, handlers] of pending) {
      handlers.reject(new Error('Worker terminated'))
    }
    pending.clear()
  }
}
