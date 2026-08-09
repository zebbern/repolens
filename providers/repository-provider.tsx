"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile, RepositoryCoverage } from "@/types/repository"
import type { PinnedFile, PinnedContentsResult } from "@/types/types"
import { PINNED_CONTEXT_CONFIG } from "@/config/constants"
import { parseGitHubUrl } from "@/lib/github/parser"
import { buildFileTree } from "@/lib/github/fetcher"
import { fetchRepoViaProxy, fetchTreeViaProxy, fetchFileViaProxy } from "@/lib/github/client"
import type { CodeIndex } from "@/lib/code/code-index"
import { createEmptyIndex, hydrateCodeIndexContent, invalidateLinesCache } from '@/lib/code/code-index'
import { buildTreeFromFiles, type FileRename } from '@/lib/code/rename-files'
import { IDBContentStore, InMemoryContentStore, LazyContentStore } from '@/lib/code/content-store'
import type { FetchQueue } from '@/lib/code/fetch-queue'
import { withHydratedCachedRepo } from "@/lib/cache/repo-cache"
import { toast } from 'sonner'
import { analyzeCodebase, type FullAnalysis } from "@/lib/code/import-parser"
import { startIndexing as runIndexingPipeline } from "@/lib/github/indexing-pipeline"
import { useGitHubToken } from "@/providers/github-token-provider"
import {
  DEFAULT_SEARCH_STATE,
  DEFAULT_INDEXING_PROGRESS,
  DEFAULT_CONTENT_LOADING_STATS,
  createRepositoryCoverage,
  type IndexingProgress,
  type SearchState,
  type LoadingStage,
  type ContentAvailability,
  type ContentLoadingStats,
} from '@/lib/repository'

// Re-export for backward compatibility
export type { LoadingStage, SearchState, ContentAvailability, ContentLoadingStats } from '@/lib/repository'

export interface RepositorySession {
  readonly id: number
  readonly signal: AbortSignal
}

function makeContentResident(index: CodeIndex): CodeIndex {
  if (!(index.contentStore instanceof IDBContentStore)) return index
  const content = new Map<string, string>()
  for (const [path, file] of index.files) {
    if (file.content === undefined) return index
    content.set(path, file.content)
  }
  return {
    ...index,
    contentStore: new InMemoryContentStore(content),
  }
}

// Data context — rarely changes after repo load/indexing
export interface RepositoryDataContextType {
  repo: GitHubRepo | null
  files: FileNode[]
  parsedFiles: Map<string, ParsedFile>
  codeIndex: CodeIndex
  codebaseAnalysis: FullAnalysis | null
  failedFiles: Array<{ path: string; error: string }>
  isCacheHit: boolean
  repositorySession: RepositorySession | null
  coverage: RepositoryCoverage | null
}

// Actions context — stable callbacks (never change identity)
export interface RepositoryActionsContextType {
  connectRepository: (url: string) => Promise<boolean>
  disconnectRepository: () => void
  loadFileContent: (path: string, session?: RepositorySession | null) => Promise<string | null>
  getFileByPath: (path: string) => FileNode | null
  updateCodeIndex: (index: CodeIndex) => void
  pinFile: (path: string, type?: 'file' | 'directory') => void
  unpinFile: (path: string) => void
  clearPins: () => void
  /** Virtually rename files (session-local): re-keys the tree, index, content store, edits and pins. Returns the count applied. */
  renameFiles: (renames: FileRename[]) => Promise<number>
  getPinnedContents: () => Promise<PinnedContentsResult>
  getTabCache: <T>(key: string) => T | undefined
  setTabCache: (key: string, value: unknown) => void
  setSearchState: Dispatch<SetStateAction<SearchState>>
  setModifiedContents: Dispatch<SetStateAction<Map<string, string>>>
  getFileContent: (path: string, session?: RepositorySession | null) => Promise<string | null>
  getRepositorySession: () => RepositorySession | null
  isRepositorySessionCurrent: (session: RepositorySession | null) => boolean
}

