import type { Dispatch, SetStateAction } from 'react'
import type { GitHubRepo, FileNode, RepositoryCoverage } from '@/types/repository'
import { detectLanguage } from '@/lib/github/fetcher'
import { fetchFileViaProxy } from '@/lib/github/client'
import type { CodeIndex } from '@/lib/code/code-index'
import { createEmptyIndex, createEmptyIndexWithStore, batchIndexFiles, batchIndexMetadataOnly, flattenFiles } from '@/lib/code/code-index'
import { IDBContentStore, InMemoryContentStore, LazyContentStore } from '@/lib/code/content-store'
import { FetchQueue } from '@/lib/code/fetch-queue'
import { streamUnzipFiles, isFileIndexable, isProbablyBinaryContent, MAX_FILE_SIZE } from '@/lib/github/zipball'
import { publishCachedRepo } from '@/lib/cache/repo-cache'
import { requireCrossContextCacheCoordination, withCacheMutationLock } from '@/lib/cache/cache-mutation-lock'
import { fetchWithConcurrency } from './fetch-utils'
import { LAZY_CONTENT_THRESHOLD_KB, getIdbThresholdKB } from '@/config/constants'
import { toast } from 'sonner'
import { updateRepositoryCoverage } from '@/lib/repository'

const CONCURRENCY_LIMIT = 10
const NOT_CACHED_WARNING = 'Repository is ready, but it was not cached for future visits.'

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
  setCoverage?: (coverage: RepositoryCoverage) => void
}

