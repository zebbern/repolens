import { describe, expect, it } from 'vitest'

import {
  classifyGitHubStatus,
  GITHUB_ERROR_KINDS,
  GITHUB_ERROR_RESPONSES,
  GitHubError,
  gitHubErrorFromGraphQL,
  gitHubErrorFromProxyResponse,
  gitHubErrorFromResponse,
  gitHubErrorMessage,
  gitHubRetryAfter,
  gitHubTransportError,
  isGitHubError,
  withGitHubResource,
} from '../errors'

function githubResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

describe('classifyGitHubStatus', () => {
  it.each([
    [401, {}, undefined, 'unauthorized'],
    [404, {}, undefined, 'not_found'],
    [410, {}, undefined, 'not_found'],
    [409, {}, undefined, 'invalid'],
    [422, {}, undefined, 'invalid'],
    [429, {}, undefined, 'rate_limited'],
    [403, { 'X-RateLimit-Remaining': '0' }, undefined, 'rate_limited'],
    [403, { 'Retry-After': '30' }, undefined, 'rate_limited'],
    [403, {}, 'You have exceeded a secondary rate limit.', 'rate_limited'],
    [403, { 'X-RateLimit-Remaining': '4999' }, 'Resource protected by organization SAML enforcement.', 'forbidden'],
    [403, {}, undefined, 'forbidden'],
    [451, {}, undefined, 'forbidden'],
    [500, {}, undefined, 'upstream'],
    [502, {}, undefined, 'upstream'],
  ] as const)('%i %j %s → %s', (status, headers, message, kind) => {
    expect(classifyGitHubStatus(status, new Headers(headers), message)).toBe(kind)
  })
})

