"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile } from "@/types/repository"
import type { PinnedFile, PinnedContentsResult } from "@/types/types"
import { PINNED_CONTEXT_CONFIG, IDB_CONTENT_STORE_THRESHOLD_KB } from "@/config/constants"
import { parseGitHubUrl } from "@/lib/github/parser"
import { buildFileTree } from "@/lib/github/fetcher"
import { fetchRepoViaProxy, fetchTreeViaProxy, fetchFileViaProxy } from "@/lib/github/client"
import type { CodeIndex } from "@/lib/code/code-index"
import { createEmptyIndex, createEmptyIndexWithStore, batchIndexFiles, invalidateLinesCache } from '@/lib/code/code-index'
import { IDBContentStore, LazyContentStore } from '@/lib/code/content-store'
import type { FetchQueue } from '@/lib/code/fetch-queue'
import { getCachedRepo } from "@/lib/cache/repo-cache"
import { analyzeCodebase, type FullAnalysis } from "@/lib/code/import-parser"
import { startIndexing as runIndexingPipeline } from "@/lib/github/indexing-pipeline"
import { useGitHubToken } from "@/providers/github-token-provider"
import {
  DEFAULT_SEARCH_STATE,
  DEFAULT_INDEXING_PROGRESS,
  DEFAULT_CONTENT_LOADING_STATS,
  type IndexingProgress,
  type SearchState,
  type LoadingStage,
  type ContentAvailability,
  type ContentLoadingStats,
} from '@/lib/repository'

// Re-export for backward compatibility
export type { LoadingStage, SearchState, ContentAvailability, ContentLoadingStats } from '@/lib/repository'

// Data context — rarely changes after repo load/indexing
export interface RepositoryDataContextType {
  repo: GitHubRepo | null
  files: FileNode[]
  parsedFiles: Map<string, ParsedFile>
  codeIndex: CodeIndex
  codebaseAnalysis: FullAnalysis | null
  failedFiles: Array<{ path: string; error: string }>
  isCacheHit: boolean
}

