// Web Worker entry — runs scanIssuesAsync off the main thread.

import { scanIssuesAsync } from './scanner'
import {
  deserializeCodeIndex,
  deserializeFullAnalysis,
  serializeScanResults,
} from './serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from './serialization'
import { IDBContentStore } from '../content-store'

self.addEventListener('message', async (event: MessageEvent<ScanWorkerRequest>) => {
  const { id, codeIndex: serializedIndex, analysis: serializedAnalysis, changedFiles, storeKey } = event.data

  try {
    const codeIndex = deserializeCodeIndex(serializedIndex)

    // For IDB-backed repos: load content from IDB
    if (storeKey) {
      const store = new IDBContentStore(storeKey, undefined, { kind: 'disabled' })
      store.registerPaths(codeIndex.files.keys())
      codeIndex.contentStore = store
    }

    const analysis = serializedAnalysis ? deserializeFullAnalysis(serializedAnalysis) : null
    // scanIssuesAsync owns the whole pipeline: SCANNER_EXCLUDE_PATTERNS filtering,
    // the Tree-sitter merge (phase 5b), the analysis cross-reference, the severity
    // sort, per-issue risk scoring and the health/security/quality grades.
    // It returns null only when an `isStale` callback aborts the scan; this worker
    // never passes one, so null here means the contract changed.
    const results = await scanIssuesAsync(codeIndex, analysis, { changedFiles })
    if (!results) {
      throw new Error('scanIssuesAsync returned null without an isStale callback')
    }

    const response: ScanWorkerResponse = {
      type: 'result',
      id,
      results: serializeScanResults(results),
    }
    ;(self as unknown as { postMessage(msg: ScanWorkerResponse): void }).postMessage(response)
  } catch (err) {
    const response: ScanWorkerResponse = {
      type: 'error',
      id,
      error: err instanceof Error ? err.message : String(err),
    }
    ;(self as unknown as { postMessage(msg: ScanWorkerResponse): void }).postMessage(response)
  }
})
