"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react"
import type { FileNode } from "@/types/repository"
import type {
  ComparisonRepo,
  RepoMetrics,
  RepoDependencies,
} from "@/types/comparison"
import { MAX_COMPARISON_REPOS } from "@/types/comparison"
import { parseGitHubUrl } from "@/lib/github/parser"
import { fetchRepoViaProxy, fetchTreeViaProxy, fetchFileViaProxy } from "@/lib/github/client"
import { buildFileTree } from "@/lib/github/fetcher"
import { flattenFiles } from "@/lib/code/code-index"
import { toast } from "sonner"
import { createRepositoryCoverage } from '@/lib/repository'
import {
  PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT,
  isPrivateRepositoryRevocation,
} from '@/lib/auth/credential-events'

interface ComparisonContextType {
  repos: Map<string, ComparisonRepo>
  isAtCapacity: boolean

  addRepo: (url: string) => Promise<boolean>
  removeRepo: (id: string) => void
  retryRepo: (id: string) => Promise<boolean>
  clearAll: () => void

  getRepoList: () => ComparisonRepo[]
}

const ComparisonContext = createContext<ComparisonContextType | null>(null)

/** Compute metrics from file tree metadata (no extra fetching needed). */
function computeMetrics(
  repo: ComparisonRepo["repo"],
  files: FileNode[]
): RepoMetrics {
  const flat = flattenFiles(files)
  const languageCounts: Record<string, number> = {}

  for (const file of flat) {
    const lang = file.language ?? "other"
    languageCounts[lang] = (languageCounts[lang] || 0) + 1
  }

  // Estimate total lines from file sizes (rough: ~25 bytes per line)
  const BYTES_PER_LINE = 25
  const totalLines = flat.reduce(
    (sum, f) => sum + Math.round((f.size ?? 0) / BYTES_PER_LINE),
    0
  )

  // Primary language: most files by count (exclude "other")
  const langEntries = Object.entries(languageCounts).filter(
    ([l]) => l !== "other"
  )
  langEntries.sort((a, b) => b[1] - a[1])
  const primaryLanguage = langEntries[0]?.[0] ?? repo.language ?? null

  return {
    totalFiles: flat.length,
    totalLines,
    primaryLanguage,
    languageBreakdown: languageCounts,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssuesCount,
    pushedAt: repo.pushedAt || null,
    license: repo.license,
  }
}

