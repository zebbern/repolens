// GitHub URL Parser

export interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch?: string
  path?: string
}

/**
 * Parse a GitHub URL into its components
 * Supports various formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/blob/branch/path
 * - github.com/owner/repo
 * - owner/repo
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  // Trim whitespace
  url = url.trim()
  
  // Handle short format: owner/repo
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    const [owner, repo] = url.split('/')
    return { owner, repo }
  }
  
  // Handle full URLs
  try {
    // Add protocol if missing
    if (!url.startsWith('http')) {
      url = 'https://' + url
    }
    
    const parsed = new URL(url)
    
    // Must be github.com
    if (!parsed.hostname.includes('github.com')) {
      return null
    }
    
    // Parse path: /owner/repo/tree/branch/path or /owner/repo
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    
    if (pathParts.length < 2) {
      return null
    }
    
    const [owner, repo, type, branch, ...pathSegments] = pathParts
    
    const result: ParsedGitHubUrl = {
      owner,
      repo: repo.replace('.git', ''),
    }
    
    if (type === 'tree' || type === 'blob') {
      result.branch = branch
      if (pathSegments.length > 0) {
        result.path = pathSegments.join('/')
      }
    }
    
    return result
  } catch {
    return null
  }
}

/**
 * Validate if a string is a valid GitHub URL
 */
export function isValidGitHubUrl(url: string): boolean {
  return parseGitHubUrl(url) !== null
}

/**
 * Build a GitHub API URL for a repository
 */
export function buildRepoApiUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}`
}

/**
 * Build a GitHub API URL for repository contents
 */
export function buildContentsApiUrl(owner: string, repo: string, path: string = ''): string {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents`
  return path ? `${base}/${path}` : base
}

/**
 * Build a GitHub API URL for the repository tree
 */
export function buildTreeApiUrl(owner: string, repo: string, sha: string = 'HEAD'): string {
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
}

/**
 * Get the raw content URL for a file
 */
export function buildRawContentUrl(owner: string, repo: string, branch: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedPath}`
}
