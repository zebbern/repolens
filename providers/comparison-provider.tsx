"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
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

      // Check duplicates
      if (repos.has(id)) {
        toast.error(`${id} is already loaded.`)
        return false
      }

      // Check capacity
      if (repos.size >= MAX_COMPARISON_REPOS) {
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

      setRepos((prev) => new Map(prev).set(id, placeholder))

      try {
        // Fetch metadata
        const repoData = await fetchRepoViaProxy(owner, repoName)

        // Update status to indexing
        setRepos((prev) => {
          const next = new Map(prev)
          const current = next.get(id)
          if (current) {
            next.set(id, { ...current, repo: repoData, status: "indexing" })
          }
          return next
        })

        // Fetch tree
        const tree = await fetchTreeViaProxy(
          repoData.owner,
          repoData.name,
          repoData.defaultBranch
        )
        const fileTree = buildFileTree(tree)

        // Compute metrics from tree metadata
        const metrics = computeMetrics(repoData, fileTree)

        // Attempt to fetch package.json for dependency analysis
        let dependencies: RepoDependencies | undefined
        try {
          const packageContent = await fetchFileViaProxy(
            repoData.owner,
            repoData.name,
            repoData.defaultBranch,
            "package.json"
          )
          dependencies = parseDependencies(packageContent)
        } catch {
          // No package.json or fetch failed — not an error, just skip
        }

        // Mark ready
        setRepos((prev) => {
          const next = new Map(prev)
          next.set(id, {
            id,
            repo: repoData,
            files: fileTree,
            metrics,
            status: "ready",
            dependencies,
          })
          return next
        })

        return true
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load repository"

        setRepos((prev) => {
          const next = new Map(prev)
          const current = next.get(id)
          if (current) {
            next.set(id, { ...current, status: "error", error: message })
          }
          return next
        })

        toast.error(`Failed to load ${id}: ${message}`)
        return false
      }
    },
    [repos]
  )

  const removeRepo = useCallback((id: string) => {
    setRepos((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const retryRepo = useCallback(
    async (id: string): Promise<boolean> => {
      const existing = repos.get(id)
      if (!existing) return false

      // Remove and re-add
      removeRepo(id)
      return addRepo(
        `https://github.com/${existing.repo.owner}/${existing.repo.name}`
      )
    },
    [repos, removeRepo, addRepo]
  )

  const clearAll = useCallback(() => {
    setRepos(new Map())
  }, [])

  const getRepoList = useCallback((): ComparisonRepo[] => {
    return Array.from(repos.values())
  }, [repos])

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
