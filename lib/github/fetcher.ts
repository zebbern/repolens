// GitHub API Fetcher

import type { GitHubRepo, RepoTree, FileNode, GitHubTag, GitHubBranch, GitHubCommit, GitHubComparison } from '@/types/repository'
import type { BlameData, CommitDetail, CommitFile } from '@/types/git-history'
import { buildRepoApiUrl, buildTreeApiUrl, buildRawContentUrl } from './parser'
import { githubGraphQL } from './graphql'

const GITHUB_API_BASE = 'https://api.github.com'

interface FetchOptions {
  token?: string
}

/**
 * Fetch repository metadata
 */
export async function fetchRepoMetadata(
  owner: string, 
  repo: string,
  options: FetchOptions = {}
): Promise<GitHubRepo> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
  }
  
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }
  
  const response = await fetch(buildRepoApiUrl(owner, repo), { headers })
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Repository not found. Make sure the repository exists and is public.')
    }
    if (response.status === 403) {
      throw new Error('Rate limit exceeded. Please try again later or add a GitHub token.')
    }
    throw new Error(`Failed to fetch repository: ${response.statusText}`)
  }
  
  const data = await response.json()
  
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language,
    topics: data.topics || [],
    isPrivate: data.private,
    url: data.html_url,
    size: data.size,
    openIssuesCount: data.open_issues_count ?? 0,
    pushedAt: data.pushed_at ?? '',
    license: data.license?.spdx_id ?? null,
  }
}

/**
 * Fetch repository file tree
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  sha: string = 'HEAD',
  options: FetchOptions = {}
): Promise<RepoTree> {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
  }
  
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }
  
  const response = await fetch(buildTreeApiUrl(owner, repo, sha), { headers })
  
  if (!response.ok) {
    throw new Error(`Failed to fetch repository tree: ${response.statusText}`)
  }
  
  return response.json()
}

/**
 * Fetch file content
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  options: FetchOptions = {}
): Promise<string> {
  const headers: HeadersInit = {}
  
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }
  
  const url = buildRawContentUrl(owner, repo, branch, path)
  const response = await fetch(url, { headers })
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`)
  }
  
  return response.text()
}

/**
 * Build GitHub API headers with optional auth token.
 */
function buildHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Handle common GitHub API error responses.
 */
function handleGitHubError(response: Response, context: string): never {
  if (response.status === 404) {
    throw new Error(`${context} not found.`)
  }
  if (response.status === 403) {
    throw new Error('Rate limit exceeded. Please try again later or add a GitHub token.')
  }
  if (response.status === 422) {
    throw new Error(`Invalid request for ${context.toLowerCase()}.`)
  }
  throw new Error(`Failed to fetch ${context.toLowerCase()}: ${response.statusText}`)
}

/**
 * Fetch repository tags.
 */
export async function fetchTags(
  owner: string,
  name: string,
  options: FetchOptions & { perPage?: number; page?: number } = {},
): Promise<GitHubTag[]> {
  const headers = buildHeaders(options.token)
  const perPage = options.perPage ?? 100
  const page = options.page ?? 1

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags?per_page=${perPage}&page=${page}`
  const response = await fetch(url, { headers })

  if (!response.ok) {
    handleGitHubError(response, 'Tags')
  }

  const data = await response.json()

  return (data as Array<Record<string, unknown>>).map((tag) => ({
    name: tag.name as string,
    commitSha: (tag.commit as Record<string, string>).sha,
    commitUrl: (tag.commit as Record<string, string>).url,
    tarballUrl: (tag.tarball_url as string) ?? '',
    zipballUrl: (tag.zipball_url as string) ?? '',
  }))
}

/**
 * Fetch repository branches.
 */
export async function fetchBranches(
  owner: string,
  name: string,
  options: FetchOptions & { perPage?: number; page?: number } = {},
): Promise<GitHubBranch[]> {
  const headers = buildHeaders(options.token)
  const perPage = options.perPage ?? 100
  const page = options.page ?? 1

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=${perPage}&page=${page}`
  const response = await fetch(url, { headers })

  if (!response.ok) {
    handleGitHubError(response, 'Branches')
  }

  const data = await response.json()

  return (data as Array<Record<string, unknown>>).map((branch) => ({
    name: branch.name as string,
    commitSha: (branch.commit as Record<string, string>).sha,
    isProtected: (branch.protected as boolean) ?? false,
  }))
}

