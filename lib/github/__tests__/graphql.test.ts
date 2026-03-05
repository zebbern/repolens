import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { githubGraphQL } from '../graphql'

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
// Tests
// ---------------------------------------------------------------------------

describe('githubGraphQL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a GraphQL query and returns data on success', async () => {
    const responseData = { repository: { name: 'react' } }
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { data: responseData }),
    )

    const result = await githubGraphQL<typeof responseData>(
      'query { repository(owner: $o, name: $n) { name } }',
      { o: 'facebook', n: 'react' },
      'ghp_test_token',
    )

    expect(result).toEqual(responseData)
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ghp_test_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'query { repository(owner: $o, name: $n) { name } }',
        variables: { o: 'facebook', n: 'react' },
      }),
    })
  })

  it('throws on 401 authentication error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(401, {}, 'Unauthorized'),
    )

    await expect(
      githubGraphQL('query { viewer { login } }', {}, 'bad-token'),
    ).rejects.toThrow('Authentication required for this request')
  })

  it('throws on GraphQL errors array', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: null,
        errors: [
          { message: 'Could not resolve to a Repository', type: 'NOT_FOUND' },
          { message: 'Secondary error' },
        ],
      }),
    )

    await expect(
      githubGraphQL('query { ... }', { owner: 'x', name: 'y' }, 'token'),
    ).rejects.toThrow('Could not resolve to a Repository')
  })

  it('throws on non-OK non-401 response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(500, {}, 'Internal Server Error'),
    )

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toThrow('GraphQL request failed: Internal Server Error')
  })

  it('propagates network errors from fetch', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toThrow('Failed to fetch')
  })
})