describe('gitHubRetryAfter', () => {
  const now = Date.UTC(2026, 0, 1)

  it('prefers Retry-After seconds', () => {
    expect(gitHubRetryAfter(new Headers({ 'Retry-After': '60', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1' }), now)).toBe(60)
  })

  it('uses the reset of an exhausted primary limit', () => {
    const reset = String(now / 1000 + 90)
    expect(gitHubRetryAfter(new Headers({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': reset }), now)).toBe(90)
  })

  it('ignores the reset while requests remain, and missing headers', () => {
    expect(gitHubRetryAfter(new Headers({ 'X-RateLimit-Remaining': '10', 'X-RateLimit-Reset': '9999999999' }), now)).toBeUndefined()
    expect(gitHubRetryAfter(undefined, now)).toBeUndefined()
  })
})

describe('GitHubError messages', () => {
  it('come from the table and keep the historical strings', () => {
    expect(gitHubErrorMessage('not_found', { resource: 'repository' })).toBe(
      "Repository not found. Make sure the repository exists. If it's private, add a GitHub token in Settings.",
    )
    expect(gitHubErrorMessage('not_found', { resource: 'tags' })).toBe('Tags not found.')
    expect(gitHubErrorMessage('not_found', { resource: 'commit', subject: 'abc1234' })).toBe('Commit not found: abc1234')
    expect(gitHubErrorMessage('not_found', { resource: 'pull_request_files', subject: '7' })).toBe('Pull request #7 not found')
    expect(gitHubErrorMessage('invalid', { resource: 'comparison' })).toBe('Invalid request for comparison.')
    expect(gitHubErrorMessage('upstream', { resource: 'blame' })).toBe('Failed to fetch blame data')
    expect(gitHubErrorMessage('unauthorized', { resource: 'blame' })).toBe('Authentication required to fetch blame data')
  })

  it('never use GitHub\'s text', async () => {
    const error = await gitHubErrorFromResponse(
      githubResponse(403, { message: 'Resource protected by organization SAML enforcement.' }),
      { resource: 'tags' },
    )

    expect(error).toMatchObject({ kind: 'forbidden', upstreamStatus: 403, upstreamMessage: 'Resource protected by organization SAML enforcement.' })
    expect(error.message).not.toContain('SAML')
  })

  it('map every kind to a status and code', () => {
    expect(Object.keys(GITHUB_ERROR_RESPONSES).sort()).toEqual([...GITHUB_ERROR_KINDS].sort())
  })
})

describe('gitHubErrorFromResponse', () => {
  it('classifies a secondary limit by GitHub\'s message and passes Retry-After on', async () => {
    const error = await gitHubErrorFromResponse(
      githubResponse(429, { message: 'You have exceeded a secondary rate limit.' }, { 'Retry-After': '60' }),
      { resource: 'commits' },
    )

    expect(error).toMatchObject({ kind: 'rate_limited', retryAfter: 60, resource: 'commits' })
  })

  it('cancels a body that is not JSON without reading it', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true } })

    const error = await gitHubErrorFromResponse(new Response(body, { status: 502, statusText: 'Bad Gateway' }), { resource: 'repository' })

    expect(error).toMatchObject({ kind: 'upstream', upstreamMessage: 'Bad Gateway' })
    expect(cancelled).toBe(true)
  })

  it('accepts a response stub without headers or body', async () => {
    const error = await gitHubErrorFromResponse({ ok: false, status: 404, statusText: 'Not Found' } as Response, { resource: 'tags' })

    expect(error).toMatchObject({ kind: 'not_found', message: 'Tags not found.' })
  })
})

describe('gitHubErrorFromGraphQL', () => {
  it.each([
    ['NOT_FOUND', 'not_found'],
    ['RATE_LIMITED', 'rate_limited'],
    ['FORBIDDEN', 'forbidden'],
    [undefined, 'upstream'],
  ] as const)('%s → %s', (type, kind) => {
    expect(gitHubErrorFromGraphQL([{ type, message: 'detail' }], { resource: 'blame' })).toMatchObject({ kind, upstreamMessage: 'detail' })
  })

  it('treats a token without the needed scopes as forbidden', () => {
    expect(gitHubErrorFromGraphQL([{ type: 'INSUFFICIENT_SCOPES', message: 'needs repo scope' }], { resource: 'blame' }).kind)
      .toBe('forbidden')
  })

  it('treats an untyped error that reports a rate limit as rate_limited', () => {
    expect(gitHubErrorFromGraphQL([{ message: 'API rate limit exceeded for user' }], { resource: 'blame' }).kind)
      .toBe('rate_limited')
  })

  it('takes Retry-After for a GraphQL rate limit from the response headers', () => {
    const now = 1_700_000_000_000
    const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 120) })

    const error = gitHubErrorFromGraphQL([{ type: 'RATE_LIMITED' }], { resource: 'blame' }, headers, now)

    expect(error.retryAfter).toBe(120)
  })
})

describe('review follow-ups: classification and Retry-After bounds', () => {
  it('classifies an abuse-detection 403 without rate-limit headers as rate_limited', () => {
    expect(classifyGitHubStatus(403, new Headers(), 'You have triggered an abuse detection mechanism.')).toBe('rate_limited')
  })

  it.each([
    ['a huge Retry-After', { 'retry-after': '999999999999999999999999' }],
    ['a far-future reset', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1e300' }],
  ])('caps %s at one day', (_name, headers) => {
    expect(gitHubRetryAfter(new Headers(headers), 0)).toBe(86_400)
  })
})

describe('gitHubTransportError', () => {
  it('turns a deadline into timeout and a network failure into upstream', () => {
    expect(gitHubTransportError(new DOMException('timed out', 'TimeoutError'), { resource: 'tags' })).toMatchObject({ kind: 'timeout' })
    expect(gitHubTransportError(new TypeError('fetch failed'), { resource: 'tags' })).toMatchObject({
      kind: 'upstream',
      upstreamMessage: 'fetch failed',
    })
  })

  it('returns caller aborts unchanged', () => {
    const abort = new DOMException('navigated away', 'AbortError')
    expect(gitHubTransportError(abort, { resource: 'tags' })).toBe(abort)

    const controller = new AbortController()
    controller.abort()
    const timeout = new DOMException('timed out', 'TimeoutError')
    expect(gitHubTransportError(timeout, { resource: 'tags' }, controller.signal)).toBe(timeout)
  })
})

describe('isGitHubError', () => {
  it('recognizes a copy of the class from another module instance by name and kind', () => {
    const copy = Object.assign(new Error('Tags not found.'), { name: 'GitHubError', kind: 'not_found' })

    expect(isGitHubError(new GitHubError('timeout', { resource: 'tags' }))).toBe(true)
    expect(isGitHubError(copy)).toBe(true)
    expect(isGitHubError(Object.assign(new Error('x'), { name: 'GitHubError', kind: 'teapot' }))).toBe(false)
    expect(isGitHubError(new Error('Tags not found.'))).toBe(false)
  })

  it('keeps the kind when re-targeted', () => {
    const error = withGitHubResource(
      new GitHubError('rate_limited', { resource: 'github', retryAfter: 5, upstreamMessage: 'detail' }),
      { resource: 'blame' },
    )

    expect(error).toMatchObject({ kind: 'rate_limited', resource: 'blame', retryAfter: 5, upstreamMessage: 'detail' })
  })
})

describe('gitHubErrorFromProxyResponse', () => {
  it('rebuilds the kind from the route code and keeps the route message', async () => {
    const error = await gitHubErrorFromProxyResponse(
      Response.json({ error: { code: 'RATE_LIMIT', message: 'Rate limit exceeded.' } }, { status: 403, headers: { 'Retry-After': '12' } }),
      { resource: 'tags' },
    )

    expect(error).toMatchObject({ kind: 'rate_limited', message: 'Rate limit exceeded.', upstreamStatus: 403, retryAfter: 12 })
  })

  it('treats an unknown code as upstream and falls back to the table message', async () => {
    const unknown = await gitHubErrorFromProxyResponse(
      Response.json({ error: { code: 'toString', message: 'Something odd' } }, { status: 418 }),
      { resource: 'tags' },
    )
    const empty = await gitHubErrorFromProxyResponse(new Response('not json', { status: 500 }), { resource: 'tags' })

    expect(unknown).toMatchObject({ kind: 'upstream', message: 'Something odd' })
    expect(empty).toMatchObject({ kind: 'upstream', message: 'Failed to fetch tags' })
  })
})
