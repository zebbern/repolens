import type { Dispatch, SetStateAction } from 'react'
import type { GitHubRepo, FileNode } from '@/types/repository'
import { detectLanguage } from '@/lib/github/fetcher'
import { fetchFileViaProxy } from '@/lib/github/client'
import type { CodeIndex } from '@/lib/code/code-index'
import { createEmptyIndex, createEmptyIndexWithStore, batchIndexFiles, batchIndexMetadataOnly, flattenFiles } from '@/lib/code/code-index'
import { IDBContentStore, LazyContentStore } from '@/lib/code/content-store'
import { FetchQueue } from '@/lib/code/fetch-queue'
import { streamUnzipFiles, isFileIndexable } from '@/lib/github/zipball'
import { setCachedRepo } from '@/lib/cache/repo-cache'
import { fetchWithConcurrency } from './fetch-utils'
import { LAZY_CONTENT_THRESHOLD_KB, getIdbThresholdKB } from '@/config/constants'
import { toast } from 'sonner'

const CONCURRENCY_LIMIT = 10

/** Subset of LoadingStage relevant during indexing. */
type IndexingStage = 'tree-ready' | 'downloading' | 'extracting' | 'indexing' | 'lazy-indexing' | 'ready'

interface IndexingProgress {
  current: number
  total: number
  isComplete: boolean
}

interface IndexingCallbacks {
  setIndexingProgress: Dispatch<SetStateAction<IndexingProgress>>
  setLoadingStage: (stage: IndexingStage) => void
  setCodeIndex: (index: CodeIndex) => void
  setFailedFiles: (files: Array<{ path: string; error: string }>) => void
}

/**
 * Downloads, indexes, and caches repository files.
 *
 * Tries a zipball download first (for repos < 200 MB), then falls back to
 * per-file fetching with concurrency control.
 */
