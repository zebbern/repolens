import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { NextRequest } from 'next/server'

// Real client, real blame route, fake GitHub that rejects every token.
vi.mock('@/lib/auth/token', () => ({
  getAccessToken: () => Promise.resolve('gho_expired'),
}))

vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: () => null,
  refundRateLimit: () => {},
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { clearGitHubCache, setGitHubPAT } from '@/lib/github/client'
import { POST as blameRoute } from '@/app/api/github/blame/route'
import { useGitHistory } from '../use-git-history'

async function serve(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  if (url === '/api/github/blame') {
    return blameRoute(new NextRequest(`http://localhost${url}`, { method: 'POST', headers: init.headers, body: init.body }))
  }
  return Response.json({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' })
}

describe('useGitHistory blame with a rejected GitHub token', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(serve)
    clearGitHubCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    setGitHubPAT(null)
  })

  it.each([
    ['proxy mode (OAuth)', null],
    ['PAT direct mode', 'ghp_expired'],
  ] as const)('shows the login message in %s', async (_mode, pat) => {
    setGitHubPAT(pat)
    const { result } = renderHook(() => useGitHistory())

    await act(async () => {
      await result.current.fetchBlame('owner', 'repo', 'main', 'src/index.ts')
    })

    expect(mockFetch).toHaveBeenCalledWith(pat ? 'https://api.github.com/graphql' : '/api/github/blame', expect.anything())
    expect(result.current.error).toBe(
      'Login required to view blame data. Blame uses the GitHub GraphQL API which requires authentication.',
    )
  })
})
