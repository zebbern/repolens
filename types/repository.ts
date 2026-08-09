// GitHub Repository Types

export interface GitHubRepo {
  owner: string
  name: string
  fullName: string
  description: string | null
  defaultBranch: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  isPrivate: boolean
  url: string
  /** Repository size in KB as returned by the GitHub API. */
  size?: number
  openIssuesCount: number
  pushedAt: string
  license: string | null
  isFork?: boolean
  parentFullName?: string | null
}

export interface RepoFile {
  path: string
  name: string
  type: 'file' | 'dir'
  size?: number
  sha?: string
  url?: string
  content?: string
}

export interface RepoTree {
  sha: string
  tree: RepoTreeItem[]
  truncated: boolean
}

export interface CompleteRepoTree extends RepoTree {
  status: 'complete'
  truncated: false
  requestCount: number
}

export type TreeResolutionReason =
  | 'truncated'
  | 'request-budget-exceeded'
  | 'time-budget-exceeded'
  | 'fetch-failed'

export interface PartialRepoTree extends RepoTree {
  status: 'partial'
  truncated: true
  reasons: TreeResolutionReason[]
  failureDetails: Array<{ path: string; reason: TreeResolutionReason; message: string }>
  failedSubtrees: string[]
  requestCount: number
}

export type ResolvedRepoTree = CompleteRepoTree | PartialRepoTree

export interface RepoTreeItem {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
  url?: string
}

export interface RepositoryCoverage {
  treeStatus: ResolvedRepoTree['status']
  supportedFiles: {
    discovered: number
    loaded: number
  }
  failures: {
    count: number
    samples: Array<{ path: string; error: string }>
  }
  failedSubtrees: {
    count: number
    samples: string[]
  }
  mode: 'full' | 'on-demand'
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  gitType?: RepoTreeItem['type']
  children?: FileNode[]
  size?: number
  language?: string
  content?: string
}

export interface ParsedFunction {
  name: string
  type: 'function' | 'method' | 'arrow' | 'class'
  params: string[]
  returnType?: string
  startLine: number
  endLine: number
  docstring?: string
  isExported: boolean
  isAsync: boolean
}

export interface ParsedImport {
  source: string
  specifiers: string[]
  isDefault: boolean
  isNamespace: boolean
}

export interface ParsedExport {
  name: string
  type: 'function' | 'class' | 'variable' | 'type' | 'interface'
  isDefault: boolean
}

export interface ParsedFile {
  path: string
  language: string
  imports: ParsedImport[]
  exports: ParsedExport[]
  functions: ParsedFunction[]
  classes: ParsedClass[]
  dependencies: string[]
}

export interface ParsedClass {
  name: string
  methods: ParsedFunction[]
  properties: string[]
  extends?: string
  implements?: string[]
  startLine: number
  endLine: number
  docstring?: string
  isExported: boolean
}

export interface RepositoryContext {
  repo: GitHubRepo | null
  files: FileNode[]
  parsedFiles: Map<string, ParsedFile>
  isLoading: boolean
  error: string | null
}

export interface GitHubTag {
  name: string
  commitSha: string
  commitUrl: string
  tarballUrl: string
  zipballUrl: string
}

export interface GitHubBranch {
  name: string
  commitSha: string
  isProtected: boolean
}

export interface GitHubCommit {
  sha: string
  message: string
  authorName: string
  authorEmail: string
  authorDate: string
  committerName: string
  committerDate: string
  url: string
  authorLogin: string | null
  authorAvatarUrl: string | null
  parents: Array<{ sha: string }>
}

export interface GitHubComparisonFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

export interface GitHubComparison {
  status: string
  aheadBy: number
  behindBy: number
  totalCommits: number
  commits: GitHubCommit[]
  files: GitHubComparisonFile[]
}

export interface DependencyNode {
  file: string
  imports: string[]
  importedBy: string[]
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>
  entryPoints: string[]
}
