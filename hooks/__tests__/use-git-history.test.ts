import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock GitHub client functions
// ---------------------------------------------------------------------------

const mockFetchBlame = vi.fn()
const mockFetchCommits = vi.fn()
const mockFetchFileCommits = vi.fn()
const mockFetchCommitDetail = vi.fn()

vi.mock('@/lib/github/client', () => ({
  fetchBlameViaProxy: (...args: unknown[]) => mockFetchBlame(...args),
  fetchCommitsViaProxy: (...args: unknown[]) => mockFetchCommits(...args),
  fetchFileCommitsViaProxy: (...args: unknown[]) => mockFetchFileCommits(...args),
  fetchCommitDetailViaProxy: (...args: unknown[]) => mockFetchCommitDetail(...args),
  fetchFileViaProxy: vi.fn(),
}))

import { useGitHistory } from '../use-git-history'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(sha: string) {
  return {
    sha,
    message: `commit ${sha}`,
    authorName: 'Alice',
    authorEmail: 'alice@test.com',
    authorDate: '2024-06-15T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2024-06-15T10:00:00Z',
    url: `https://github.com/o/r/commit/${sha}`,
    authorLogin: 'alice',
    authorAvatarUrl: null,
    parents: [{ sha: 'parent' }],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGitHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial empty state', () => {
    const { result } = renderHook(() => useGitHistory())

    expect(result.current.viewMode).toBe('timeline')
    expect(result.current.blameData).toBeNull()
    expect(result.current.commits).toEqual([])
    expect(result.current.fileCommits).toEqual([])
    expect(result.current.selectedCommit).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.hasMore).toBe(false)
  })

  it('fetchCommits sets commits', async () => {
    const data = [makeCommit('a'), makeCommit('b')]
    mockFetchCommits.mockResolvedValue(data)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })

    expect(result.current.commits).toEqual(data)
    expect(result.current.isLoading).toBe(false)
  })

  it('fetchBlame sets blameData', async () => {
    const blameData = {
      ranges: [{ startingLine: 1, endingLine: 5, age: 2, commit: { oid: 'x', abbreviatedOid: 'x', message: 'm', messageHeadline: 'm', committedDate: '2024-01-01', url: '', author: null } }],
      isTruncated: false,
      byteSize: 100,
    }
    mockFetchBlame.mockResolvedValue(blameData)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchBlame('owner', 'repo', 'main', 'src/index.ts')
    })

    expect(result.current.blameData).toEqual(blameData)
    expect(result.current.isLoading).toBe(false)
  })

  it('fetchBlame surfaces auth error message', async () => {
    mockFetchBlame.mockRejectedValue(new Error('401 Unauthorized'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchBlame('owner', 'repo', 'main', 'src/index.ts')
    })

    expect(result.current.error).toContain('Login required')
    expect(result.current.blameData).toBeNull()
  })

  it('fetchCommitDetail sets selectedCommit and switches to commit-detail view', async () => {
    const detail = {
      sha: 'abc',
      message: 'feat: new',
      authorName: 'Alice',
      authorEmail: 'alice@test.com',
      authorDate: '2024-06-15T10:00:00Z',
      committerName: 'Alice',
      committerDate: '2024-06-15T10:00:00Z',
      url: '',
      authorLogin: 'alice',
      authorAvatarUrl: null,
      parents: [],
      stats: { additions: 10, deletions: 5, total: 15 },
      files: [],
    }
    mockFetchCommitDetail.mockResolvedValue(detail)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommitDetail('owner', 'repo', 'abc')
    })

    expect(result.current.selectedCommit).toEqual(detail)
    expect(result.current.viewMode).toBe('commit-detail')
  })

  it('setViewMode changes viewMode', () => {
    const { result } = renderHook(() => useGitHistory())

    act(() => {
      result.current.setViewMode('blame')
    })

    expect(result.current.viewMode).toBe('blame')
  })

  it('reset clears all state', async () => {
    const data = [makeCommit('a')]
    mockFetchCommits.mockResolvedValue(data)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })
    expect(result.current.commits).toHaveLength(1)

    act(() => {
      result.current.reset()
    })

    expect(result.current.commits).toEqual([])
    expect(result.current.viewMode).toBe('timeline')
    expect(result.current.blameData).toBeNull()
    expect(result.current.selectedCommit).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
