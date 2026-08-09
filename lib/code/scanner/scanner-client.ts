// Client-side wrapper — dispatches scan requests to a Web Worker.
// Falls back to async hydrated scanning when Workers are unavailable (SSR, tests).

import type { CodeIndex } from '../code-index'
import { IDBContentStore } from '../content-store'
import type { FullAnalysis } from '../parser/types'
import type { ScanResults } from './types'
import type { AsyncScanOptions } from './scanner'
import {
  serializeCodeIndex,
  serializeCodeIndexMeta,
  serializeFullAnalysis,
  deserializeScanResults,
} from './serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from './serialization'

let worker: Worker | null = null
let requestId = 0
interface PendingScan {
  resolve: (result: ScanResults) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abortListener?: () => void
}
const pending = new Map<number, PendingScan>()

function abortError(): DOMException {
  return new DOMException('The scan was aborted', 'AbortError')
}

function removePending(id: number): PendingScan | undefined {
  const handlers = pending.get(id)
  if (!handlers) return undefined
  pending.delete(id)
  if (handlers.signal && handlers.abortListener) {
    handlers.signal.removeEventListener('abort', handlers.abortListener)
  }
  return handlers
}

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./scanner.worker.ts', import.meta.url))
      worker.onmessage = (event: MessageEvent<ScanWorkerResponse>) => {
        const data = event.data
        const handlers = removePending(data.id)
        if (!handlers) return
        if (data.type === 'result') {
          handlers.resolve(deserializeScanResults(data.results))
        } else if (data.name === 'AbortError') {
          handlers.reject(abortError())
        } else {
          handlers.reject(new Error(data.error))
        }
      }
      worker.onerror = (event) => {
        console.warn('[scanner-client] Worker error:', event.message)
        for (const [id, handlers] of pending) {
          removePending(id)
          handlers.reject(new Error(event.message ?? 'Worker error'))
        }
        // Discard broken worker so next call creates a fresh one
        worker?.terminate()
        worker = null
      }
    } catch {
      // Worker construction failed (e.g. CSP, unsupported environment)
      return null
    }
  }
  return worker
}

/**
 * Run the issue scanner in a Web Worker so the main thread stays responsive.
 * Falls back to an async hydrated in-thread scan when Workers are unavailable.
 */
export async function scanInWorker(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  optionsOrChangedFiles: AsyncScanOptions | string[] = {},
): Promise<ScanResults> {
  const options: AsyncScanOptions = Array.isArray(optionsOrChangedFiles)
    ? { changedFiles: optionsOrChangedFiles }
    : optionsOrChangedFiles
  if (options.signal?.aborted) throw abortError()

  const w = getWorker()
  if (!w) {
    // Fallback: run in the current thread
    const { scanIssuesAsync } = await import('./scanner')
    return scanIssuesAsync(codeIndex, analysis, options)
  }

  const id = ++requestId
  const isIDB = codeIndex.contentStore instanceof IDBContentStore

  return new Promise<ScanResults>((resolve, reject) => {
    const handlers: PendingScan = { resolve, reject, signal: options.signal }
    if (options.signal) {
      handlers.abortListener = () => {
        w.postMessage({ type: 'cancel', id } satisfies ScanWorkerRequest)
        const aborted = removePending(id)
        aborted?.reject(abortError())
      }
      options.signal.addEventListener('abort', handlers.abortListener, { once: true })
    }
    pending.set(id, handlers)
    const serializedOptions = {
      ...(options.changedFiles && { changedFiles: options.changedFiles }),
      ...(options.metadataOnly !== undefined && { metadataOnly: options.metadataOnly }),
      ...(options.failureMode && { failureMode: options.failureMode }),
    }
    const message: ScanWorkerRequest = {
      type: 'scan',
      id,
      codeIndex: isIDB
        ? serializeCodeIndexMeta(codeIndex)
        : serializeCodeIndex(codeIndex),
      analysis: analysis ? serializeFullAnalysis(analysis) : null,
      options: serializedOptions,
      ...(isIDB && { storeKey: (codeIndex.contentStore as IDBContentStore).storeKey }),
    }
    w.postMessage(message)
  })
}

/** Terminate the scanner worker and reject any pending requests. */
export function terminateScanWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
    for (const [id, handlers] of pending) {
      removePending(id)
      handlers.reject(new Error('Worker terminated'))
    }
  }
}