// Progress context — changes frequently during indexing/search/pins
export interface RepositoryProgressContextType {
  isLoading: boolean
  error: string | null
  indexingProgress: IndexingProgress
  searchState: SearchState
  modifiedContents: Map<string, string>
  loadingStage: LoadingStage
  contentAvailability: ContentAvailability
  contentLoadingStats: ContentLoadingStats
  pinnedFiles: Map<string, PinnedFile>
  isPinned: (path: string) => boolean
}

// Combined type for backward compatibility
type RepositoryContextType = RepositoryDataContextType & RepositoryActionsContextType & RepositoryProgressContextType

const RepositoryDataCtx = createContext<RepositoryDataContextType | null>(null)
const RepositoryActionsCtx = createContext<RepositoryActionsContextType | null>(null)
const RepositoryProgressCtx = createContext<RepositoryProgressContextType | null>(null)

function findFileNode(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findFileNode(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

function flattenTreeLeaves(nodes: FileNode[]): FileNode[] {
  const leaves: FileNode[] = []
  for (const node of nodes) {
    if (node.type === 'directory') leaves.push(...flattenTreeLeaves(node.children ?? []))
    else leaves.push(node)
  }
  return leaves
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<GitHubRepo | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [parsedFiles, setParsedFiles] = useState<Map<string, ParsedFile>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeIndex, setCodeIndex] = useState<CodeIndex>(createEmptyIndex())
  // Mirror codeIndex in a ref so stable actions (renameFiles) can read the
  // current content-store instance without depending on codeIndex identity.
  const codeIndexRef = useRef(codeIndex)
  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>(DEFAULT_INDEXING_PROGRESS)
  const connectionEpochRef = useRef(0)
  const connectionAbortRef = useRef<AbortController | null>(null)
  const repositorySessionRef = useRef<RepositorySession | null>(null)
  const [repositorySession, setRepositorySession] = useState<RepositorySession | null>(null)
  const [searchState, setSearchState] = useState<SearchState>(DEFAULT_SEARCH_STATE)
  const [modifiedContents, setModifiedContents] = useState<Map<string, string>>(new Map())
  const [codebaseAnalysis, setCodebaseAnalysis] = useState<FullAnalysis | null>(null)
  const [failedFiles, setFailedFiles] = useState<Array<{ path: string; error: string }>>([])
  const [coverage, setCoverage] = useState<RepositoryCoverage | null>(null)
  const [isCacheHit, setIsCacheHit] = useState(false)
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle')
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, PinnedFile>>(new Map())
  const tabCacheRef = useRef<Record<string, unknown>>({})
  const [contentAvailability, setContentAvailability] = useState<ContentAvailability>('full')
  const [contentLoadingStats, setContentLoadingStats] = useState<ContentLoadingStats>(DEFAULT_CONTENT_LOADING_STATS)
  const fetchQueueRef = useRef<FetchQueue | null>(null)

  const { token: githubToken } = useGitHubToken()

  const isCurrentConnection = useCallback((epoch: number, controller: AbortController) => (
    connectionEpochRef.current === epoch
    && connectionAbortRef.current === controller
    && !controller.signal.aborted
  ), [])

  const resetRepositoryState = useCallback((next: {
    isLoading: boolean
    loadingStage: LoadingStage
  }) => {
    fetchQueueRef.current = null
    tabCacheRef.current = {}

    const emptyIndex = createEmptyIndex()
    codeIndexRef.current = emptyIndex
    setRepo(null)
    setFiles([])
    setParsedFiles(new Map())
    setIsLoading(next.isLoading)
    setError(null)
    setCodeIndex(emptyIndex)
    setIndexingProgress(DEFAULT_INDEXING_PROGRESS)
    setSearchState(DEFAULT_SEARCH_STATE)
    setModifiedContents(new Map())
    setCodebaseAnalysis(null)
    setFailedFiles([])
    setCoverage(null)
    setIsCacheHit(false)
    setLoadingStage(next.loadingStage)
    setPinnedFiles(new Map())
    setContentAvailability('full')
    setContentLoadingStats(DEFAULT_CONTENT_LOADING_STATS)
  }, [])

  useEffect(() => () => {
    connectionEpochRef.current += 1
    connectionAbortRef.current?.abort()
    connectionAbortRef.current = null
    repositorySessionRef.current = null
  }, [])

  const getRepositorySession = useCallback(() => repositorySessionRef.current, [])
  const isRepositorySessionCurrent = useCallback((session: RepositorySession | null) => (
    session !== null && repositorySessionRef.current === session && !session.signal.aborted
  ), [])

  // Helper: get file content from modifiedContents first, then codeIndex, then contentStore
  const getFileContent = useCallback(async (path: string, session = repositorySessionRef.current): Promise<string | null> => {
    if (!isRepositorySessionCurrent(session)) return null
    if (modifiedContents.has(path)) return modifiedContents.get(path)!
    const indexed = codeIndex.files.get(path)
    if (indexed?.content) return indexed.content
    const content = await codeIndex.contentStore.get(path)
    return isRepositorySessionCurrent(session) ? content : null
  }, [modifiedContents, codeIndex, isRepositorySessionCurrent])

  // Detect lazy content store and wire up progress tracking
  useEffect(() => {
    if (codeIndex.contentStore instanceof LazyContentStore) {
      const fq = codeIndex.contentStore.getFetchQueue()
      fetchQueueRef.current = fq
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setContentAvailability('metadata-only')
      })
      return () => { cancelled = true }
    } else {
      fetchQueueRef.current = null
    }
  }, [codeIndex])

  // Update content loading stats when indexing progress changes for lazy repos
  useEffect(() => {
    if (contentAvailability !== 'full' && codeIndex.contentStore instanceof LazyContentStore) {
      const lazyStore = codeIndex.contentStore
      let cancelled = false
      queueMicrotask(() => {
        if (cancelled) return
        const fetchQueue = lazyStore.getFetchQueue()
        const status = lazyStore.getContentStatus()
        setContentLoadingStats({
          completed: status.loaded,
          pending: status.pending,
          total: status.total,
          failed: fetchQueue.stats.failed,
        })
        setCoverage(current => {
          if (!current || current.mode !== 'on-demand') return current
          const failedPaths = fetchQueue.getFailedPaths()
          const next: RepositoryCoverage = {
            ...current,
            supportedFiles: {
              ...current.supportedFiles,
              loaded: Math.min(current.supportedFiles.discovered, status.loaded),
            },
            failures: {
              count: failedPaths.length,
              samples: failedPaths.slice(0, 100).map(path => ({ path, error: 'Failed to load on demand' })),
            },
          }
          codeIndexRef.current.coverage = next
          return next
        })
      })
      return () => { cancelled = true }
    }
  }, [indexingProgress, contentAvailability, codeIndex])

  // Start indexing files in background (delegated to indexing-pipeline)
  const startIndexing = useCallback((
    repoData: GitHubRepo,
    fileTree: FileNode[],
    treeSha: string,
    epoch: number,
    controller: AbortController,
    coverage: RepositoryCoverage,
    options: { token?: string } = {},
  ) => {
    const commitIfCurrent = (commit: () => void) => {
      if (isCurrentConnection(epoch, controller)) commit()
    }

    return runIndexingPipeline(repoData, fileTree, treeSha, controller.signal, {
      setIndexingProgress: value => commitIfCurrent(() => setIndexingProgress(value)),
      setLoadingStage: value => commitIfCurrent(() => setLoadingStage(value)),
      setCodeIndex: value => commitIfCurrent(() => {
        codeIndexRef.current = value
        setCodeIndex(value)
      }),
      setFailedFiles: value => commitIfCurrent(() => setFailedFiles(value)),
      setCoverage: value => commitIfCurrent(() => setCoverage(value)),
    }, { ...options, coverage })
  }, [isCurrentConnection])

  const connectRepository = useCallback(async (url: string): Promise<boolean> => {
    connectionAbortRef.current?.abort()
    const epoch = connectionEpochRef.current + 1
    connectionEpochRef.current = epoch
    const controller = new AbortController()
    connectionAbortRef.current = controller
    const session = Object.freeze({ id: epoch, signal: controller.signal })
    repositorySessionRef.current = session
    setRepositorySession(session)

    resetRepositoryState({ isLoading: true, loadingStage: 'metadata' })

    try {
      // Parse the URL
      const parsed = parseGitHubUrl(url)
      if (!parsed) {
        throw new Error('Invalid GitHub URL. Please enter a valid repository URL.')
      }

      const { owner, repo: repoName } = parsed

      // Fetch repository metadata
      const repoData = await fetchRepoViaProxy(owner, repoName, { signal: controller.signal })
      if (!isCurrentConnection(epoch, controller)) return false
      setRepo(repoData)

      // Fetch file tree
      setLoadingStage('tree')
      const tree = await fetchTreeViaProxy(owner, repoName, repoData.defaultBranch, { signal: controller.signal })
      if (!isCurrentConnection(epoch, controller)) return false
      const initialCoverage = createRepositoryCoverage(tree, repoData.size)
      setCoverage(initialCoverage)
      const fileTree = buildFileTree(tree)
      setFiles(fileTree)
      setLoadingStage('tree-ready')

      setIsLoading(false)

      // B2: Check IndexedDB cache before indexing
      if (tree.status === 'complete') {
        const usedCache = await withHydratedCachedRepo(
          owner,
          repoName,
          tree.sha,
          { signal: controller.signal },
          ({ cached, index, contentHydratedDurably, hydrationError }) => {
            if (!isCurrentConnection(epoch, controller)) return
            if (hydrationError) {
              console.warn('Failed to hydrate cached repository content in IndexedDB:', hydrationError)
              toast.warning('Repository is ready, but it was not cached for future visits.')
            }
            codeIndexRef.current = index
            setFiles(cached.tree)
            setCodeIndex(index)
            setIndexingProgress({
              current: cached.content.files.length,
              total: cached.content.files.length,
              isComplete: true,
            })
            setIsCacheHit(contentHydratedDurably)
            setCoverage(cached.coverage)
            setLoadingStage(contentHydratedDurably ? 'cached' : 'ready')
          },
        )
        if (!isCurrentConnection(epoch, controller)) return false
        if (usedCache) return true
      }
      
      // Start indexing immediately in background
      void startIndexing(repoData, fileTree, tree.sha, epoch, controller, initialCoverage, { token: githubToken ?? undefined })
        .catch(err => {
          if (!isCurrentConnection(epoch, controller)) return
          const message = err instanceof Error ? err.message : 'Failed to index repository'
          setError(message)
          setIndexingProgress(DEFAULT_INDEXING_PROGRESS)
          setLoadingStage('tree-ready')
        })
      
      return true
    } catch (err) {
      if (!isCurrentConnection(epoch, controller)) return false
      const message = err instanceof Error ? err.message : 'Failed to connect repository'
      setError(message)
      setIsLoading(false)
      setLoadingStage('idle')
      return false
    }
  }, [githubToken, isCurrentConnection, resetRepositoryState, startIndexing])

  const disconnectRepository = useCallback(() => {
    connectionEpochRef.current += 1
    connectionAbortRef.current?.abort()
    connectionAbortRef.current = null
    repositorySessionRef.current = null
    setRepositorySession(null)
    resetRepositoryState({ isLoading: false, loadingStage: 'idle' })
  }, [resetRepositoryState])
  
  const updateCodeIndex = useCallback((index: CodeIndex) => {
    const residentIndex = makeContentResident(index)
    codeIndexRef.current = residentIndex
    setCodeIndex(residentIndex)
  }, [])
  
  const loadFileContent = useCallback(async (path: string, session = repositorySessionRef.current): Promise<string | null> => {
    if (findFileNode(files, path)?.type === 'submodule') return null
    const epoch = connectionEpochRef.current
    const controller = connectionAbortRef.current
    const requestIsCurrent = () => session === repositorySessionRef.current && (
      controller !== null && isCurrentConnection(epoch, controller)
    )

    // B4: Check code index first before hitting the network
    const existingFile = codeIndex?.files?.get(path)
    if (typeof existingFile?.content === 'string') return existingFile.content

    // Check contentStore (covers IDB-backed repos)
    const storedContent = await codeIndex.contentStore.get(path)
    if (!requestIsCurrent()) return null
    if (storedContent !== null) return storedContent

    // Lazy repo: file exists in index with empty content — fetch on demand with critical priority
    if (existingFile && codeIndex.contentStore instanceof LazyContentStore) {
      try {
        const fq = codeIndex.contentStore.getFetchQueue()
        const content = await fq.enqueue(path, 'critical')
        if (!requestIsCurrent()) return null
        // Update IndexedFile content in-place for subsequent sync access
        existingFile.content = content
        existingFile.lineCount = content.split('\n').length
        invalidateLinesCache(existingFile)
        codeIndex.contentStore.put(path, content)
        return content
      } catch (err) {
        if (!requestIsCurrent() || (err instanceof DOMException && err.name === 'AbortError')) return null
        console.error('Failed to lazy-load file content:', err)
        return null
      }
    }

    if (!repo || controller === null) return null

    try {
      const content = await fetchFileViaProxy(
        repo.owner,
        repo.name,
        repo.defaultBranch,
        path,
        { signal: controller.signal },
      )
      if (!requestIsCurrent()) return null
      if (existingFile) {
        existingFile.content = content
        existingFile.lineCount = content.split('\n').length
        invalidateLinesCache(existingFile)
        codeIndex.contentStore.put(path, content)
      }
      return content
    } catch (err) {
      if (!requestIsCurrent()) return null
      console.error('Failed to load file content:', err)
      return null
    }
  }, [repo, files, codeIndex, isCurrentConnection])

  const getFileByPath = useCallback((path: string): FileNode | null => {
    return findFileNode(files, path)
  }, [files])

  const pinFile = useCallback((path: string, type: 'file' | 'directory' = 'file') => {
    if (findFileNode(files, path)?.type === 'submodule') return
    setPinnedFiles(prev => {
      if (prev.has(path)) return prev
      if (prev.size >= PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES) {
        console.warn(`Pin limit reached (${PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES}). Cannot pin "${path}".`)
        return prev
      }
      const next = new Map(prev)
      next.set(path, { path, type })
      return next
    })
  }, [files])

  const unpinFile = useCallback((path: string) => {
    setPinnedFiles(prev => {
      if (!prev.has(path)) return prev
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [])

  const clearPins = useCallback(() => {
    setPinnedFiles(new Map())
  }, [])

  // Virtual rename — session-local, never pushed to GitHub (like content replace).
  // Re-keys the file tree, code index (files + meta), content store, modified-content
  // overlay, parsed files and pins. Returns the number of renames applied.
  const renameFiles = useCallback(async (renames: FileRename[]): Promise<number> => {
    if (renames.length === 0) return 0
    const epoch = connectionEpochRef.current
    const controller = connectionAbortRef.current
    if (controller === null || !isCurrentConnection(epoch, controller)) return 0
    const renameMap = new Map(renames.map(r => [r.from, r.to]))
    const basename = (p: string) => p.split('/').pop() || p
    const currentIndex = codeIndexRef.current
    let residentIndex = makeContentResident(currentIndex)
    if (currentIndex.contentStore instanceof IDBContentStore) {
      const hydrated = await hydrateCodeIndexContent(currentIndex)
      if (hydrated.missingPaths.length > 0) {
        throw new Error(`Cannot rename files with missing content: ${hydrated.missingPaths.join(', ')}`)
      }
      residentIndex = hydrated.index
    }
    codeIndexRef.current = residentIndex

    // 1. Rebuild the file tree (handles cross-directory moves).
    setFiles(prev => {
      const flat = flattenTreeLeaves(prev).map(f => {
        const to = f.type === 'file' ? renameMap.get(f.path) : undefined
        return to ? { ...f, path: to, name: basename(to) } : f
      })
      return buildTreeFromFiles(flat)
    })

    // 2. Re-key the code index (files + metadata).
    setCodeIndex(prev => {
      const resident = prev === currentIndex ? residentIndex : makeContentResident(prev)
      const newFiles = new Map(resident.files)
      const newMeta = new Map(resident.meta)
      for (const { from, to } of renames) {
        const f = newFiles.get(from)
        if (f) {
          newFiles.delete(from)
          newFiles.set(to, { ...f, path: to, name: basename(to) })
        }
        const m = newMeta.get(from)
        if (m) {
          newMeta.delete(from)
          newMeta.set(to, m)
        }
      }
      const next = { ...resident, files: newFiles, meta: newMeta }
      codeIndexRef.current = next
      return next
    })

    // 3. Move cached content to the new keys (async for IDB-backed stores).
    //    The content store instance is stable across index updates.
    const store = codeIndexRef.current.contentStore
    await Promise.all(renames.map(async ({ from, to }) => {
      const content = codeIndexRef.current.files.get(from)?.content
        ?? store.getSync(from)
        ?? (await store.get(from))
      if (!isCurrentConnection(epoch, controller)) return
      if (content != null) store.put(to, content)
      store.delete(from)
    }))
    if (!isCurrentConnection(epoch, controller)) return 0

    // 4. Re-key exact-path maps (edits + parsed cache) and pins.
    const rekeyExact = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      for (const { from, to } of renames) {
        if (next.has(from)) {
          next.set(to, next.get(from)!)
          next.delete(from)
        }
      }
      return next
    }
    setModifiedContents(rekeyExact)
    setParsedFiles(rekeyExact)
    setPinnedFiles(prev => {
      if (prev.size === 0) return prev
      const next = new Map<string, PinnedFile>()
      for (const [path, pin] of prev) {
        const to = renameMap.get(path)
        if (to) next.set(to, { ...pin, path: to })
        else next.set(path, pin)
      }
      return next
    })

    return renames.length
  }, [isCurrentConnection])

  const getTabCache = useCallback(<T,>(key: string): T | undefined => {
    return tabCacheRef.current[key] as T | undefined
  }, [])

  const setTabCache = useCallback((key: string, value: unknown) => {
    tabCacheRef.current[key] = value
  }, [])

  const isPinned = useCallback((path: string): boolean => {
    return pinnedFiles.has(path)
  }, [pinnedFiles])

  const getPinnedContents = useCallback(async (): Promise<PinnedContentsResult> => {
    const { MAX_SINGLE_FILE_BYTES, MAX_PINNED_BYTES } = PINNED_CONTEXT_CONFIG
    const resolvedPaths = new Set<string>()
    const skipped: string[] = []
    let content = ''
    let totalBytes = 0
    let fileCount = 0

    // Collect all paths we need content for
    const pathsToFetch: string[] = []
    for (const [, pin] of pinnedFiles) {
      if (pin.type === 'file') {
        if (!resolvedPaths.has(pin.path)) {
          resolvedPaths.add(pin.path)
          pathsToFetch.push(pin.path)
        }
      } else {
        const prefix = pin.path.endsWith('/') ? pin.path : `${pin.path}/`
        for (const [filePath] of codeIndex.files) {
          if (!filePath.startsWith(prefix)) continue
          if (!resolvedPaths.has(filePath)) {
            resolvedPaths.add(filePath)
            pathsToFetch.push(filePath)
          }
        }
      }
    }

    // Batch-fetch all content at once
    const contentMap = await codeIndex.contentStore.getBatch(pathsToFetch)

    // Assemble output in original pin order
    resolvedPaths.clear()
    for (const [, pin] of pinnedFiles) {
      const addFile = (filePath: string) => {
        if (resolvedPaths.has(filePath)) return
        resolvedPaths.add(filePath)

        const fileContent = contentMap.get(filePath)
        if (fileContent === undefined) return

        if (fileContent.length > MAX_SINGLE_FILE_BYTES) {
          skipped.push(filePath)
          return
        }
        if (totalBytes + fileContent.length > MAX_PINNED_BYTES) {
          skipped.push(filePath)
          return
        }

        const ext = filePath.split('.').pop() ?? ''
        content += `### \`${filePath}\`\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`
        totalBytes += fileContent.length
        fileCount++
      }

      if (pin.type === 'file') {
        addFile(pin.path)
      } else {
        const prefix = pin.path.endsWith('/') ? pin.path : `${pin.path}/`
        for (const [filePath] of codeIndex.files) {
          if (filePath.startsWith(prefix)) addFile(filePath)
        }
      }
    }

    return { content, fileCount, totalBytes, skipped }
  }, [pinnedFiles, codeIndex])

  // B5: Compute codebaseAnalysis once when indexing completes.
  // Lazy-tier repos (contentStore is a LazyContentStore, size >= LAZY_CONTENT_THRESHOLD_KB)
  // have no in-memory or IDB content yet — every file's `content` is ''. Running
  // analyzeCodebase here would call getFileContent() for every file, which falls
  // through to LazyContentStore.get() and enqueues a real network fetch for the
  // entire repo the instant indexing reports isComplete, defeating the lazy tier.
  // Skip analysis entirely for this tier (mirrors the `instanceof LazyContentStore`
  // checks already used above for contentAvailability/contentLoadingStats/loadFileContent).
  useEffect(() => {
    if (
      codeIndex.totalFiles === 0 ||
      !indexingProgress.isComplete ||
      codeIndex.contentStore instanceof LazyContentStore
    ) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setCodebaseAnalysis(null)
      })
      return () => { cancelled = true }
    }
    const epoch = connectionEpochRef.current
    const controller = connectionAbortRef.current
    let cancelled = false
    const timer = setTimeout(() => {
      void analyzeCodebase(codeIndex).then(analysis => {
        if (
          !cancelled
          && controller !== null
          && isCurrentConnection(epoch, controller)
        ) {
          setCodebaseAnalysis(analysis)
        }
      }).catch(() => {
        if (
          !cancelled
          && controller !== null
          && isCurrentConnection(epoch, controller)
        ) {
          setCodebaseAnalysis(null)
        }
      })
    }, 50)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [codeIndex, indexingProgress.isComplete, isCurrentConnection])

  const dataValue = useMemo<RepositoryDataContextType>(() => ({
    repo, files, parsedFiles, codeIndex, codebaseAnalysis, failedFiles, isCacheHit, repositorySession, coverage,
  }), [repo, files, parsedFiles, codeIndex, codebaseAnalysis, failedFiles, isCacheHit, repositorySession, coverage])

  const actionsValue = useMemo<RepositoryActionsContextType>(() => ({
    connectRepository, disconnectRepository, loadFileContent, getFileByPath,
    updateCodeIndex, pinFile, unpinFile, clearPins, renameFiles, getPinnedContents,
    getTabCache, setTabCache, setSearchState, setModifiedContents, getFileContent,
    getRepositorySession, isRepositorySessionCurrent,
  }), [
    connectRepository, disconnectRepository, loadFileContent, getFileByPath,
    updateCodeIndex, pinFile, unpinFile, clearPins, renameFiles, getPinnedContents,
    getTabCache, setTabCache, setSearchState, setModifiedContents, getFileContent,
    getRepositorySession, isRepositorySessionCurrent,
  ])

  const progressValue = useMemo<RepositoryProgressContextType>(() => ({
    isLoading, error, indexingProgress, searchState, modifiedContents,
    loadingStage, contentAvailability, contentLoadingStats, pinnedFiles, isPinned,
  }), [
    isLoading, error, indexingProgress, searchState, modifiedContents,
    loadingStage, contentAvailability, contentLoadingStats, pinnedFiles, isPinned,
  ])

  return (
    <RepositoryDataCtx.Provider value={dataValue}>
      <RepositoryActionsCtx.Provider value={actionsValue}>
        <RepositoryProgressCtx.Provider value={progressValue}>
          {children}
        </RepositoryProgressCtx.Provider>
      </RepositoryActionsCtx.Provider>
    </RepositoryDataCtx.Provider>
  )
}

export function useRepositoryData() {
  const context = useContext(RepositoryDataCtx)
  if (context === null) throw new Error('useRepositoryData must be used within a RepositoryProvider')
  return context
}

export function useRepositoryActions() {
  const context = useContext(RepositoryActionsCtx)
  if (context === null) throw new Error('useRepositoryActions must be used within a RepositoryProvider')
  return context
}

export function useRepositoryProgress() {
  const context = useContext(RepositoryProgressCtx)
  if (context === null) throw new Error('useRepositoryProgress must be used within a RepositoryProvider')
  return context
}

// Backward-compatible convenience hook — combines all 3 sub-contexts
export function useRepository() {
  const data = useRepositoryData()
  const actions = useRepositoryActions()
  const progress = useRepositoryProgress()
  return { ...data, ...actions, ...progress }
}
