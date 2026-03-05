import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGithubGraphQL = vi.fn()
const mockFetch = vi.fn()

vi.mock('@/lib/github/graphql', () => ({
  githubGraphQL: (...args: unknown[]) => mockGithubGraphQL(...args),
}))

vi.stubGlobal('fetch', mockFetch)

import { fetchBlame, fetchCommitDetail, fetchCommits } from '../fetcher'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJsonResponse(status: number, body: unknown, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// fetchBlame
// ---------------------------------------------------------------------------

describe('fetchBlame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns blame data on success', async () => {
    const ranges = [
      {
        startingLine: 1,
        endingLine: 5,
        age: 3,
        commit: {
          oid: 'abc123',
          abbreviatedOid: 'abc123',
          message: 'init',
          messageHeadline: 'init',
          committedDate: '2025-01-01T00:00:00Z',
          url: 'https://github.com/owner/repo/commit/abc123',
          author: null,
        },
      },
    ]

    mockGithubGraphQL.mockResolvedValueOnce({
      repository: {
        object: {
          byteSize: 512,
          isTruncated: false,
          blame: { ranges },
        },
      },
    })

    const result = await fetchBlame('owner', 'repo', 'main', 'src/index.ts', { token: 'tok' })

    expect(result).toEqual({
      ranges,
      isTruncated: false,
      byteSize: 512,
    })

    expect(mockGithubGraphQL).toHaveBeenCalledWith(
      expect.stringContaining('BlameData'),
      { owner: 'owner', name: 'repo', expression: 'main:src/index.ts' },
      'tok',
    )
  })

  it('throws when no token is provided', async () => {
    await expect(
      fetchBlame('owner', 'repo', 'main', 'src/index.ts'),
    ).rejects.toThrow('Authentication required to fetch blame data')
  })

  it('throws when the GraphQL response object is null (file not found)', async () => {
    mockGithubGraphQL.mockResolvedValueOnce({
      repository: { object: null },
    })

    await expect(
      fetchBlame('owner', 'repo', 'main', 'nonexistent.ts', { token: 'tok' }),
    ).rejects.toThrow('File not found: nonexistent.ts')
  })
})

// ---------------------------------------------------------------------------
// fetchCommitDetail
// ---------------------------------------------------------------------------

describe('fetchCommitDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns commit detail on success', async () => {
    const rawResponse = {
      sha: 'abc123',
      html_url: 'https://github.com/owner/repo/commit/abc123',
      commit: {
        message: 'feat: add feature',
        author: { name: 'Jane', email: 'jane@example.com', date: '2025-01-15T10:00:00Z' },
        committer: { name: 'GitHub', date: '2025-01-15T10:00:00Z' },
      },
      author: { login: 'janedoe', avatar_url: 'https://avatar.url/jane' },
      parents: [{ sha: 'parent1' }],
      stats: { additions: 10, deletions: 2, total: 12 },
      files: [
        {
          filename: 'src/index.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
          patch: '@@ -1 +1 @@',
        },
      ],
    }

    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, rawResponse))

    const result = await fetchCommitDetail('owner', 'repo', 'abc123', { token: 'tok' })

    expect(result.sha).toBe('abc123')
    expect(result.authorName).toBe('Jane')
    expect(result.authorLogin).toBe('janedoe')
    expect(result.stats.total).toBe(12)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe('src/index.ts')
  })

  it('throws 404 error when commit does not exist', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(404, {}, 'Not Found'),
    )

    await expect(
      fetchCommitDetail('owner', 'repo', 'deadbeef'),
    ).rejects.toThrow('Commit not found: deadbeef')
  })

  it('handles commits with null author (deleted accounts)', async () => {
    const rawResponse = {
      sha: 'abc123',
      html_url: 'https://github.com/owner/repo/commit/abc123',
      commit: {
        message: 'old commit',
        author: { name: 'Ghost', email: 'ghost@example.com', date: '2020-01-01T00:00:00Z' },
        committer: { name: 'Ghost', date: '2020-01-01T00:00:00Z' },
      },
      author: null,
      parents: [],
      stats: { additions: 0, deletions: 0, total: 0 },
      files: [],
    }

    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, rawResponse))

    const result = await fetchCommitDetail('owner', 'repo', 'abc123')

    expect(result.authorLogin).toBeNull()
    expect(result.authorAvatarUrl).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchCommits with path parameter
// ---------------------------------------------------------------------------

describe('fetchCommits with path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes path in the URL query params', async () => {
    const rawCommits = [
      {
        sha: 'abc123',
        html_url: 'https://github.com/owner/repo/commit/abc123',
        commit: {
          message: 'update file',
          author: { name: 'John', email: 'j@x.com', date: '2025-01-01T00:00:00Z' },
          committer: { name: 'John', date: '2025-01-01T00:00:00Z' },
        },
        author: { login: 'john', avatar_url: 'https://avatar.url/john' },
        parents: [],
      },
    ]

    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, rawCommits))

    const result = await fetchCommits('owner', 'repo', {
      path: 'src/index.ts',
      token: 'tok',
    })

    expect(result).toHaveLength(1)
    expect(result[0].sha).toBe('abc123')

    // Verify path is in the URL
    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain('path=src%2Findex.ts')
  })

  it('works without path parameter', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, []))

    await fetchCommits('owner', 'repo', { token: 'tok' })

    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).not.toContain('path=')
  })
})