export async function startIndexing(
  repoData: GitHubRepo,
  fileTree: FileNode[],
  treeSha: string,
  signal: AbortSignal,
  callbacks: IndexingCallbacks,
  options: { token?: string } = {},
): Promise<void> {
  const { setIndexingProgress, setLoadingStage, setCodeIndex, setFailedFiles } = callbacks

  // Get all indexable files from tree metadata
  const indexableFiles = flattenFiles(fileTree).filter(f =>
    isFileIndexable(f.name, f.size || 0),
  )

  setIndexingProgress({ current: 0, total: indexableFiles.length, isComplete: false })

  if (indexableFiles.length === 0) {
    setIndexingProgress({ current: 0, total: 0, isComplete: true })
    setLoadingStage('ready')
    return
  }

  // Phase 4: Lazy content loading for repos >= 200 MB
  if (repoData.size != null && repoData.size >= LAZY_CONTENT_THRESHOLD_KB) {
    setLoadingStage('lazy-indexing')

    const fetchQueue = new FetchQueue({
      fetchFn: (path) => fetchFileViaProxy(
        repoData.owner, repoData.name, repoData.defaultBranch, path,
      ),
      concurrency: CONCURRENCY_LIMIT,
      onProgress: (stats) => setIndexingProgress({
        current: stats.completed,
        total: stats.total,
        isComplete: false,
      }),
      signal,
    })

    const repoKey = `${repoData.owner}/${repoData.name}`
    const lazyStore = new LazyContentStore(repoKey, fetchQueue)
    lazyStore.registerPaths(indexableFiles.map(f => f.path))

    const metadataEntries = indexableFiles.map(f => ({
      path: f.path,
      language: f.language ?? detectLanguage(f.name),
      lineCount: undefined,
    }))

    const baseIndex = createEmptyIndexWithStore(lazyStore)
    const finalIndex = batchIndexMetadataOnly(baseIndex, metadataEntries)

    setCodeIndex(finalIndex)
    setIndexingProgress({ current: indexableFiles.length, total: indexableFiles.length, isComplete: true })
    setLoadingStage('ready')
    // FetchQueue accessible via codeIndex.contentStore (LazyContentStore.getFetchQueue())
    return
  }

  const accumulated: Array<{ path: string; content: string; language?: string }> = []
  const errors: Array<{ path: string; error: string }> = []
  let zipballUsed = false

  // For IDB tier (50-200 MB): create content store early so we can write during streaming
  const useIDB = repoData.size != null && repoData.size >= getIdbThresholdKB()
  const contentStore = useIDB
    ? new IDBContentStore(`${repoData.owner}/${repoData.name}`)
    : null

  // B1: Try streaming zipball for repos under 200 MB
  if (repoData.size != null && repoData.size < LAZY_CONTENT_THRESHOLD_KB) {
    try {
      setLoadingStage('downloading')

      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (options.token) {
        headers['X-GitHub-Token'] = options.token
      }

      const response = await fetch('/api/github/zipball', {
        method: 'POST',
        headers,
        body: JSON.stringify({ owner: repoData.owner, repo: repoData.name, ref: repoData.defaultBranch }),
        signal,
      })

      if (!response.ok) {
        throw new Error(`Zipball download failed: ${response.status} ${response.statusText}`)
      }

      if (signal.aborted) return

      // Download and extraction happen simultaneously with streaming
      // — keep 'downloading' stage throughout

      await streamUnzipFiles(
        response,
        (path, content) => {
          const filename = path.split('/').pop() || path
          accumulated.push({ path, content, language: detectLanguage(filename) })

          // Write to IDB as files arrive (fire-and-forget)
          if (contentStore) {
            contentStore.put(path, content)
          }

          // Progress update per file
          setIndexingProgress(prev => ({
            ...prev,
            current: accumulated.length,
            total: Math.max(prev.total, accumulated.length),
          }))
        },
        { signal },
      )

      zipballUsed = true
      setIndexingProgress({
        current: accumulated.length,
        total: accumulated.length,
        isComplete: false,
      })
    } catch (err) {
      // Zipball failed — fall back to per-file fetch
      if (signal.aborted) return
      console.warn('Zipball download failed, falling back to per-file fetch:', err)
      accumulated.length = 0 // Clear any partial results
      if (contentStore) {
        contentStore.clear().catch(() => {})
      }
    }
  }

  // Per-file fetch fallback
  if (!zipballUsed) {
    setLoadingStage('indexing')
    let processed = 0

    await fetchWithConcurrency(
      indexableFiles,
      async (file) => {
        if (signal.aborted) return

        try {
          const content = await fetchFileViaProxy(
            repoData.owner,
            repoData.name,
            repoData.defaultBranch,
            file.path,
          )

          if (signal.aborted) return

          accumulated.push({ path: file.path, content, language: file.language })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          errors.push({ path: file.path, error: message })
        }

        processed++
        if (processed % 5 === 0 || processed === indexableFiles.length) {
          setIndexingProgress(prev => ({ ...prev, current: processed }))
        }
      },
      CONCURRENCY_LIMIT,
    )
  }

  if (signal.aborted) return

  setLoadingStage('indexing')

  // B3: Batch-index all accumulated files at once (avoids O(N²) Map copies)
  const baseIndex = contentStore
    ? createEmptyIndexWithStore(contentStore)
    : createEmptyIndex()
  const finalIndex = batchIndexFiles(baseIndex, accumulated)

  setCodeIndex(finalIndex)
  setFailedFiles(errors)
  setIndexingProgress({
    current: accumulated.length,
    total: zipballUsed ? accumulated.length : indexableFiles.length,
    isComplete: true,
  })
  setLoadingStage('ready')

  // B2: Persist to IndexedDB cache
  setCachedRepo(repoData.owner, repoData.name, treeSha, accumulated, fileTree, {
    description: repoData.description,
    stars: repoData.stars,
    language: repoData.language,
  })
    .catch(() => { /* cache write failure is non-critical */ })

  // B6: Notify user of failed files
  if (errors.length > 0) {
    toast.error(
      `Indexed ${accumulated.length} files (${errors.length} failed)`,
    )
  }
}
