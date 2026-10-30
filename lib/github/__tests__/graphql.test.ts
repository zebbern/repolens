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
    expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/graphql', expect.objectContaining({
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ghp_test_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'query { repository(owner: $o, name: $n) { name } }',
        variables: { o: 'facebook', n: 'react' },
      }),
      signal: expect.any(AbortSignal),
    }))
  })

  it('throws an unauthorized GitHubError on 401', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(401, {}, 'Unauthorized'),
    )

    await expect(
      githubGraphQL('query { viewer { login } }', {}, 'bad-token'),
    ).rejects.toMatchObject({ name: 'GitHubError', kind: 'unauthorized', upstreamStatus: 401 })
  })

  it('maps the first GraphQL error to a kind and keeps its text for logging only', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: null,
        errors: [
          { message: 'Could not resolve to a Repository', type: 'NOT_FOUND' },
          { message: 'Secondary error' },
        ],
      }),
    )

    const error = await githubGraphQL('query { ... }', { owner: 'x', name: 'y' }, 'token').catch((e: unknown) => e)

    expect(error).toMatchObject({
      name: 'GitHubError',
      kind: 'not_found',
      upstreamMessage: 'Could not resolve to a Repository',
    })
    expect((error as Error).message).not.toContain('Could not resolve')
  })

  it('maps a RATE_LIMITED GraphQL error to rate_limited', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { data: null, errors: [{ message: 'API rate limit exceeded', type: 'RATE_LIMITED' }] }),
    )

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toMatchObject({ kind: 'rate_limited' })
  })

  it('throws an upstream GitHubError on non-OK non-401 response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(500, {}, 'Internal Server Error'),
    )

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toMatchObject({ kind: 'upstream', message: 'Failed to fetch GitHub data', upstreamStatus: 500 })
  })

  it('wraps network errors from fetch as upstream', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toMatchObject({ kind: 'upstream', upstreamMessage: 'Failed to fetch' })
  })

  it('rethrows a caller abort unchanged', async () => {
    const controller = new AbortController()
    const reason = new DOMException('navigated away', 'AbortError')
    controller.abort(reason)
    mockFetch.mockRejectedValueOnce(reason)

    await expect(
      githubGraphQL('query { ... }', {}, 'token', controller.signal),
    ).rejects.toBe(reason)
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

  it('treats a 403 without rate-limit signals as forbidden', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(403, {}, 'Forbidden'),
    )

    await expect(
      githubGraphQL('query { ... }', {}, 'token'),
    ).rejects.toMatchObject({ kind: 'forbidden' })
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
