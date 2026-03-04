"use client"

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode, type Dispatch, type SetStateAction } from "react"
import type { GitHubRepo, FileNode, ParsedFile, RepositoryContext } from "@/types/repository"
import { parseGitHubUrl } from "@/lib/github/parser"
import { fetchRepoMetadata, fetchRepoTree, buildFileTree, fetchFileContent, detectLanguage } from "@/lib/github/fetcher"
import type { CodeIndex } from "@/lib/code/code-index"
import { createEmptyIndex, batchIndexFiles, flattenFiles } from '@/lib/code/code-index'
import { fetchRepoZipball, isFileIndexable } from "@/lib/github/zipball"
import { getCachedRepo, setCachedRepo } from "@/lib/cache/repo-cache"
import { analyzeCodebase, type FullAnalysis } from "@/lib/code/import-parser"
import { toast } from "sonner"

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

// Concurrency control for parallel fetching
const CONCURRENCY_LIMIT = 10

async function fetchWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number
): Promise<void> {
  const queue = [...items]
  const executing: Promise<void>[] = []
  
  while (queue.length > 0 || executing.length > 0) {
    while (executing.length < limit && queue.length > 0) {
      const item = queue.shift()!
      const promise = fn(item).then(() => {
        executing.splice(executing.indexOf(promise), 1)
      })
      executing.push(promise)
    }
    
    if (executing.length > 0) {
      await Promise.race(executing)
    }
  }
}

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

  // Start indexing files in background (B1 zipball, B3 batch, B6 error tracking)
  const startIndexing = useCallback(async (
    repoData: GitHubRepo,
    fileTree: FileNode[],
    treeSha: string,
    signal: AbortSignal
  ) => {
    // Get all indexable files from tree metadata
    const indexableFiles = flattenFiles(fileTree).filter(f =>
      isFileIndexable(f.name, f.size || 0)
    )
    
    setIndexingProgress({ current: 0, total: indexableFiles.length, isComplete: false })
    
    if (indexableFiles.length === 0) {
      setIndexingProgress({ current: 0, total: 0, isComplete: true })
      setLoadingStage('ready')
      return
    }
    
    const accumulated: Array<{ path: string; content: string; language?: string }> = []
    const errors: Array<{ path: string; error: string }> = []
    let zipballUsed = false

    // B1: Try zipball for repos under 50 MB (GitHub API reports size in KB)
    if (repoData.size != null && repoData.size < 50_000) {
      try {
        setLoadingStage('downloading')
        const zipFiles = await fetchRepoZipball(
          repoData.owner,
          repoData.name,
          repoData.defaultBranch,
          { signal },
        )

        if (signal.aborted) return

        setLoadingStage('extracting')
        for (const [path, content] of zipFiles) {
          const filename = path.split('/').pop() || path
          accumulated.push({ path, content, language: detectLanguage(filename) })
        }

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
            const content = await fetchFileContent(
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
    const finalIndex = batchIndexFiles(createEmptyIndex(), accumulated)

    setCodeIndex(finalIndex)
    setFailedFiles(errors)
    setIndexingProgress({
      current: accumulated.length,
      total: zipballUsed ? accumulated.length : indexableFiles.length,
      isComplete: true,
    })
    setLoadingStage('ready')

    // B2: Persist to IndexedDB cache
    setCachedRepo(repoData.owner, repoData.name, treeSha, accumulated, fileTree)
      .catch(() => { /* cache write failure is non-critical */ })

    // B6: Notify user of failed files
    if (errors.length > 0) {
      toast.error(
        `Indexed ${accumulated.length} files (${errors.length} failed)`,
      )
    }
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
  if (!context) {
    throw new Error('useRepository must be used within a RepositoryProvider')
  }
  return context
}
