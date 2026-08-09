import type { GitHubRepo, FileNode, RepoTreeItem, RepositoryCoverage } from "@/types/repository"

export interface RepoMetrics {
  totalFiles: number
  totalLines: number
  primaryLanguage: string | null
  languageBreakdown: Record<string, number>
  stars: number
  forks: number
  openIssues: number
  pushedAt: string | null
  license: string | null
}

export type ComparisonRepoStatus = "loading" | "indexing" | "ready" | "error"

export interface RepoDependencies {
  deps: Record<string, string>
  devDeps: Record<string, string>
  fetchError?: string
}

export interface ComparisonRepo {
  /** Unique key: `owner/name` */
  id: string
  repo: GitHubRepo
  files: FileNode[]
  metrics: RepoMetrics
  status: ComparisonRepoStatus
  error?: string
  dependencies?: RepoDependencies
  treeItems?: RepoTreeItem[]
  coverage?: RepositoryCoverage
}

export const MAX_COMPARISON_REPOS = 5

export type SimilarityLabel = "likely-clone" | "highly-similar" | "some-overlap" | "different"

export interface SimilaritySignals {
  shaJaccard: number
  shaContainment: number
  pathJaccard: number
  dependencyOverlap: number
  languageCosine: number
}

export interface RepoRelationship {
  isForkPair: boolean
  commonParent?: string
}

export interface SimilarityResult {
  repoA: string
  repoB: string
  score: number
  label: SimilarityLabel
  signals: SimilaritySignals
  relationship: RepoRelationship
  identicalFiles: string[]
  isLowConfidence: boolean
  totalComparedFiles: number
}
