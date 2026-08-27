"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile, RepositoryCoverage } from "@/types/repository"
import type { PinnedFile, PinnedContentsResult } from "@/types/types"
import { PINNED_CONTEXT_CONFIG } from "@/config/constants"
import { parseGitHubUrl } from "@/lib/github/parser"
import { buildFileTree } from "@/lib/github/fetcher"
import { fetchRepoViaProxy, fetchTreeViaProxy, fetchFileViaProxy } from "@/lib/github/client"
import type { CodeIndex } from "@/lib/code/code-index"
import { createEmptyIndex, resolveFileContentBatches, invalidateLinesCache, recordResolvedFileLineCount } from '@/lib/code/code-index'
import { buildTreeFromFiles, type FileRename } from '@/lib/code/rename-files'
import { IDBContentStore, InMemoryContentStore, LazyContentStore } from '@/lib/code/content-store'
import type { FetchQueue } from '@/lib/code/fetch-queue'
import { withHydratedCachedRepo } from "@/lib/cache/repo-cache"
import { toast } from 'sonner'
import { analyzeCodebase, type FullAnalysis } from "@/lib/code/import-parser"
import { startIndexing as runIndexingPipeline } from "@/lib/github/indexing-pipeline"
import { useGitHubToken } from "@/providers/github-token-provider"
import { PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, isPrivateRepositoryRevocation } from '@/lib/auth/credential-events'
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
  const pendingConnectionRef = useRef<AbortController | null>(null)
  const repositoryPrivacyRef = useRef<boolean | null>(null)
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
    pendingConnectionRef.current = null
    repositoryPrivacyRef.current = null
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
    pendingConnectionRef.current = controller
    repositoryPrivacyRef.current = null
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
      repositoryPrivacyRef.current = repoData.isPrivate
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
    } finally {
      if (pendingConnectionRef.current === controller) pendingConnectionRef.current = null
    }
  }, [githubToken, isCurrentConnection, resetRepositoryState, startIndexing])

  const disconnectRepository = useCallback(() => {
    connectionEpochRef.current += 1
    connectionAbortRef.current?.abort()
    connectionAbortRef.current = null
    pendingConnectionRef.current = null
    repositoryPrivacyRef.current = null
    repositorySessionRef.current = null
    setRepositorySession(null)
    resetRepositoryState({ isLoading: false, loadingStage: 'idle' })
  }, [resetRepositoryState])

  useEffect(() => {
    const handleCredentialRevocation = () => {
      if (pendingConnectionRef.current || repositoryPrivacyRef.current === true) {
        disconnectRepository()
      }
    }
    const handleCrossTabRevocation = (event: StorageEvent) => {
      if (isPrivateRepositoryRevocation(event)) handleCredentialRevocation()
    }
    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleCredentialRevocation)
    window.addEventListener('storage', handleCrossTabRevocation)
    return () => {
      window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleCredentialRevocation)
      window.removeEventListener('storage', handleCrossTabRevocation)
    }
  }, [disconnectRepository])
  
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

    // Lazy repo: fetch on demand with critical priority before the generic store path.
    if (existingFile && codeIndex.contentStore instanceof LazyContentStore) {
      try {
        const fq = codeIndex.contentStore.getFetchQueue()
        const content = await fq.enqueue(path, 'critical')
        if (!requestIsCurrent()) return null
        // Update IndexedFile content in-place for subsequent sync access
        existingFile.content = content
        recordResolvedFileLineCount(codeIndex, path, content)
        invalidateLinesCache(existingFile)
        codeIndex.contentStore.put(path, content)
        return content
      } catch (err) {
        if (!requestIsCurrent() || (err instanceof DOMException && err.name === 'AbortError')) return null
        console.error('Failed to lazy-load file content:', err)
        return null
      }
    }

    // Check contentStore (covers IDB-backed repos).
    const storedContent = await codeIndex.contentStore.get(path)
    if (!requestIsCurrent()) return null
    if (storedContent !== null) return storedContent

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
        recordResolvedFileLineCount(codeIndex, path, content)
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
    const sourcePaths = renames.map(rename => rename.from)
    const resolvedContent = new Map<string, string>()
    const missingPaths: string[] = []

    try {
      if (currentIndex.contentStore instanceof LazyContentStore) {
        for (const path of sourcePaths) {
          const content = await currentIndex.contentStore.get(path)
          if (!isCurrentConnection(epoch, controller)) return 0
          if (content === null) missingPaths.push(path)
          else resolvedContent.set(path, content)
        }
      } else {
        for await (const batch of resolveFileContentBatches(currentIndex, sourcePaths, {
          batchSize: 50,
          signal: controller.signal,
        })) {
          if (!isCurrentConnection(epoch, controller)) return 0
          for (const [path, content] of batch.contents) resolvedContent.set(path, content)
          missingPaths.push(...batch.missingPaths)
        }
      }
    } catch (error) {
      if (!isCurrentConnection(epoch, controller)) return 0
      throw error
    }

    if (!isCurrentConnection(epoch, controller) || codeIndexRef.current !== currentIndex) return 0
    if (missingPaths.length > 0) {
      throw new Error(`Cannot rename files with missing content: ${missingPaths.join(', ')}`)
    }

    const snapshots = renames.map(({ from, to }) => ({
      from,
      to,
      file: currentIndex.files.get(from),
      meta: currentIndex.meta.get(from),
      content: resolvedContent.get(from),
    }))
    const nextFiles = new Map(currentIndex.files)
    const nextMeta = new Map(currentIndex.meta)
    for (const { from } of snapshots) {
      nextFiles.delete(from)
      nextMeta.delete(from)
    }
    for (const { to, file, meta, content } of snapshots) {
      if (file) nextFiles.set(to, { ...file, path: to, name: basename(to), content })
      if (meta) nextMeta.set(to, { ...meta, path: to, name: basename(to) })
    }

    // Shared IDB cache entries are immutable. The renamed files carry a small
    // session-local source overlay while all untouched files remain IDB-backed.
    const store = currentIndex.contentStore
    if (store instanceof IDBContentStore) {
      store.applySessionOverlay({
        deletedPaths: snapshots.map(({ from }) => from),
        entries: snapshots.flatMap(({ to, content }) => (
          content === undefined ? [] : [{ path: to, content }]
        )),
      })
    } else {
      for (const { from } of snapshots) store.delete(from)
      for (const { to, content } of snapshots) {
        if (content !== undefined) store.put(to, content)
      }
      await store.flush()
      if (!isCurrentConnection(epoch, controller) || codeIndexRef.current !== currentIndex) return 0
    }

    const nextIndex = { ...currentIndex, files: nextFiles, meta: nextMeta }
    codeIndexRef.current = nextIndex

    // 1. Rebuild the file tree (handles cross-directory moves).
    setFiles(prev => {
      const flat = flattenTreeLeaves(prev).map(f => {
        const to = f.type === 'file' ? renameMap.get(f.path) : undefined
        return to ? { ...f, path: to, name: basename(to) } : f
      })
      return buildTreeFromFiles(flat)
    })

    // 2. Publish the already-built index only after every async boundary above.
    setCodeIndex(nextIndex)

    // 3. Re-key exact-path maps (edits + parsed cache) and pins.
    const rekeyExact = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      const entries = renames
        .filter(({ from }) => prev.has(from))
        .map(({ from, to }) => ({ from, to, value: prev.get(from)! }))
      for (const { from } of entries) next.delete(from)
      for (const { to, value } of entries) {
        next.set(to, value)
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
    const requestedIndex = codeIndex
    const orderedPaths = new Map<string, boolean>()
    const skipped: string[] = []
    let content = ''
    let outputBytes = 0
    let fileCount = 0
    const encoder = new TextEncoder()

    for (const [, pin] of pinnedFiles) {
      if (pin.type === 'file') {
        orderedPaths.set(pin.path, true)
      } else {
        const prefix = pin.path.endsWith('/') ? pin.path : `${pin.path}/`
        for (const [filePath] of codeIndex.files) {
          if (!filePath.startsWith(prefix)) continue
          if (!orderedPaths.has(filePath)) orderedPaths.set(filePath, false)
        }
      }
    }

    const paths = [...orderedPaths.keys()]
    let exhaustedAt = -1
    for (let offset = 0; offset < paths.length; offset += 20) {
      const batchPaths = paths.slice(offset, offset + 20)
      const contentMap = await requestedIndex.contentStore.getBatch(batchPaths)
      if (codeIndexRef.current !== requestedIndex) {
        throw new DOMException('Repository changed while resolving pinned content', 'AbortError')
      }

      for (let batchIndex = 0; batchIndex < batchPaths.length; batchIndex++) {
        const filePath = batchPaths[batchIndex]
        let fileContent = contentMap.get(filePath)
        if (
          fileContent === undefined
          && orderedPaths.get(filePath)
          && requestedIndex.contentStore instanceof LazyContentStore
        ) {
          fileContent = await requestedIndex.contentStore.get(filePath) ?? undefined
          if (codeIndexRef.current !== requestedIndex) {
            throw new DOMException('Repository changed while resolving pinned content', 'AbortError')
          }
        }

        if (fileContent === undefined) {
          skipped.push(filePath)
          continue
        }
        const fileBytes = encoder.encode(fileContent).byteLength
        if (fileBytes > MAX_SINGLE_FILE_BYTES) {
          skipped.push(filePath)
          continue
        }

        const ext = filePath.split('.').pop() ?? ''
        const section = `### \`${filePath}\`\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`
        const sectionBytes = encoder.encode(section).byteLength
        if (outputBytes + sectionBytes > MAX_PINNED_BYTES) {
          exhaustedAt = offset + batchIndex
          break
        }

        content += section
        outputBytes += sectionBytes
        fileCount++
      }
      if (exhaustedAt >= 0) break
    }

    if (exhaustedAt >= 0) {
      for (let index = exhaustedAt; index < paths.length; index++) {
        if (!skipped.includes(paths[index])) skipped.push(paths[index])
      }
    }

    return { content, fileCount, totalBytes: outputBytes, skipped }
  }, [pinnedFiles, codeIndex])

  // B5: Compute codebaseAnalysis once when indexing completes.
  // Lazy-tier repos (contentStore is a LazyContentStore, size >= LAZY_CONTENT_THRESHOLD_KB)
  // have no in-memory or IDB content yet — every file's `content` is absent. Running
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
