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

  // ---- Error paths --------------------------------------------------------

  it('fetchCommits sets error when the fetcher rejects', async () => {
    mockFetchCommits.mockRejectedValue(new Error('Network timeout'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })

    expect(result.current.error).toBe('Network timeout')
    expect(result.current.commits).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('fetchCommits sets fallback error for non-Error rejections', async () => {
    mockFetchCommits.mockRejectedValue('some string error')

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })

    expect(result.current.error).toBe('Failed to load commits')
  })

  it('fetchBlame sets generic error for non-auth failures', async () => {
    mockFetchBlame.mockRejectedValue(new Error('Server error'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchBlame('owner', 'repo', 'main', 'src/index.ts')
    })

    expect(result.current.error).toBe('Server error')
    expect(result.current.error).not.toContain('Login required')
  })

  it('fetchCommitDetail sets error on failure', async () => {
    mockFetchCommitDetail.mockRejectedValue(new Error('Not found'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommitDetail('owner', 'repo', 'bad-sha')
    })

    expect(result.current.error).toBe('Not found')
    expect(result.current.selectedCommit).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  // ---- fetchFileHistory ---------------------------------------------------

  it('fetchFileHistory sets fileCommits on success', async () => {
    const data = [makeCommit('f1'), makeCommit('f2')]
    mockFetchFileCommits.mockResolvedValue(data)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchFileHistory('owner', 'repo', 'src/index.ts')
    })

    expect(result.current.fileCommits).toEqual(data)
    expect(result.current.isLoading).toBe(false)
  })

  it('fetchFileHistory sets error on failure', async () => {
    mockFetchFileCommits.mockRejectedValue(new Error('Rate limited'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchFileHistory('owner', 'repo', 'path')
    })

    expect(result.current.error).toBe('Rate limited')
    expect(result.current.fileCommits).toEqual([])
  })

  // ---- loadMoreCommits ----------------------------------------------------

  it('loadMoreCommits does nothing when commits array is empty', async () => {
    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.loadMoreCommits('owner', 'repo')
    })

    expect(mockFetchCommits).not.toHaveBeenCalled()
  })

  it('loadMoreCommits does nothing when hasMore is false', async () => {
    // Load fewer than PER_PAGE commits so hasMore remains false
    mockFetchCommits.mockResolvedValue([makeCommit('a')])

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })
    expect(result.current.hasMore).toBe(false)

    mockFetchCommits.mockClear()

    await act(async () => {
      await result.current.loadMoreCommits('owner', 'repo')
    })

    expect(mockFetchCommits).not.toHaveBeenCalled()
  })

  it('loadMoreCommits appends commits when hasMore is true', async () => {
    // Return exactly 30 commits so hasMore = true
    const initialCommits = Array.from({ length: 30 }, (_, i) => makeCommit(`c${i}`))
    mockFetchCommits.mockResolvedValue(initialCommits)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })
    expect(result.current.hasMore).toBe(true)
    expect(result.current.commits).toHaveLength(30)

    // Next page returns some more
    const moreCommits = [makeCommit('c29'), makeCommit('extra1'), makeCommit('extra2')]
    mockFetchCommits.mockResolvedValue(moreCommits)

    await act(async () => {
      await result.current.loadMoreCommits('owner', 'repo')
    })

    // Should append (skipping first commit since it's the sha anchor)
    expect(result.current.commits.length).toBeGreaterThan(30)
  })

  // ---- clearError ---------------------------------------------------------

  it('clearError resets error to null', async () => {
    mockFetchCommits.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })
    expect(result.current.error).toBe('boom')

    act(() => {
      result.current.clearError()
    })

    expect(result.current.error).toBeNull()
  })

  // ---- hasMore / pagination -----------------------------------------------

  it('sets hasMore=true when exactly PER_PAGE results are returned', async () => {
    const data = Array.from({ length: 30 }, (_, i) => makeCommit(`c${i}`))
    mockFetchCommits.mockResolvedValue(data)

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })

    expect(result.current.hasMore).toBe(true)
  })

  it('sets hasMore=false when fewer than PER_PAGE results are returned', async () => {
    mockFetchCommits.mockResolvedValue([makeCommit('a')])

    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchCommits('owner', 'repo')
    })

    expect(result.current.hasMore).toBe(false)
  })
})
