export const GITHUB_TOKEN_STORAGE_KEY = 'repolens:github-token'

/** Load the GitHub PAT from localStorage. Returns null if nothing stored. */
export function loadGitHubToken(): string | null {
  try {
    return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Persist a GitHub PAT to localStorage. */
export function saveGitHubToken(token: string): void {
  localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token)
}

/** Remove the GitHub PAT from localStorage. */
export function removeGitHubToken(): void {
  localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY)
}
