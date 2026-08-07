import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock next-auth/jwt before importing our module
vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}))

import { getAccessToken } from './token'
import { getToken } from 'next-auth/jwt'

const mockGetToken = vi.mocked(getToken)
const originalAuthSecret = process.env.AUTH_SECRET
const originalNextAuthSecret = process.env.NEXTAUTH_SECRET

describe('getAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
  })

  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuthSecret

    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret
  })

  /** Helper: build a mock NextRequest with optional X-GitHub-Token header. */
  function mockRequest(pat?: string) {
    return {
      headers: {
        get: (name: string) =>
          name === 'X-GitHub-Token' ? (pat ?? null) : null,
      },
    } as Parameters<typeof getAccessToken>[0]
  }

  it('returns the PAT when X-GitHub-Token header is present', async () => {
    const result = await getAccessToken(mockRequest('ghp_pat123'))

    expect(result).toBe('ghp_pat123')
    // Should NOT call getToken — PAT short-circuits
    expect(mockGetToken).not.toHaveBeenCalled()
  })

  it('returns the access token when the user is authenticated via OAuth', async () => {
    process.env.NEXTAUTH_SECRET = 'nextauth-secret'
    mockGetToken.mockResolvedValue({
      accessToken: 'gho_abc123',
      sub: 'user-1',
    } as Awaited<ReturnType<typeof getToken>>)

    const result = await getAccessToken(mockRequest())

    expect(result).toBe('gho_abc123')
    expect(mockGetToken).toHaveBeenCalledWith({
      req: expect.anything(),
      secret: 'nextauth-secret',
    })
  })

  it('prefers AUTH_SECRET when resolving an OAuth JWT', async () => {
    process.env.AUTH_SECRET = 'auth-secret'
    process.env.NEXTAUTH_SECRET = 'nextauth-secret'
    mockGetToken.mockResolvedValue({
      accessToken: 'gho_abc123',
      sub: 'user-1',
    } as Awaited<ReturnType<typeof getToken>>)

    await getAccessToken(mockRequest())

    expect(mockGetToken).toHaveBeenCalledWith({
      req: expect.anything(),
      secret: 'auth-secret',
    })
  })

  it('returns undefined when no token is available', async () => {
    mockGetToken.mockResolvedValue(null)

    const result = await getAccessToken(mockRequest())

    expect(result).toBeUndefined()
  })

  it('returns undefined when token has no accessToken field', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-2',
    } as Awaited<ReturnType<typeof getToken>>)

    const result = await getAccessToken(mockRequest())

    expect(result).toBeUndefined()
  })

  it('returns PAT when BOTH X-GitHub-Token and OAuth JWT are present (PAT wins)', async () => {
    mockGetToken.mockResolvedValue({
      accessToken: 'gho_oauth_token',
      sub: 'user-3',
    } as Awaited<ReturnType<typeof getToken>>)

    const result = await getAccessToken(mockRequest('ghp_pat_token'))

    expect(result).toBe('ghp_pat_token')
    // PAT short-circuits — OAuth getToken should not be called
    expect(mockGetToken).not.toHaveBeenCalled()
  })
})