/** Parse package.json content into structured dependencies. */
function parseDependencies(content: string): RepoDependencies {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return {
      deps: pkg.dependencies ?? {},
      devDeps: pkg.devDependencies ?? {},
    }
  } catch {
    return { deps: {}, devDeps: {}, fetchError: "Invalid package.json format" }
  }
}

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Map<string, ComparisonRepo>>(new Map())
  const reposRef = useRef(repos)
  const operationsRef = useRef(new Map<string, { generation: number; controller: AbortController }>())
  const generationRef = useRef(new Map<string, number>())

  const commitRepos = useCallback((next: Map<string, ComparisonRepo>) => {
    reposRef.current = next
    setRepos(next)
  }, [])

  const invalidateOperation = useCallback((id: string) => {
    const operation = operationsRef.current.get(id)
    operation?.controller.abort()
    operationsRef.current.delete(id)
  }, [])

  const beginOperation = useCallback((id: string) => {
    const generation = (generationRef.current.get(id) ?? 0) + 1
    generationRef.current.set(id, generation)
    const operation = { generation, controller: new AbortController() }
    operationsRef.current.set(id, operation)
    return operation
  }, [])

  const loadRepo = useCallback(async (
    id: string,
    owner: string,
    repoName: string,
    operation: { generation: number; controller: AbortController },
  ): Promise<boolean> => {
    const isCurrent = () => operationsRef.current.get(id) === operation && reposRef.current.has(id)

    try {
      const signal = operation.controller.signal
      const repoData = await fetchRepoViaProxy(owner, repoName, { signal })
      if (!isCurrent()) return false

      const indexing = new Map(reposRef.current)
      const current = indexing.get(id)
      if (current) indexing.set(id, { ...current, repo: repoData, status: "indexing", error: undefined })
      commitRepos(indexing)

      const tree = await fetchTreeViaProxy(repoData.owner, repoData.name, repoData.defaultBranch, { signal })
      if (!isCurrent()) return false
      const fileTree = buildFileTree(tree)
      const coverage = createRepositoryCoverage(tree, repoData.size)
      const metrics = computeMetrics(repoData, fileTree)

      let dependencies: RepoDependencies | undefined
      try {
        const packageContent = await fetchFileViaProxy(
          repoData.owner,
          repoData.name,
          repoData.defaultBranch,
          "package.json",
          { signal },
        )
        if (isCurrent()) dependencies = parseDependencies(packageContent)
      } catch {
        if (signal.aborted || !isCurrent()) return false
      }

      if (!isCurrent()) return false
      const ready = new Map(reposRef.current)
      ready.set(id, {
        id,
        repo: repoData,
        files: fileTree,
        metrics,
        status: "ready",
        dependencies,
        treeItems: tree.tree,
        coverage,
      })
      commitRepos(ready)
      return true
    } catch (err) {
      if (operation.controller.signal.aborted || !isCurrent()) return false
      const message = err instanceof Error ? err.message : "Failed to load repository"
      const failed = new Map(reposRef.current)
      const current = failed.get(id)
      if (current) failed.set(id, { ...current, status: "error", error: message })
      commitRepos(failed)
      toast.error(`Failed to load ${id}: ${message}`)
      return false
    }
  }, [commitRepos])

  const isAtCapacity = repos.size >= MAX_COMPARISON_REPOS

  const addRepo = useCallback(
    async (url: string): Promise<boolean> => {
      // Parse URL
      const parsed = parseGitHubUrl(url)
      if (!parsed) {
        toast.error("Invalid GitHub URL. Try owner/repo or a full URL.")
        return false
      }

      const { owner, repo: repoName } = parsed
      const id = `${owner}/${repoName}`.toLowerCase()

      // Reserve the slot before the first await so concurrent additions cannot
      // observe the same capacity and both enter the map.
      if (reposRef.current.has(id)) {
        toast.error(`${id} is already loaded.`)
        return false
      }

      // Check capacity
      if (reposRef.current.size >= MAX_COMPARISON_REPOS) {
        toast.error(
          `Maximum ${MAX_COMPARISON_REPOS} repos. Remove one first.`
        )
        return false
      }

      // Insert placeholder with loading status
      const placeholder: ComparisonRepo = {
        id,
        repo: {
          owner,
          name: repoName,
          fullName: `${owner}/${repoName}`,
          description: null,
          defaultBranch: "main",
          stars: 0,
          forks: 0,
          language: null,
          topics: [],
          isPrivate: false,
          url: `https://github.com/${owner}/${repoName}`,
          openIssuesCount: 0,
          pushedAt: '',
          license: null,
        },
        files: [],
        metrics: {
          totalFiles: 0,
          totalLines: 0,
          primaryLanguage: null,
          languageBreakdown: {},
          stars: 0,
          forks: 0,
          openIssues: 0,
          pushedAt: null,
          license: null,
        },
        status: "loading",
      }

      const operation = beginOperation(id)
      commitRepos(new Map(reposRef.current).set(id, placeholder))
      return loadRepo(id, owner, repoName, operation)
    },
    [beginOperation, commitRepos, loadRepo]
  )

  const removeRepo = useCallback((id: string) => {
    invalidateOperation(id)
    const next = new Map(reposRef.current)
    next.delete(id)
    commitRepos(next)
  }, [commitRepos, invalidateOperation])

  const retryRepo = useCallback(
    async (id: string): Promise<boolean> => {
      const existing = reposRef.current.get(id)
      if (!existing) return false

      invalidateOperation(id)
      const operation = beginOperation(id)
      const retrying = new Map(reposRef.current)
      retrying.set(id, { ...existing, status: "loading", error: undefined })
      commitRepos(retrying)
      return loadRepo(id, existing.repo.owner, existing.repo.name, operation)
    },
    [beginOperation, commitRepos, invalidateOperation, loadRepo]
  )

  const clearAll = useCallback(() => {
    for (const operation of operationsRef.current.values()) operation.controller.abort()
    operationsRef.current.clear()
    commitRepos(new Map())
  }, [commitRepos])

  const handleCredentialRevocation = useCallback(() => {
    for (const operation of operationsRef.current.values()) operation.controller.abort()
    operationsRef.current.clear()
    generationRef.current.clear()

    // A ready repository with explicit public metadata is safe to retain.
    // Loading/indexing/error entries may still contain private data or lack
    // enough metadata to classify them, so remove them on revocation.
    const publicReady = new Map(
      Array.from(reposRef.current).filter(([, entry]) => entry.status === 'ready' && !entry.repo.isPrivate),
    )
    commitRepos(publicReady)
  }, [commitRepos])

  useEffect(() => {
    const handleSameWindowRevocation = () => handleCredentialRevocation()
    const handleCrossTabRevocation = (event: StorageEvent) => {
      if (isPrivateRepositoryRevocation(event)) handleCredentialRevocation()
    }

    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleSameWindowRevocation)
    window.addEventListener('storage', handleCrossTabRevocation)
    return () => {
      window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleSameWindowRevocation)
      window.removeEventListener('storage', handleCrossTabRevocation)
    }
  }, [handleCredentialRevocation])

  useEffect(() => () => {
    for (const operation of operationsRef.current.values()) operation.controller.abort()
    operationsRef.current.clear()
    generationRef.current.clear()
  }, [])

  const getRepoList = useCallback((): ComparisonRepo[] => {
    return Array.from(reposRef.current.values())
  }, [])

  return (
    <ComparisonContext.Provider
      value={{
        repos,
        isAtCapacity,
        addRepo,
        removeRepo,
        retryRepo,
        clearAll,
        getRepoList,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  )
}

export function useComparison() {
  const context = useContext(ComparisonContext)
  if (context === null) {
    throw new Error("useComparison must be used within a ComparisonProvider")
  }
  return context
}