// Actions context — stable callbacks (never change identity)
export interface RepositoryActionsContextType {
  connectRepository: (url: string) => Promise<boolean>
  disconnectRepository: () => void
  loadFileContent: (path: string) => Promise<string | null>
  getFileByPath: (path: string) => FileNode | null
  updateCodeIndex: (index: CodeIndex) => void
  pinFile: (path: string, type?: 'file' | 'directory') => void
  unpinFile: (path: string) => void
  clearPins: () => void
  getPinnedContents: () => Promise<PinnedContentsResult>
  getTabCache: <T>(key: string) => T | undefined
  setTabCache: (key: string, value: unknown) => void
  setSearchState: Dispatch<SetStateAction<SearchState>>
  setModifiedContents: Dispatch<SetStateAction<Map<string, string>>>
  getFileContent: (path: string) => Promise<string | null>
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

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<GitHubRepo | null>(null)
  const [files, setFiles] = useState<FileNode[]>([])
  const [parsedFiles, setParsedFiles] = useState<Map<string, ParsedFile>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeIndex, setCodeIndex] = useState<CodeIndex>(createEmptyIndex())
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>(DEFAULT_INDEXING_PROGRESS)
  const indexingAbortRef = useRef<AbortController | null>(null)
  const [searchState, setSearchState] = useState<SearchState>(DEFAULT_SEARCH_STATE)
  const [modifiedContents, setModifiedContents] = useState<Map<string, string>>(new Map())
  const [codebaseAnalysis, setCodebaseAnalysis] = useState<FullAnalysis | null>(null)
  const [failedFiles, setFailedFiles] = useState<Array<{ path: string; error: string }>>([])
  const [isCacheHit, setIsCacheHit] = useState(false)
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle')
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, PinnedFile>>(new Map())
  const tabCacheRef = useRef<Record<string, unknown>>({})
  const [contentAvailability, setContentAvailability] = useState<ContentAvailability>('full')
  const [contentLoadingStats, setContentLoadingStats] = useState<ContentLoadingStats>(DEFAULT_CONTENT_LOADING_STATS)
  const fetchQueueRef = useRef<FetchQueue | null>(null)

  const { token: githubToken } = useGitHubToken()

  // Helper: get file content from modifiedContents first, then codeIndex, then contentStore
  const getFileContent = useCallback(async (path: string): Promise<string | null> => {
    if (modifiedContents.has(path)) return modifiedContents.get(path)!
    const indexed = codeIndex.files.get(path)
    if (indexed?.content) return indexed.content
    return codeIndex.contentStore.get(path)
  }, [modifiedContents, codeIndex])

  // Detect lazy content store and wire up progress tracking
  useEffect(() => {
    if (codeIndex.contentStore instanceof LazyContentStore) {
      const fq = codeIndex.contentStore.getFetchQueue()
      fetchQueueRef.current = fq
      setContentAvailability('metadata-only')
    } else {
      fetchQueueRef.current = null
    }
  }, [codeIndex])

  // Update content loading stats when indexing progress changes for lazy repos
  useEffect(() => {
    if (contentAvailability !== 'full' && codeIndex.contentStore instanceof LazyContentStore) {
      const status = codeIndex.contentStore.getContentStatus()
      setContentLoadingStats({
        completed: status.loaded,
        pending: status.pending,
        total: status.total,
        failed: fetchQueueRef.current?.stats.failed ?? 0,
      })
    }
  }, [indexingProgress, contentAvailability, codeIndex])

  // Start indexing files in background (delegated to indexing-pipeline)
  const startIndexing = useCallback((
    repoData: GitHubRepo,
    fileTree: FileNode[],
    treeSha: string,
    signal: AbortSignal,
    options: { token?: string } = {},
  ) => {
    return runIndexingPipeline(repoData, fileTree, treeSha, signal, {
      setIndexingProgress,
      setLoadingStage,
      setCodeIndex,
      setFailedFiles,
    }, options)
  }, [])

  const connectRepository = useCallback(async (url: string): Promise<boolean> => {
    // Abort any existing indexing
    if (indexingAbortRef.current) {
      indexingAbortRef.current.abort()
    }
    // Clean up existing FetchQueue reference
    fetchQueueRef.current = null
    
    setIsLoading(true)
    setError(null)
    setCodeIndex(createEmptyIndex())
    setContentAvailability('full')
    setContentLoadingStats(DEFAULT_CONTENT_LOADING_STATS)
    setIndexingProgress(DEFAULT_INDEXING_PROGRESS)
    setFailedFiles([])
    tabCacheRef.current = {}
    setIsCacheHit(false)
    setCodebaseAnalysis(null)
    setLoadingStage('metadata')

    try {
      // Parse the URL
      const parsed = parseGitHubUrl(url)
      if (!parsed) {
        throw new Error('Invalid GitHub URL. Please enter a valid repository URL.')
      }

      const { owner, repo: repoName } = parsed

      // Fetch repository metadata
      const repoData = await fetchRepoViaProxy(owner, repoName)
      setRepo(repoData)

      // Fetch file tree
      setLoadingStage('tree')
      const tree = await fetchTreeViaProxy(owner, repoName, repoData.defaultBranch)
      const fileTree = buildFileTree(tree)
      setFiles(fileTree)

      setIsLoading(false)

      // B2: Check IndexedDB cache before indexing
      const cached = await getCachedRepo(owner, repoName)
      if (cached && cached.sha === tree.sha) {
        // Cache hit — hydrate code index from cached data
        const useIDB = repoData.size != null && repoData.size >= IDB_CONTENT_STORE_THRESHOLD_KB
        const baseIndex = useIDB
          ? createEmptyIndexWithStore(new IDBContentStore(`${owner}/${repoName}`))
          : createEmptyIndex()
        const index = batchIndexFiles(baseIndex, cached.files)
        setCodeIndex(index)
        setIndexingProgress({
          current: cached.files.length,
          total: cached.files.length,
          isComplete: true,
        })
        setIsCacheHit(true)
        setLoadingStage('cached')
        return true
      }
      
      // Start indexing immediately in background
      const abortController = new AbortController()
      indexingAbortRef.current = abortController
      startIndexing(repoData, fileTree, tree.sha, abortController.signal, { token: githubToken ?? undefined })
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect repository'
      setError(message)
      setIsLoading(false)
      setLoadingStage('idle')
      return false
    }
  }, [startIndexing, githubToken])

  const disconnectRepository = useCallback(() => {
    // Abort any ongoing indexing
    if (indexingAbortRef.current) {
      indexingAbortRef.current.abort()
      indexingAbortRef.current = null
    }
    // Clean up FetchQueue for lazy repos
    fetchQueueRef.current = null
    
    setRepo(null)
    setFiles([])
    setParsedFiles(new Map())
    setCodeIndex(createEmptyIndex())
    setIndexingProgress(DEFAULT_INDEXING_PROGRESS)
    setError(null)
    setSearchState(DEFAULT_SEARCH_STATE)
    setModifiedContents(new Map())
    setCodebaseAnalysis(null)
    setFailedFiles([])
    setIsCacheHit(false)
    setLoadingStage('idle')
    setPinnedFiles(new Map())
    setContentAvailability('full')
    setContentLoadingStats(DEFAULT_CONTENT_LOADING_STATS)
    tabCacheRef.current = {}
  }, [])
  
  const updateCodeIndex = useCallback((index: CodeIndex) => {
    setCodeIndex(index)
  }, [])
  
  const loadFileContent = useCallback(async (path: string): Promise<string | null> => {
    // B4: Check code index first before hitting the network
    const existingFile = codeIndex?.files?.get(path)
    if (existingFile?.content) return existingFile.content

    // Check contentStore (covers IDB-backed repos)
    const storedContent = await codeIndex.contentStore.get(path)
    if (storedContent) return storedContent

    // Lazy repo: file exists in index with empty content — fetch on demand with critical priority
    if (existingFile && contentAvailability !== 'full' && codeIndex.contentStore instanceof LazyContentStore) {
      try {
        const fq = codeIndex.contentStore.getFetchQueue()
        const content = await fq.enqueue(path, 'critical')
        // Update IndexedFile content in-place for subsequent sync access
        existingFile.content = content
        existingFile.lineCount = content.split('\n').length
        invalidateLinesCache(existingFile)
        codeIndex.contentStore.put(path, content)
        return content
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null
        console.error('Failed to lazy-load file content:', err)
        return null
      }
    }

    if (!repo) return null

    try {
      const content = await fetchFileViaProxy(repo.owner, repo.name, repo.defaultBranch, path)
      return content
    } catch (err) {
      console.error('Failed to load file content:', err)
      return null
    }
  }, [repo, codeIndex, contentAvailability])

  const getFileByPath = useCallback((path: string): FileNode | null => {
    function findNode(nodes: FileNode[], targetPath: string): FileNode | null {
      for (const node of nodes) {
        if (node.path === targetPath) return node
        if (node.children) {
          const found = findNode(node.children, targetPath)
          if (found) return found
        }
      }
      return null
    }
    return findNode(files, path)
  }, [files])

  const pinFile = useCallback((path: string, type: 'file' | 'directory' = 'file') => {
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
  }, [])

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
        if (!fileContent) return

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

  // B5: Compute codebaseAnalysis once when indexing completes
  useEffect(() => {
    if (codeIndex.totalFiles === 0 || !indexingProgress.isComplete) {
      setCodebaseAnalysis(null)
      return
    }
    const timer = setTimeout(() => {
      analyzeCodebase(codeIndex).then(setCodebaseAnalysis)
    }, 50)
    return () => clearTimeout(timer)
  }, [codeIndex, indexingProgress.isComplete])

  const dataValue = useMemo<RepositoryDataContextType>(() => ({
    repo, files, parsedFiles, codeIndex, codebaseAnalysis, failedFiles, isCacheHit,
  }), [repo, files, parsedFiles, codeIndex, codebaseAnalysis, failedFiles, isCacheHit])

  const actionsValue = useMemo<RepositoryActionsContextType>(() => ({
    connectRepository, disconnectRepository, loadFileContent, getFileByPath,
    updateCodeIndex, pinFile, unpinFile, clearPins, getPinnedContents,
    getTabCache, setTabCache, setSearchState, setModifiedContents, getFileContent,
  }), [
    connectRepository, disconnectRepository, loadFileContent, getFileByPath,
    updateCodeIndex, pinFile, unpinFile, clearPins, getPinnedContents,
    getTabCache, setTabCache, setSearchState, setModifiedContents, getFileContent,
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
