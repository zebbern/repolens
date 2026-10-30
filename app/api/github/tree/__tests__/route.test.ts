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

  const partial = (reasons: string[]) => ({
    status: 'partial', sha: 'root', tree: [], truncated: true, requestCount: 1, reasons,
    failedSubtrees: ['.'], failureDetails: reasons.map(reason => ({ path: '.', reason, message: 'x' })),
  })

  it.each([['fetch-failed'], ['time-budget-exceeded']])(
    'keeps a partial tree caused by %s out of the CDN cache',
    async (reason) => {
      mockFetchRepoTree.mockResolvedValue(partial([reason]))

      const res = await GET(new NextRequest('http://localhost/api/github/tree?owner=acme&name=repo'))

      expect(res.status).toBe(200)
      expect(res.headers.get('CDN-Cache-Control')).toBe('no-store')
    },
  )

  it('leaves complete trees and request-budget partials to the default cache policy', async () => {
    const complete = await GET(new NextRequest('http://localhost/api/github/tree?owner=acme&name=repo'))
    mockFetchRepoTree.mockResolvedValue(partial(['request-budget-exceeded']))
    const budget = await GET(new NextRequest('http://localhost/api/github/tree?owner=acme&name=repo'))

    expect(complete.headers.get('CDN-Cache-Control')).toBeNull()
    expect(budget.headers.get('CDN-Cache-Control')).toBeNull()
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
