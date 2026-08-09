// Web Worker entry — runs authoritative async scans off the main thread.

import { IDBContentStore } from '../content-store'
import { scanIssuesAsync } from './scanner'
import {
  deserializeCodeIndex,
  deserializeFullAnalysis,
  serializeScanResults,
} from './serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from './serialization'

const controllers = new Map<number, AbortController>()

function postResponse(response: ScanWorkerResponse): void {
  ;(self as unknown as { postMessage(message: ScanWorkerResponse): void }).postMessage(response)
}

async function handleScan(request: Extract<ScanWorkerRequest, { type: 'scan' }>): Promise<void> {
  const controller = new AbortController()
  controllers.set(request.id, controller)

  try {
    const codeIndex = deserializeCodeIndex(request.codeIndex)
    if (request.storeKey) {
      const store = new IDBContentStore(request.storeKey, undefined, { kind: 'disabled' })
      store.registerPaths(codeIndex.files.keys())
      codeIndex.contentStore = store
    }

    const analysis = request.analysis ? deserializeFullAnalysis(request.analysis) : null
    const results = await scanIssuesAsync(codeIndex, analysis, {
      ...request.options,
      signal: controller.signal,
    })
    postResponse({ type: 'result', id: request.id, results: serializeScanResults(results) })
  } catch (error) {
    const errorRecord = typeof error === 'object' && error !== null
      ? error as { name?: unknown; message?: unknown }
      : undefined
    postResponse({
      type: 'error',
      id: request.id,
      name: typeof errorRecord?.name === 'string' ? errorRecord.name : undefined,
      error: typeof errorRecord?.message === 'string' ? errorRecord.message : String(error),
    })
  } finally {
    if (controllers.get(request.id) === controller) controllers.delete(request.id)
  }
}

self.addEventListener('message', (event: MessageEvent<ScanWorkerRequest>) => {
  const request = event.data
  switch (request.type) {
    case 'scan':
      void handleScan(request)
      break
    case 'cancel':
      controllers.get(request.id)?.abort()
      break
    default: {
      const exhaustive: never = request
      throw new Error(`Unsupported scanner worker request: ${String(exhaustive)}`)
    }
  }
})
