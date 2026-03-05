import { describe, it, expect } from 'vitest'
import type {
  BlameUser,
  BlameAuthor,
  BlameCommit,
  BlameRange,
  BlameData,
  CommitStats,
  CommitFile,
  CommitDetail,
} from './git-history'

describe('git-history types', () => {
  // -----------------------------------------------------------------------
  // Blame types
  // -----------------------------------------------------------------------

  it('BlameRange can be constructed with all required fields', () => {
    const user: BlameUser = { login: 'octocat', avatarUrl: 'https://avatar.url/octocat' }
    const author: BlameAuthor = {
      name: 'Octocat',
      email: 'octo@github.com',
      date: '2025-01-15T10:00:00Z',
      user,
    }
    const commit: BlameCommit = {
      oid: 'abc123def456',
      abbreviatedOid: 'abc123d',
      message: 'fix: resolve issue #42',
      messageHeadline: 'fix: resolve issue #42',
      committedDate: '2025-01-15T10:00:00Z',
      url: 'https://github.com/owner/repo/commit/abc123def456',
      author,
    }
    const range: BlameRange = {
      startingLine: 1,
      endingLine: 10,
      age: 5,
      commit,
    }

    expect(range.startingLine).toBe(1)
    expect(range.endingLine).toBe(10)
    expect(range.commit.author?.user?.login).toBe('octocat')
  })

  it('BlameAuthor allows null user for non-linked accounts', () => {
    const author: BlameAuthor = {
      name: 'Unknown Dev',
      email: 'unknown@example.com',
      date: '2025-01-01T00:00:00Z',
      user: null,
    }

    expect(author.user).toBeNull()
    expect(author.name).toBe('Unknown Dev')
  })

  it('BlameCommit allows null author', () => {
    const commit: BlameCommit = {
      oid: 'deadbeef',
      abbreviatedOid: 'deadbee',
      message: 'initial commit',
      messageHeadline: 'initial commit',
      committedDate: '2020-01-01T00:00:00Z',
      url: 'https://github.com/owner/repo/commit/deadbeef',
      author: null,
    }

    expect(commit.author).toBeNull()
  })

  it('BlameData shape matches expected contract', () => {
    const data: BlameData = {
      ranges: [],
      isTruncated: false,
      byteSize: 1024,
    }

    expect(data.ranges).toEqual([])
    expect(data.isTruncated).toBe(false)
    expect(data.byteSize).toBe(1024)
  })

  // -----------------------------------------------------------------------
  // Commit detail types
  // -----------------------------------------------------------------------

  it('CommitDetail can be constructed with all fields', () => {
    const stats: CommitStats = { additions: 10, deletions: 3, total: 13 }
    const file: CommitFile = {
      filename: 'src/index.ts',
      status: 'modified',
      additions: 10,
      deletions: 3,
      changes: 13,
      patch: '@@ -1,3 +1,10 @@',
      previousFilename: undefined,
    }

    const detail: CommitDetail = {
      sha: 'abc123def456789',
      message: 'feat: add new feature\n\nLong description here.',
      authorName: 'Jane',
      authorEmail: 'jane@example.com',
      authorDate: '2025-06-15T12:00:00Z',
      committerName: 'GitHub',
      committerDate: '2025-06-15T12:00:00Z',
      url: 'https://github.com/owner/repo/commit/abc123def456789',
      authorLogin: 'janedoe',
      authorAvatarUrl: 'https://avatars.githubusercontent.com/u/123',
      parents: [{ sha: 'parent1' }, { sha: 'parent2' }],
      stats,
      files: [file],
    }

    expect(detail.sha).toBe('abc123def456789')
    expect(detail.parents).toHaveLength(2)
    expect(detail.files[0].status).toBe('modified')
    expect(detail.stats.total).toBe(13)
  })

  it('CommitFile status accepts all valid values', () => {
    const statuses: CommitFile['status'][] = [
      'added',
      'removed',
      'modified',
      'renamed',
      'copied',
      'changed',
      'unchanged',
    ]

    expect(statuses).toHaveLength(7)
  })
})
