/// <reference lib="webworker" />

import { searchIndexAsync } from './code-index'
import { deserializeCodeIndex } from './scanner/serialization'
import type { SerializedCodeIndex } from './scanner/serialization'
import type { CodeIndex, SearchResult } from './code-index'
import { IDBContentStore } from './content-store'
import type { IDBSessionOverlay } from './content-store'
import type { SearchPathFilter } from './search-path-filter'

export type SearchWorkerRequest =
  | {
      type: 'setIndex'
      codeIndex: SerializedCodeIndex
      storeKey?: string
      contentOverlay?: IDBSessionOverlay
    }
  | { type: 'cancel'; id: number }
  | {
      type: 'search'
      id: number
      query: string
      options: {
        caseSensitive?: boolean
        regex?: boolean
        wholeWord?: boolean
        maxMatches?: number
        maxMatchesPerFile?: number
        pathFilter?: SearchPathFilter
      }
    }

export type SearchWorkerResponse =
  | {
      type: 'result'
      id: number
      results: SearchResult[]
      unsearchedPaths: string[]
      unavailablePaths: string[]
      truncated: boolean
    }
  | { type: 'error'; id: number; error: string }

let currentIndex: CodeIndex | null = null
const activeSearches = new Map<number, AbortController>()
self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'setIndex') {
    for (const controller of activeSearches.values()) controller.abort()
    activeSearches.clear()
    currentIndex = deserializeCodeIndex(msg.codeIndex)

    if (msg.storeKey) {
      const store = new IDBContentStore(msg.storeKey, undefined, { kind: 'disabled' })
      store.registerPaths(currentIndex.files.keys())
      if (msg.contentOverlay) store.applySessionOverlay(msg.contentOverlay)
      currentIndex.contentStore = store
    }
    return
  }

  if (msg.type === 'cancel') {
    activeSearches.get(msg.id)?.abort()
    return
  }

  if (msg.type === 'search') {
    if (!currentIndex) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        error: 'No index set',
      } satisfies SearchWorkerResponse)
      return
    }

    activeSearches.get(msg.id)?.abort()
    const controller = new AbortController()
    activeSearches.set(msg.id, controller)
    const indexForRequest = currentIndex

    const doSearch = async () => {
      try {
        const results = await searchIndexAsync(indexForRequest, msg.query, {
          caseSensitive: msg.options.caseSensitive,
          regex: msg.options.regex,
          wholeWord: msg.options.wholeWord,
          maxMatches: msg.options.maxMatches,
          maxMatchesPerFile: msg.options.maxMatchesPerFile,
          pathFilter: msg.options.pathFilter,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        self.postMessage({
          type: 'result',
          id: msg.id,
          results: Array.from(results),
          unsearchedPaths: results.unsearchedPaths,
          unavailablePaths: results.unavailablePaths,
          truncated: results.truncated,
        } satisfies SearchWorkerResponse)
      } catch (err) {
        if (controller.signal.aborted) return
        self.postMessage({
          type: 'error',
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SearchWorkerResponse)
      } finally {
        if (activeSearches.get(msg.id) === controller) activeSearches.delete(msg.id)
      }
    }

    void doSearch()
  }
}
