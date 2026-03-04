"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile, RepositoryContext } from "@/types/repository"
import { parseGitHubUrl } from "@/lib/github/parser"
import { fetchRepoMetadata, fetchRepoTree, buildFileTree, fetchFileContent } from "@/lib/github/fetcher"
import type { CodeIndex } from "@/lib/code/code-index"
import { createEmptyIndex, batchIndexFiles } from '@/lib/code/code-index'
import { getCachedRepo } from "@/lib/cache/repo-cache"
import { analyzeCodebase, type FullAnalysis } from "@/lib/code/import-parser"
import { startIndexing as runIndexingPipeline } from "@/lib/github/indexing-pipeline"

interface IndexingProgress {
  current: number
  total: number
  isComplete: boolean
}

export type LoadingStage =
  | 'idle'
  | 'metadata'
  | 'tree'
  | 'downloading'
  | 'extracting'
  | 'indexing'
  | 'ready'
  | 'cached'

export interface SearchState {
  searchQuery: string
  debouncedSearchQuery: string
  replaceQuery: string
  showReplace: boolean
  fileFilter: string
  searchOptions: {
    caseSensitive: boolean
    regex: boolean
    wholeWord: boolean
  }
}

const defaultSearchState: SearchState = {
  searchQuery: '',
  debouncedSearchQuery: '',
  replaceQuery: '',
  showReplace: false,
  fileFilter: '',
  searchOptions: {
    caseSensitive: false,
    regex: false,
    wholeWord: false,
  },
}

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
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    current: 0,
    total: 0,
    isComplete: false,
  })
  const indexingAbortRef = useRef<AbortController | null>(null)
  const [searchState, setSearchState] = useState<SearchState>(defaultSearchState)
  const [modifiedContents, setModifiedContents] = useState<Map<string, string>>(new Map())
  const [codebaseAnalysis, setCodebaseAnalysis] = useState<FullAnalysis | null>(null)
  const [failedFiles, setFailedFiles] = useState<Array<{ path: string; error: string }>>([])
  const [isCacheHit, setIsCacheHit] = useState(false)
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle')

  // Helper: get file content from modifiedContents first, then codeIndex
  const getFileContent = useCallback((path: string): string | null => {
    if (modifiedContents.has(path)) return modifiedContents.get(path)!
    const indexed = codeIndex.files.get(path)
    return indexed ? indexed.content : null
  }, [modifiedContents, codeIndex])

  // Start indexing files in background (delegated to indexing-pipeline)
  const startIndexing = useCallback((
    repoData: GitHubRepo,
    fileTree: FileNode[],
    treeSha: string,
    signal: AbortSignal,
  ) => {
    return runIndexingPipeline(repoData, fileTree, treeSha, signal, {
      setIndexingProgress,
      setLoadingStage,
      setCodeIndex,
      setFailedFiles,
    })
  }, [])

  const connectRepository = useCallback(async (url: string): Promise<boolean> => {
    // Abort any existing indexing
    if (indexingAbortRef.current) {
      indexingAbortRef.current.abort()
    }
    
    setIsLoading(true)
    setError(null)
    setCodeIndex(createEmptyIndex())
    setIndexingProgress({ current: 0, total: 0, isComplete: false })
    setFailedFiles([])
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
      const repoData = await fetchRepoMetadata(owner, repoName)
      setRepo(repoData)

      // Fetch file tree
      setLoadingStage('tree')
      const tree = await fetchRepoTree(owner, repoName, repoData.defaultBranch)
      const fileTree = buildFileTree(tree)
      setFiles(fileTree)

      setIsLoading(false)

      // B2: Check IndexedDB cache before indexing
      const cached = await getCachedRepo(owner, repoName)
      if (cached && cached.sha === tree.sha) {
        // Cache hit — hydrate code index from cached data
        const index = batchIndexFiles(createEmptyIndex(), cached.files)
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
      startIndexing(repoData, fileTree, tree.sha, abortController.signal)
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect repository'
      setError(message)
      setIsLoading(false)
      setLoadingStage('idle')
      return false
    }
  }, [startIndexing])

  const disconnectRepository = useCallback(() => {
    // Abort any ongoing indexing
    if (indexingAbortRef.current) {
      indexingAbortRef.current.abort()
      indexingAbortRef.current = null
    }
    
    setRepo(null)
    setFiles([])
    setParsedFiles(new Map())
    setCodeIndex(createEmptyIndex())
    setIndexingProgress({ current: 0, total: 0, isComplete: false })
    setError(null)
    setSearchState(defaultSearchState)
    setModifiedContents(new Map())
    setCodebaseAnalysis(null)
    setFailedFiles([])
    setIsCacheHit(false)
    setLoadingStage('idle')
  }, [])
  
  const updateCodeIndex = useCallback((index: CodeIndex) => {
    setCodeIndex(index)
  }, [])
  
  const loadFileContent = useCallback(async (path: string): Promise<string | null> => {
    // B4: Check code index first before hitting the network
    const existingFile = codeIndex?.files?.get(path)
    if (existingFile?.content) return existingFile.content

    if (!repo) return null

    try {
      const content = await fetchFileContent(repo.owner, repo.name, repo.defaultBranch, path)
      return content
    } catch (err) {
      console.error('Failed to load file content:', err)
      return null
    }
  }, [repo, codeIndex])

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

  return (
    <RepositoryContext.Provider
      value={{
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
      }}
    >
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
