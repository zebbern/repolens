// Web Worker entry — runs scanIssues off the main thread.

import { scanIssues } from './scanner'
import {
  deserializeCodeIndex,
  deserializeFullAnalysis,
  serializeScanResults,
} from './serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from './serialization'

self.addEventListener('message', (event: MessageEvent<ScanWorkerRequest>) => {
  const { id, codeIndex: serializedIndex, analysis: serializedAnalysis, changedFiles } = event.data

  try {
    const codeIndex = deserializeCodeIndex(serializedIndex)
    const analysis = serializedAnalysis ? deserializeFullAnalysis(serializedAnalysis) : null
    const results = scanIssues(codeIndex, analysis, changedFiles)
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
