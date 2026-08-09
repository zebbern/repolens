/// <reference lib="webworker" />

import { searchIndex } from './code-index'
import { deserializeCodeIndex } from './scanner/serialization'
import type { SerializedCodeIndex } from './scanner/serialization'
import type { CodeIndex, SearchResult } from './code-index'
import { IDBContentStore } from './content-store'

export type SearchWorkerRequest =
  | { type: 'setIndex'; codeIndex: SerializedCodeIndex; repoKey?: string }
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
let contentReady: Promise<void> | null = null

self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'setIndex') {
    currentIndex = deserializeCodeIndex(msg.codeIndex)

    if (msg.repoKey) {
      // IDB-backed repo: load all content from IDB into the deserialized index
      const store = new IDBContentStore(msg.repoKey, undefined, { kind: 'disabled' })
      const paths = Array.from(currentIndex.files.keys())
      contentReady = store
        .getBatch(paths)
        .then((contents) => {
          if (!currentIndex) return
          for (const [path, content] of contents) {
            const file = currentIndex.files.get(path)
            if (file) {
              // Mutate in-place — worker owns this copy
              ;(file as { content: string }).content = content
            }
          }
        })
        .catch(() => {
          // IDB read failed — content stays empty, search will return no results
        })
    } else {
      contentReady = null
    }
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

    const doSearch = () => {
      try {
        const results = searchIndex(currentIndex!, msg.query, msg.options)
        self.postMessage({
          type: 'result',
          id: msg.id,
          results,
        } satisfies SearchWorkerResponse)
      } catch (err) {
        self.postMessage({
          type: 'error',
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SearchWorkerResponse)
      }
    }

    // For IDB repos, wait for content to be loaded before searching
    if (contentReady) {
      contentReady.then(doSearch)
    } else {
      // InMemory repos: synchronous search (zero behavior change)
      doSearch()
    }
  }
}
