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

  // ---- Edge cases ---------------------------------------------------------

  it('succeeds when response has an empty errors array', async () => {
    const responseData = { viewer: { login: 'alice' } }
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { data: responseData, errors: [] }),
    )

    const result = await githubGraphQL<typeof responseData>(
      'query { viewer { login } }',
      {},
      'ghp_token',
    )

    expect(result).toEqual(responseData)
  })

  it('throws on rate limiting (403)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, {}, 'Forbidden'),
    )

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toThrow('GraphQL request failed: Forbidden')
  })

  it('throws when response.json() rejects (malformed JSON)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response)

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toThrow('Unexpected token')
  })

  it('sends correct Authorization header format', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { data: { test: true } }),
    )

    await githubGraphQL('query { test }', {}, 'my-secret-token')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer my-secret-token')
  })

  it('passes variables in the request body', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { data: { repository: { name: 'test' } } }),
    )

    await githubGraphQL(
      'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { name } }',
      { owner: 'facebook', name: 'react' },
      'token',
    )

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.variables).toEqual({ owner: 'facebook', name: 'react' })
  })
})
