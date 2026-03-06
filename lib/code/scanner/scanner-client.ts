// Client-side wrapper — dispatches scan requests to a Web Worker.
// Falls back to synchronous scanIssues when Workers are unavailable (SSR, tests).

import type { CodeIndex } from '../code-index'
import type { FullAnalysis } from '../parser/types'
import type { ScanResults } from './types'
import {
  serializeCodeIndex,
  serializeFullAnalysis,
  deserializeScanResults,
} from './serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from './serialization'

let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, { resolve: (r: ScanResults) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./scanner.worker.ts', import.meta.url))
      worker.onmessage = (event: MessageEvent<ScanWorkerResponse>) => {
        const data = event.data
        const handlers = pending.get(data.id)
        if (!handlers) return
        pending.delete(data.id)
        if (data.type === 'result') {
          handlers.resolve(deserializeScanResults(data.results))
        } else {
          handlers.reject(new Error(data.error))
        }
      }
      worker.onerror = (event) => {
        console.warn('[scanner-client] Worker error:', event.message)
        for (const [, handlers] of pending) {
          handlers.reject(new Error(event.message ?? 'Worker error'))
        }
        pending.clear()
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
 * Falls back to a synchronous in-thread scan when Workers are unavailable.
 */
export async function scanInWorker(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  changedFiles?: string[],
): Promise<ScanResults> {
  const w = getWorker()
  if (!w) {
    // Fallback: run in the current thread
    const { scanIssues } = await import('./scanner')
    return scanIssues(codeIndex, analysis, changedFiles)
  }

  const id = ++requestId
  return new Promise<ScanResults>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const message: ScanWorkerRequest = {
      id,
      codeIndex: serializeCodeIndex(codeIndex),
      analysis: analysis ? serializeFullAnalysis(analysis) : null,
      changedFiles,
    }
    w.postMessage(message)
  })
}

/** Terminate the scanner worker and reject any pending requests. */
export function terminateScanWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
    for (const [, handlers] of pending) {
      handlers.reject(new Error('Worker terminated'))
    }
    pending.clear()
  }
}
