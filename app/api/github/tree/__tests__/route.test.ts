import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockApplyRateLimit = vi.fn()
const mockFetchRepoTree = vi.fn()

vi.mock('@/lib/api/github-cache', () => ({
  withGitHubCachePolicy: (handler: (request: Request, token?: string) => Promise<Response>) => (
    (request: Request) => handler(request, undefined)
  ),
}))
vi.mock('@/lib/api/rate-limit', () => ({
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}))
vi.mock('@/lib/github/fetcher', () => ({
  fetchRepoTree: (...args: unknown[]) => mockFetchRepoTree(...args),
}))
vi.mock('@/lib/api/error', () => ({
  apiError: (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status }),
}))

import { GET, TREE_ROUTE_RATE_COST } from '../route'

describe('GET /api/github/tree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplyRateLimit.mockReturnValue(null)
    mockFetchRepoTree.mockResolvedValue({ status: 'complete', sha: 'root', tree: [], truncated: false, requestCount: 1 })
  })

  it('charges one weighted ingress unit for the maximum upstream work', async () => {
    await GET(new NextRequest('http://localhost/api/github/tree?owner=acme&name=repo'))

    expect(mockApplyRateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: '/api/github/tree',
      cost: TREE_ROUTE_RATE_COST,
    })
  })

  it('propagates caller cancellation instead of returning a 500 response', async () => {
    const reason = new DOMException('Client disconnected', 'AbortError')
    mockFetchRepoTree.mockRejectedValue(reason)
    const controller = new AbortController()
    const request = new (await import('next/server')).NextRequest(
      'http://localhost/api/github/tree?owner=acme&name=repo',
      { signal: controller.signal },
    )
    controller.abort(reason)

    await expect(GET(request)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
