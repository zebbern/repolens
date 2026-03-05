import type { GitHubCommit } from '@/types/repository'
import type { CommitFile } from '@/types/git-history'
import type { CommitGroup, AuthorCommitGroup, FileChangeStats } from './types'

/**
 * Group commits by date (day granularity).
 * Uses the `authorDate` ISO string, truncated to YYYY-MM-DD.
 * Returns groups sorted by date descending (most recent first).
 * Within each group, commits preserve their original order.
 */
export function groupCommitsByDate(commits: GitHubCommit[]): CommitGroup[] {
  if (commits.length === 0) return []

  const groupMap = new Map<string, GitHubCommit[]>()

  for (const commit of commits) {
    const dateKey = commit.authorDate.slice(0, 10)
    const group = groupMap.get(dateKey)
    if (group) {
      group.push(commit)
    } else {
      groupMap.set(dateKey, [commit])
    }
  }

  return Array.from(groupMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupCommits]) => ({
      dateKey,
      label: formatDateLabel(dateKey),
      commits: groupCommits,
    }))
}

/** Format a YYYY-MM-DD key into a human-friendly label. */
function formatDateLabel(dateKey: string): string {
  const todayKey = new Date().toISOString().slice(0, 10)

  if (dateKey === todayKey) return 'Today'

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateKey === yesterday.toISOString().slice(0, 10)) return 'Yesterday'

  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Group commits by author.
 * Keys by `authorLogin` when available, falls back to "authorName <authorEmail>".
 * Returns sorted by commit count descending.
 */
export function groupCommitsByAuthor(
  commits: GitHubCommit[],
): AuthorCommitGroup[] {
  if (commits.length === 0) return []

  const groupMap = new Map<string, AuthorCommitGroup>()

  for (const commit of commits) {
    const key = commit.authorLogin ?? `${commit.authorName} <${commit.authorEmail}>`
    const existing = groupMap.get(key)

    if (existing) {
      existing.commits.push(commit)
      // Prefer non-null avatar/login from the first commit that has them
      if (!existing.login && commit.authorLogin) {
        existing.login = commit.authorLogin
        existing.avatarUrl = commit.authorAvatarUrl
      }
    } else {
      groupMap.set(key, {
        author: commit.authorName,
        login: commit.authorLogin,
        avatarUrl: commit.authorAvatarUrl,
        commits: [commit],
      })
    }
  }

  return Array.from(groupMap.values()).sort(
    (a, b) => b.commits.length - a.commits.length,
  )
}

/**
 * Compute aggregate file-change statistics from a list of commit files.
 */
export function computeFileChangeStats(files: CommitFile[]): FileChangeStats {
  let totalAdditions = 0
  let totalDeletions = 0

  for (const file of files) {
    totalAdditions += file.additions
    totalDeletions += file.deletions
  }

  return {
    fileCount: files.length,
    totalAdditions,
    totalDeletions,
  }
}