/**
 * Fetch repository commits.
 */
export async function fetchCommits(
  owner: string,
  name: string,
  options: FetchOptions & {
    sha?: string
    since?: string
    until?: string
    perPage?: number
    page?: number
    path?: string
  } = {},
): Promise<GitHubCommit[]> {
  const headers = buildHeaders(options.token)
  const perPage = options.perPage ?? 100
  const page = options.page ?? 1

  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
  })
  if (options.sha) params.set('sha', options.sha)
  if (options.since) params.set('since', options.since)
  if (options.until) params.set('until', options.until)
  if (options.path) params.set('path', options.path)

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?${params.toString()}`
  const response = await fetch(url, { headers })

  if (!response.ok) {
    handleGitHubError(response, 'Commits')
  }

  const data = await response.json()
  return mapCommits(data as Array<Record<string, unknown>>)
}

/**
 * Fetch comparison between two refs (branches, tags, or commits).
 */
export async function fetchCompare(
  owner: string,
  name: string,
  base: string,
  head: string,
  options: FetchOptions = {},
): Promise<GitHubComparison> {
  const headers = buildHeaders(options.token)

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  const response = await fetch(url, { headers })

  if (!response.ok) {
    handleGitHubError(response, 'Comparison')
  }

  const data = (await response.json()) as Record<string, unknown>

  return {
    status: data.status as string,
    aheadBy: data.ahead_by as number,
    behindBy: data.behind_by as number,
    totalCommits: data.total_commits as number,
    commits: mapCommits(data.commits as Array<Record<string, unknown>>),
    files: ((data.files as Array<Record<string, unknown>>) ?? []).map((file) => ({
      filename: file.filename as string,
      status: file.status as string,
      additions: file.additions as number,
      deletions: file.deletions as number,
      changes: file.changes as number,
      patch: file.patch as string | undefined,
    })),
  }
}

// ---------------------------------------------------------------------------
// Blame (GraphQL) and Commit Detail (REST) fetchers
// ---------------------------------------------------------------------------

const BLAME_QUERY = `
query BlameData($owner: String!, $name: String!, $expression: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Blob {
        byteSize
        isTruncated
        blame(startingLine: 1) {
          ranges {
            startingLine
            endingLine
            age
            commit {
              oid
              abbreviatedOid
              message
              messageHeadline
              committedDate
              url
              author {
                name
                email
                date
                user {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
}
`

interface BlameGraphQLResponse {
  repository: {
    object: {
      byteSize: number
      isTruncated: boolean
      blame: {
        ranges: BlameData['ranges']
      }
    } | null
  }
}

/**
 * Fetch blame data for a file via GitHub GraphQL API.
 * Requires authentication — GitHub GraphQL API does not support unauthenticated requests.
 */
export async function fetchBlame(
  owner: string,
  name: string,
  ref: string,
  path: string,
  options: FetchOptions = {},
): Promise<BlameData> {
  if (!options.token) {
    throw new Error('Authentication required to fetch blame data')
  }

  const expression = `${ref}:${path}`
  const data = await githubGraphQL<BlameGraphQLResponse>(
    BLAME_QUERY,
    { owner, name, expression },
    options.token,
  )

  const blob = data.repository.object
  if (!blob) {
    throw new Error(`File not found: ${path}`)
  }

  return {
    ranges: blob.blame.ranges,
    isTruncated: blob.isTruncated,
    byteSize: blob.byteSize,
  }
}

/**
 * Fetch detailed commit information including stats and file changes.
 */
export async function fetchCommitDetail(
  owner: string,
  name: string,
  sha: string,
  options: FetchOptions = {},
): Promise<CommitDetail> {
  const headers = buildHeaders(options.token)

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`
  const response = await fetch(url, { headers })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Commit not found: ${sha}`)
    }
    handleGitHubError(response, 'Commit')
  }

  const data = (await response.json()) as Record<string, unknown>
  const commit = data.commit as Record<string, unknown>
  const commitAuthor = commit.author as Record<string, string>
  const commitCommitter = commit.committer as Record<string, string>
  const author = data.author as Record<string, string> | null
  const stats = data.stats as Record<string, number>
  const rawFiles = (data.files as Array<Record<string, unknown>>) ?? []

  return {
    sha: data.sha as string,
    message: commit.message as string,
    authorName: commitAuthor.name,
    authorEmail: commitAuthor.email,
    authorDate: commitAuthor.date,
    committerName: commitCommitter.name,
    committerDate: commitCommitter.date,
    url: data.html_url as string,
    authorLogin: author?.login ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    parents: ((data.parents as Array<Record<string, string>>) ?? []).map((p) => ({
      sha: p.sha,
    })),
    stats: {
      additions: stats.additions,
      deletions: stats.deletions,
      total: stats.total,
    },
    files: rawFiles.map((file): CommitFile => ({
      filename: file.filename as string,
      status: file.status as CommitFile['status'],
      additions: file.additions as number,
      deletions: file.deletions as number,
      changes: file.changes as number,
      patch: file.patch as string | undefined,
      previousFilename: file.previous_filename as string | undefined,
    })),
  }
}

/**
 * Map raw GitHub commit objects to GitHubCommit[].
 */
function mapCommits(raw: Array<Record<string, unknown>>): GitHubCommit[] {
  return raw.map((item) => {
    const commit = item.commit as Record<string, unknown>
    const commitAuthor = commit.author as Record<string, string>
    const commitCommitter = commit.committer as Record<string, string>
    const author = item.author as Record<string, string> | null

    return {
      sha: item.sha as string,
      message: commit.message as string,
      authorName: commitAuthor.name,
      authorEmail: commitAuthor.email,
      authorDate: commitAuthor.date,
      committerName: commitCommitter.name,
      committerDate: commitCommitter.date,
      url: item.html_url as string,
      authorLogin: author?.login ?? null,
      authorAvatarUrl: author?.avatar_url ?? null,
      parents: ((item.parents as Array<Record<string, string>>) ?? []).map((p) => ({
        sha: p.sha,
      })),
    }
  })
}

/**
 * Build a hierarchical file tree from flat tree data
 */
export function buildFileTree(tree: RepoTree): FileNode[] {
  const root: FileNode[] = []
  const nodeMap = new Map<string, FileNode>()
  
  // Sort items so directories come before files at the same level
  const sortedTree = [...tree.tree].sort((a, b) => {
    const aDepth = a.path.split('/').length
    const bDepth = b.path.split('/').length
    if (aDepth !== bDepth) return aDepth - bDepth
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.path.localeCompare(b.path)
  })
  
  for (const item of sortedTree) {
    const parts = item.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    
    const node: FileNode = {
      name,
      path: item.path,
      type: item.type === 'tree' ? 'directory' : 'file',
      size: item.size,
      language: item.type === 'blob' ? detectLanguage(name) : undefined,
    }
    
    if (item.type === 'tree') {
      node.children = []
    }
    
    nodeMap.set(item.path, node)
    
    if (parentPath === '') {
      root.push(node)
    } else {
      const parent = nodeMap.get(parentPath)
      if (parent && parent.children) {
        parent.children.push(node)
      }
    }
  }
  
  return root
}

/**
 * Detect programming language from file extension
 */
export function detectLanguage(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase()
  
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'cs': 'csharp',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'php': 'php',
    'vue': 'vue',
    'svelte': 'svelte',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'mdx': 'mdx',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'dockerfile': 'dockerfile',
    'graphql': 'graphql',
    'gql': 'graphql',
  }
  
  return ext ? languageMap[ext] : undefined
}

/**
 * Build a string representation of the file tree for AI context
 */
export function buildFileTreeString(files: FileNode[], indent: string = ''): string {
  let result = ''
  
  for (const file of files) {
    result += `${indent}${file.type === 'directory' ? '/' : ''}${file.name}\n`
    if (file.type === 'directory' && file.children) {
      result += buildFileTreeString(file.children, indent + '  ')
    }
  }
  
  return result
}

/**
 * Filter files by language/extension
 */
export function filterCodeFiles(files: FileNode[]): FileNode[] {
  const codeExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 
    'swift', 'cs', 'cpp', 'c', 'h', 'hpp', 'php', 'vue', 'svelte'
  ])
  
  const result: FileNode[] = []
  
  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.type === 'directory' && node.children) {
        const filteredDir: FileNode = {
          ...node,
          children: []
        }
        traverse(node.children)
        if (filteredDir.children && filteredDir.children.length > 0) {
          result.push(filteredDir)
        }
      } else if (node.type === 'file') {
        const ext = node.name.split('.').pop()?.toLowerCase()
        if (ext && codeExtensions.has(ext)) {
          result.push(node)
        }
      }
    }
  }
  
  traverse(files)
  return result
}
