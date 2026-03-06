/// <reference lib="webworker" />

import { searchIndex } from './code-index'
import { deserializeCodeIndex } from './scanner/serialization'
import type { SerializedCodeIndex } from './scanner/serialization'
import type { CodeIndex, SearchResult } from './code-index'

export type SearchWorkerRequest =
  | { type: 'setIndex'; codeIndex: SerializedCodeIndex }
  | {
      type: 'search'
      id: number
      query: string
      options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }
    }

export type SearchWorkerResponse =
  | { type: 'result'; id: number; results: SearchResult[] }
  | { type: 'error'; id: number; error: string }

let currentIndex: CodeIndex | null = null

self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'setIndex') {
    currentIndex = deserializeCodeIndex(msg.codeIndex)
    return
  }

  if (msg.type === 'search') {
    if (!currentIndex) {
      self.postMessage({ type: 'error', id: msg.id, error: 'No index set' } satisfies SearchWorkerResponse)
      return
    }
    try {
      const results = searchIndex(currentIndex, msg.query, msg.options)
      self.postMessage({ type: 'result', id: msg.id, results } satisfies SearchWorkerResponse)
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SearchWorkerResponse)
    }
  }
}