function warnNotCached(error: unknown): void {
  console.warn('Repository cache publication failed:', error)
  toast.warning(NOT_CACHED_WARNING)
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
  options: { token?: string; coverage?: RepositoryCoverage } = {},
): Promise<void> {
  const { setIndexingProgress, setLoadingStage, setCodeIndex, setFailedFiles, setCoverage } = callbacks

  // Get all indexable files from tree metadata
  const indexableFiles = flattenFiles(fileTree).filter(f =>
    f.gitType !== 'commit' && isFileIndexable(f.name, f.size || 0),
  )
  const discoveredPaths = new Set(indexableFiles.map(file => file.path))
  const treeDiscoveredPaths = new Set(discoveredPaths)
  const initialCoverage: RepositoryCoverage = options.coverage ?? {
    treeStatus: 'complete',
    supportedFiles: { discovered: discoveredPaths.size, loaded: 0 },
    failures: { count: 0, samples: [] },
    failedSubtrees: { count: 0, samples: [] },
    mode: repoData.size != null && repoData.size >= LAZY_CONTENT_THRESHOLD_KB ? 'on-demand' : 'full',
  }

  setIndexingProgress({ current: 0, total: indexableFiles.length, isComplete: false })

  if (indexableFiles.length === 0) {
    const coverage = updateRepositoryCoverage(initialCoverage, 0, 0, [])
    const emptyIndex = createEmptyIndex()
    emptyIndex.coverage = coverage
    try {
      await withCacheMutationLock(signal, async lease => {
        await emptyIndex.contentStore.flush()
        if (signal.aborted) return
        await publishCachedRepo(lease, repoData.owner, repoData.name, treeSha, [], fileTree, coverage, {
          description: repoData.description,
          stars: repoData.stars,
          language: repoData.language,
        })
      })
    } catch (error) {
      if (signal.aborted) return
      warnNotCached(error)
    }
    if (signal.aborted) return
    setCodeIndex(emptyIndex)
    setFailedFiles([])
    setCoverage?.(coverage)
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
        { signal },
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
    const lazyStore = new LazyContentStore(repoKey, fetchQueue, signal)
    lazyStore.registerPaths(indexableFiles.map(f => f.path))

    const metadataEntries = indexableFiles.map(f => ({
      path: f.path,
      language: f.language ?? detectLanguage(f.name),
      lineCount: undefined,
    }))

    const baseIndex = createEmptyIndexWithStore(lazyStore)
    const finalIndex = batchIndexMetadataOnly(baseIndex, metadataEntries)
    const coverage = updateRepositoryCoverage(initialCoverage, discoveredPaths.size, 0, [])
    finalIndex.coverage = coverage

    await lazyStore.flush()
    if (signal.aborted) return
    try {
      await withCacheMutationLock(signal, async lease => {
        requireCrossContextCacheCoordination(lease)
      })
    } catch (error) {
      if (signal.aborted) return
      warnNotCached(error)
    }
    setCodeIndex(finalIndex)
    setCoverage?.(coverage)
    setIndexingProgress({ current: indexableFiles.length, total: indexableFiles.length, isComplete: true })
    setLoadingStage('ready')
    // FetchQueue accessible via codeIndex.contentStore (LazyContentStore.getFetchQueue())
    return
  }

  const accumulated: Array<{ path: string; content: string; language?: string }> = []
  const errors: Array<{ path: string; error: string }> = []
  let zipballUsed = false

  const useIDB = repoData.size != null && repoData.size >= getIdbThresholdKB()

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
          if (signal.aborted) return
          const filename = path.split('/').pop() || path
          discoveredPaths.add(path)
          accumulated.push({ path, content, language: detectLanguage(filename) })

          // Progress update per file
          setIndexingProgress(prev => ({
            ...prev,
            current: accumulated.length,
            total: Math.max(prev.total, accumulated.length),
          }))
        },
        {
          signal,
          onSkipped: path => discoveredPaths.delete(path),
        },
      )

      zipballUsed = true
      const loadedPaths = new Set(accumulated.map(file => file.path))
      for (const path of discoveredPaths) {
        if (!loadedPaths.has(path)) errors.push({ path, error: 'Supported file was not present in the ZIP extraction' })
      }
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
      discoveredPaths.clear()
      for (const path of treeDiscoveredPaths) discoveredPaths.add(path)
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
            { signal },
          )

          if (signal.aborted) return

          if (content.length > MAX_FILE_SIZE || isProbablyBinaryContent(content)) {
            discoveredPaths.delete(file.path)
            return
          }

          accumulated.push({ path: file.path, content, language: file.language })
        } catch (err) {
          if (signal.aborted) return
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

  const loadedPaths = new Set(accumulated.map(file => file.path))
  const coverage = updateRepositoryCoverage(
    initialCoverage,
    discoveredPaths.size,
    [...loadedPaths].filter(path => discoveredPaths.has(path)).length,
    errors,
  )
  let finalIndex: CodeIndex | undefined
  let contentDurable = false
  try {
    await withCacheMutationLock(signal, async lease => {
      requireCrossContextCacheCoordination(lease)
      // The lock starts before the final content transaction and remains held
      // through manifest publication and all destructive maintenance.
      const contentStore = useIDB
        ? new IDBContentStore(
            `${repoData.owner}/${repoData.name}`,
            signal,
            { kind: 'coordinated', lease },
          )
        : null
      const baseIndex = contentStore
        ? createEmptyIndexWithStore(contentStore)
        : createEmptyIndex()
      finalIndex = batchIndexFiles(baseIndex, accumulated)
      finalIndex.coverage = coverage
      await finalIndex.contentStore.flush()
      contentDurable = true
      if (signal.aborted) return

      await publishCachedRepo(lease, repoData.owner, repoData.name, treeSha, accumulated, fileTree, coverage, {
        description: repoData.description,
        stars: repoData.stars,
        language: repoData.language,
      }, {
        ...(contentStore && { contentPaths: accumulated.map(file => file.path) }),
      })
    })
  } catch (error) {
    if (signal.aborted) return
    if (!finalIndex) finalIndex = batchIndexFiles(createEmptyIndex(), accumulated)
    if (!contentDurable) {
      finalIndex.contentStore = new InMemoryContentStore(
        new Map(accumulated.map(file => [file.path, file.content])),
      )
    }
    warnNotCached(error)
  }
  if (signal.aborted) return
  if (!finalIndex) return
  finalIndex.coverage = coverage

  setCodeIndex(finalIndex)
  setFailedFiles(errors)
  setCoverage?.(coverage)
  setIndexingProgress({
    current: accumulated.length,
    total: zipballUsed ? accumulated.length : indexableFiles.length,
    isComplete: true,
  })
  setLoadingStage('ready')

  // B6: Notify user of failed files
  if (errors.length > 0) {
    toast.error(
      `Indexed ${accumulated.length} files (${errors.length} failed)`,
    )
  }
}
