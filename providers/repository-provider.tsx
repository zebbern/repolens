"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile, RepositoryContext } from "@/types/repository"
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

interface RepositoryContextType extends RepositoryContext {
  connectRepository: (url: string) => Promise<boolean>
  disconnectRepository: () => void
  loadFileContent: (path: string) => Promise<string | null>
  getFileByPath: (path: string) => FileNode | null
  codeIndex: CodeIndex
  updateCodeIndex: (index: CodeIndex) => void
  indexingProgress: IndexingProgress
  searchState: SearchState
  setSearchState: Dispatch<SetStateAction<SearchState>>
  /** Map of file path -> modified content (replacements etc.) */
  modifiedContents: Map<string, string>
  setModifiedContents: Dispatch<SetStateAction<Map<string, string>>>
  /** Read file content: modifiedContents first, then codeIndex, then null */
  getFileContent: (path: string) => string | null
  /** Codebase analysis computed once after indexing completes (B5). */
  codebaseAnalysis: FullAnalysis | null
  /** Files that failed to fetch during indexing (B6). */
  failedFiles: Array<{ path: string; error: string }>
  /** Whether the code index was hydrated from IndexedDB cache (B2). */
  isCacheHit: boolean
  /** Current loading stage for multi-step progress UI. */
  loadingStage: LoadingStage
  /** Map of pinned file/directory paths for chat context. */
  pinnedFiles: Map<string, PinnedFile>
  /** Pin a file or directory to the chat context. */
  pinFile: (path: string, type?: 'file' | 'directory') => void
  /** Unpin a file or directory from the chat context. */
  unpinFile: (path: string) => void
  /** Clear all pinned files. */
  clearPins: () => void
  /** Check if a path is currently pinned. */
  isPinned: (path: string) => boolean
  /** Assemble pinned file contents for system prompt injection. */
  getPinnedContents: () => PinnedContentsResult
  /** Get cached tab data by key. Returns undefined if no cache for that key. */
  getTabCache: <T>(key: string) => T | undefined
  /** Store tab data in cache by key. */
  setTabCache: (key: string, value: unknown) => void
  /** Whether file content is fully available or metadata-only (lazy repos). */
  contentAvailability: ContentAvailability
  /** On-demand content loading progress for lazy repos. */
  contentLoadingStats: ContentLoadingStats
}

const RepositoryContextDefault: RepositoryContext = {
  repo: null,
  files: [],
  parsedFiles: new Map(),
  isLoading: false,
  error: null,
}

const RepositoryContext = createContext<RepositoryContextType | null>(null)

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

  // Helper: get file content from modifiedContents first, then codeIndex
  const getFileContent = useCallback((path: string): string | null => {
    if (modifiedContents.has(path)) return modifiedContents.get(path)!
    const indexed = codeIndex.files.get(path)
    return indexed ? indexed.content : null
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
      setContentLoadingStats({
        ...codeIndex.contentStore.getContentStatus(),
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

  const getPinnedContents = useCallback((): PinnedContentsResult => {
    const { MAX_SINGLE_FILE_BYTES, MAX_PINNED_BYTES } = PINNED_CONTEXT_CONFIG
    const resolvedPaths = new Set<string>()
    const skipped: string[] = []
    let content = ''
    let totalBytes = 0
    let fileCount = 0

    for (const [, pin] of pinnedFiles) {
      if (pin.type === 'file') {
        if (resolvedPaths.has(pin.path)) continue
        resolvedPaths.add(pin.path)

        const file = codeIndex.files.get(pin.path)
        if (!file || !file.content) continue

        if (file.content.length > MAX_SINGLE_FILE_BYTES) {
          skipped.push(pin.path)
          continue
        }
        if (totalBytes + file.content.length > MAX_PINNED_BYTES) {
          skipped.push(pin.path)
          continue
        }

        const ext = pin.path.split('.').pop() ?? ''
        content += `### \`${pin.path}\`\n\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`
        totalBytes += file.content.length
        fileCount++
      } else {
        // Directory: expand all files with matching prefix
        const prefix = pin.path.endsWith('/') ? pin.path : `${pin.path}/`
        for (const [filePath, file] of codeIndex.files) {
          if (!filePath.startsWith(prefix)) continue
          if (resolvedPaths.has(filePath)) continue
          resolvedPaths.add(filePath)

          if (!file.content) continue

          if (file.content.length > MAX_SINGLE_FILE_BYTES) {
            skipped.push(filePath)
            continue
          }
          if (totalBytes + file.content.length > MAX_PINNED_BYTES) {
            skipped.push(filePath)
            continue
          }

          const ext = filePath.split('.').pop() ?? ''
          content += `### \`${filePath}\`\n\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`
          totalBytes += file.content.length
          fileCount++
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
      setCodebaseAnalysis(analyzeCodebase(codeIndex))
    }, 50)
    return () => clearTimeout(timer)
  }, [codeIndex, indexingProgress.isComplete])

  const contextValue = useMemo<RepositoryContextType>(() => ({
    repo,
    files,
    parsedFiles,
    isLoading,
    error,
    connectRepository,
    disconnectRepository,
    loadFileContent,
    getFileByPath,
    codeIndex,
    updateCodeIndex,
    indexingProgress,
    searchState,
    setSearchState,
    modifiedContents,
    setModifiedContents,
    getFileContent,
    codebaseAnalysis,
    failedFiles,
    isCacheHit,
    loadingStage,
    pinnedFiles,
    pinFile,
    unpinFile,
    clearPins,
    isPinned,
    getPinnedContents,
    getTabCache,
    setTabCache,
    contentAvailability,
    contentLoadingStats,
  }), [
    repo, files, parsedFiles, isLoading, error,
    connectRepository, disconnectRepository, loadFileContent, getFileByPath,
    codeIndex, updateCodeIndex, indexingProgress,
    searchState, setSearchState,
    modifiedContents, setModifiedContents, getFileContent,
    codebaseAnalysis, failedFiles, isCacheHit, loadingStage,
    pinnedFiles, pinFile, unpinFile, clearPins, isPinned, getPinnedContents,
    getTabCache, setTabCache,
    contentAvailability, contentLoadingStats,
  ])

  return (
    <RepositoryContext.Provider value={contextValue}>
      {children}
    </RepositoryContext.Provider>
  )
}

export function useRepository() {
  const context = useContext(RepositoryContext)
  if (context === null) {
    throw new Error('useRepository must be used within a RepositoryProvider')
  }
  return context
}
