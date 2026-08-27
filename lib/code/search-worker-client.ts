import { createAsyncSearchResult, resolveFileContents, type AsyncSearchResult, type CodeIndex, type SearchOptions } from './code-index'
import { serializeCodeIndex, serializeCodeIndexMeta } from './scanner/serialization'
import { IDBContentStore, LazyContentStore } from './content-store'
import type { SearchWorkerResponse } from './search.worker'

let worker: Worker | null = null
let requestId = 0
let lastIndexRef: WeakRef<CodeIndex> | null = null
let lastIndexRevision: number | null = null
let indexSetupGeneration = 0
let indexSetup: { index: CodeIndex; revision: number; promise: Promise<void> } | null = null
const pending = new Map<number, {
  resolve: (result: AsyncSearchResult) => void
  reject: (error: Error) => void
  cleanup: () => void
}>()

type WorkerSearchOptions = Omit<SearchOptions, 'signal' | 'trusted'> & { signal?: AbortSignal }

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('Search cancelled', 'AbortError')
}

function getIndexRevision(codeIndex: CodeIndex): number {
  return codeIndex.contentStore.contentRevision ?? 0
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./search.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const { id } = event.data
      const handlers = pending.get(id)
      if (!handlers) return
      pending.delete(id)
      handlers.cleanup()
      if (event.data.type === 'result') {
        handlers.resolve(createAsyncSearchResult(
          event.data.results,
          event.data.unsearchedPaths ?? [],
          event.data.truncated ?? false,
          event.data.unavailablePaths ?? [],
        ))
      } else {
        handlers.reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      for (const [, handlers] of pending) {
        handlers.cleanup()
        handlers.reject(new Error(event.message))
      }
      pending.clear()
      // Discard broken worker so next call creates a fresh one
      worker?.terminate()
      worker = null
      lastIndexRef = null
      lastIndexRevision = null
      indexSetupGeneration++
      indexSetup = null
    }
  }
  return worker
}

function ensureIndex(w: Worker, codeIndex: CodeIndex): void | Promise<void> {
  const revision = getIndexRevision(codeIndex)
  if (lastIndexRef?.deref() === codeIndex && lastIndexRevision === revision) return
  if (indexSetup?.index === codeIndex && indexSetup.revision === revision) return indexSetup.promise
  if (lastIndexRef || indexSetup) cancelPendingSearches()
  const generation = ++indexSetupGeneration
  const contentStore = codeIndex.contentStore

  const isIDB = contentStore instanceof IDBContentStore

  if (isIDB) {
    const idbStore = contentStore as IDBContentStore
    // Send metadata-only — worker loads content from IDB directly
    w.postMessage({
      type: 'setIndex',
      codeIndex: serializeCodeIndexMeta(codeIndex),
      storeKey: idbStore.storeKey,
      contentOverlay: idbStore.getSessionOverlay(),
    })
  } else if (contentStore.bulkReadMode === 'resident-only') {
    const allPaths = Array.from(codeIndex.files.keys())
    const residentPaths = contentStore instanceof LazyContentStore
      ? allPaths.filter(path => contentStore.hasContent(path))
      : allPaths
    const setupPromise = resolveFileContents(codeIndex, residentPaths).then(resolved => {
      if (generation !== indexSetupGeneration) {
        throw new DOMException('Search index setup superseded', 'AbortError')
      }
      const files = new Map(codeIndex.files)
      for (const [path, content] of resolved.contents) {
        const file = files.get(path)
        if (file) files.set(path, { ...file, content })
      }
      w.postMessage({
        type: 'setIndex',
        codeIndex: serializeCodeIndex({ ...codeIndex, files }),
      })
      lastIndexRef = new WeakRef(codeIndex)
      lastIndexRevision = revision
    })
    indexSetup = { index: codeIndex, revision, promise: setupPromise }
    const clearSetup = () => {
      if (indexSetup?.promise === setupPromise) indexSetup = null
    }
    setupPromise.then(clearSetup, clearSetup)
    return setupPromise
  } else {
    // InMemory repos: send full content (current behavior)
    w.postMessage({
      type: 'setIndex',
      codeIndex: serializeCodeIndex(codeIndex),
    })
  }

  lastIndexRef = new WeakRef(codeIndex)
  lastIndexRevision = revision
}

/**
 * Search code index in a Web Worker thread.
 * Content search intentionally requires a worker so user-controlled searches never
 * scan repository source on the browser main thread.
 */
export function searchInWorker(
  codeIndex: CodeIndex,
  query: string,
  options: WorkerSearchOptions = {},
): Promise<AsyncSearchResult> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Web Worker unavailable; repository content search was not started'))
  }
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal))

  const id = ++requestId
  let w: Worker
  try {
    w = getWorker()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  const { signal, ...workerOptions } = options

  const startSearch = () => new Promise<AsyncSearchResult>((resolve, reject) => {
    const handleAbort = () => {
      const handlers = pending.get(id)
      if (!handlers) return
      pending.delete(id)
      handlers.cleanup()
      w.postMessage({ type: 'cancel', id })
      reject(abortError(signal))
    }
    const cleanup = () => signal?.removeEventListener('abort', handleAbort)
    pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', handleAbort, { once: true })
    if (signal?.aborted) {
      handleAbort()
      return
    }
    w.postMessage({
      type: 'search',
      id,
      query,
      options: workerOptions,
    })
  })

  try {
    const setup = ensureIndex(w, codeIndex)
    if (!setup) return startSearch()
    return setup.then(() => {
      if (signal?.aborted) throw abortError(signal)
      return startSearch()
    })
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Cancel all pending searches, rejecting their promises. */
export function cancelPendingSearches(): void {
  for (const [id, handlers] of pending) {
    worker?.postMessage({ type: 'cancel', id })
    handlers.cleanup()
    handlers.reject(new DOMException('Search cancelled', 'AbortError'))
  }
  pending.clear()
}

export function terminateSearchWorker(): void {
  indexSetupGeneration++
  indexSetup = null
  lastIndexRevision = null
  if (worker) {
    worker.terminate()
    worker = null
    lastIndexRef = null
    for (const [, handlers] of pending) {
      handlers.cleanup()
      handlers.reject(new Error('Worker terminated'))
    }
    pending.clear()
  }
}
