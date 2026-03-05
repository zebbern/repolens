import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { groupCommitsByDate, groupCommitsByAuthor, computeFileChangeStats } from '../commit-utils'
import type { GitHubCommit } from '@/types/repository'
import type { CommitFile } from '@/types/git-history'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<GitHubCommit> = {}): GitHubCommit {
  return {
    sha: 'abc1234',
    message: 'fix: something',
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2024-06-15T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2024-06-15T10:00:00Z',
    url: 'https://github.com/owner/repo/commit/abc1234',
    authorLogin: 'alice',
    authorAvatarUrl: 'https://avatar.test/alice',
    parents: [{ sha: 'parent1' }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// groupCommitsByDate
// ---------------------------------------------------------------------------

describe('groupCommitsByDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty array for empty input', () => {
    expect(groupCommitsByDate([])).toEqual([])
  })

  it('groups commits by their authorDate day', () => {
    const commits = [
      makeCommit({ sha: 'a', authorDate: '2024-06-15T09:00:00Z' }),
      makeCommit({ sha: 'b', authorDate: '2024-06-15T14:00:00Z' }),
      makeCommit({ sha: 'c', authorDate: '2024-06-14T10:00:00Z' }),
    ]

    const groups = groupCommitsByDate(commits)

    expect(groups).toHaveLength(2)
    // Most recent first
    expect(groups[0].dateKey).toBe('2024-06-15')
    expect(groups[0].commits).toHaveLength(2)
    expect(groups[1].dateKey).toBe('2024-06-14')
    expect(groups[1].commits).toHaveLength(1)
  })

  it('labels today\'s commits as "Today"', () => {
    const commits = [makeCommit({ authorDate: '2024-06-15T09:00:00Z' })]
    const groups = groupCommitsByDate(commits)
    expect(groups[0].label).toBe('Today')
  })

  it('labels yesterday\'s commits as "Yesterday"', () => {
    const commits = [makeCommit({ authorDate: '2024-06-14T09:00:00Z' })]
    const groups = groupCommitsByDate(commits)
    expect(groups[0].label).toBe('Yesterday')
  })

  it('formats older dates as long date strings', () => {
    const commits = [makeCommit({ authorDate: '2024-01-05T09:00:00Z' })]
    const groups = groupCommitsByDate(commits)
    // "January 5, 2024" in en-US
    expect(groups[0].label).toContain('January')
    expect(groups[0].label).toContain('2024')
  })
})

// ---------------------------------------------------------------------------
// groupCommitsByAuthor
// ---------------------------------------------------------------------------

describe('groupCommitsByAuthor', () => {
  it('returns empty array for empty input', () => {
    expect(groupCommitsByAuthor([])).toEqual([])
  })

  it('groups by authorLogin when available', () => {
    const commits = [
      makeCommit({ sha: 'a', authorLogin: 'alice', authorName: 'Alice' }),
      makeCommit({ sha: 'b', authorLogin: 'alice', authorName: 'Alice B' }),
      makeCommit({ sha: 'c', authorLogin: 'bob', authorName: 'Bob' }),
    ]

    const groups = groupCommitsByAuthor(commits)

    expect(groups).toHaveLength(2)
    // Sorted by count descending → Alice (2) first, Bob (1) second
    expect(groups[0].login).toBe('alice')
    expect(groups[0].commits).toHaveLength(2)
    expect(groups[1].login).toBe('bob')
    expect(groups[1].commits).toHaveLength(1)
  })

  it('falls back to "name <email>" when login is null', () => {
    const commits = [
      makeCommit({ sha: 'a', authorLogin: null, authorName: 'NoLogin', authorEmail: 'no@login.com' }),
      makeCommit({ sha: 'b', authorLogin: null, authorName: 'NoLogin', authorEmail: 'no@login.com' }),
    ]

    const groups = groupCommitsByAuthor(commits)

    expect(groups).toHaveLength(1)
    expect(groups[0].author).toBe('NoLogin')
    expect(groups[0].login).toBeNull()
    expect(groups[0].commits).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// computeFileChangeStats
// ---------------------------------------------------------------------------

describe('computeFileChangeStats', () => {
  it('sums additions, deletions, and counts files', () => {
    const files: CommitFile[] = [
      { filename: 'a.ts', status: 'modified', additions: 10, deletions: 3, changes: 13 },
      { filename: 'b.ts', status: 'added', additions: 20, deletions: 0, changes: 20 },
      { filename: 'c.ts', status: 'removed', additions: 0, deletions: 15, changes: 15 },
    ]

    const stats = computeFileChangeStats(files)

    expect(stats.totalAdditions).toBe(30)
    expect(stats.totalDeletions).toBe(18)
    expect(stats.fileCount).toBe(3)
  })
})
