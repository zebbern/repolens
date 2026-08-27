import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, act, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}))

vi.mock('next-auth/react', () => ({ useSession: mockUseSession }))

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/github-token', () => ({
  GITHUB_TOKEN_STORAGE_KEY: 'repolens:github-token',
  loadGitHubToken: vi.fn(),
  saveGitHubToken: vi.fn(),
  removeGitHubToken: vi.fn(),
}))

vi.mock('@/lib/github/client', () => ({
  setGitHubPAT: vi.fn(),
  setGitHubOAuthPrincipal: vi.fn(),
  clearGitHubCache: vi.fn(),
}))

vi.mock('@/lib/cache/repo-cache', () => ({
  clearPrivateRepoCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/code/scanner/scanner', () => ({ clearScanCache: vi.fn() }))
vi.mock('@/lib/code/scanner/ai-validator', () => ({ clearValidationCache: vi.fn() }))

// Suppress toast.error during tests
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

import { GitHubTokenProvider, useGitHubToken } from '../github-token-provider'
import { loadGitHubToken, saveGitHubToken, removeGitHubToken } from '@/lib/github-token'
import { setGitHubPAT, setGitHubOAuthPrincipal, clearGitHubCache } from '@/lib/github/client'
import { clearPrivateRepoCache } from '@/lib/cache/repo-cache'
import { clearScanCache } from '@/lib/code/scanner/scanner'
import { clearValidationCache } from '@/lib/code/scanner/ai-validator'
import {
  PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT,
  PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY,
  notifyPrivateRepositoryAccessRevoked,
  notifyPrivateRepositoryAccessRevocationFinished,
} from '@/lib/auth/credential-events'

const mockLoadGitHubToken = vi.mocked(loadGitHubToken)
const mockSaveGitHubToken = vi.mocked(saveGitHubToken)
const mockRemoveGitHubToken = vi.mocked(removeGitHubToken)
const mockSetGitHubPAT = vi.mocked(setGitHubPAT)
const mockSetGitHubOAuthPrincipal = vi.mocked(setGitHubOAuthPrincipal)
const mockClearGitHubCache = vi.mocked(clearGitHubCache)
const mockClearPrivateRepoCache = vi.mocked(clearPrivateRepoCache)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return <GitHubTokenProvider>{children}</GitHubTokenProvider>
}

function TokenConsumer({ onContext }: { onContext: (context: ReturnType<typeof useGitHubToken>) => void }) {
  const context = useGitHubToken()
  onContext(context)
  return <span data-testid="credential-descendant">credential descendant</span>
}

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubTokenProvider', () => {
  beforeEach(() => {
  vi.clearAllMocks()
  mockLoadGitHubToken.mockReturnValue(null)
  mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
})

  // -----------------------------------------------------------------------
  // Hydration
  // -----------------------------------------------------------------------

  describe('hydration', () => {
    it('hydrates token from localStorage on mount', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_stored_token')

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })

      expect(result.current.token).toBe('ghp_stored_token')
      expect(mockLoadGitHubToken).toHaveBeenCalled()
    })

    it('calls setGitHubPAT during hydration when a stored token exists', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_stored_token')

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })

      expect(mockSetGitHubPAT).toHaveBeenCalledWith('ghp_stored_token')
    })

    it('sets isHydrated to true even when no token is stored', async () => {
      mockLoadGitHubToken.mockReturnValue(null)

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true)
      })

      expect(result.current.token).toBeNull()
    })

    it('gates descendants while the OAuth session identity is loading', async () => {
      mockUseSession.mockReturnValue({ data: null, status: 'loading' })
      const view = render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )

      expect(screen.queryByTestId('descendant')).toBeNull()

      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })
      view.rerender(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
      expect(mockSetGitHubOAuthPrincipal).toHaveBeenCalledWith('account-a')
    })

    it('hydrates a stored PAT before installing an OAuth principal for descendants', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_stored')
      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })

      render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
      expect(mockSetGitHubPAT).toHaveBeenCalledWith('ghp_stored')
      expect(mockSetGitHubOAuthPrincipal).toHaveBeenCalledWith('account-a')
      expect(mockSetGitHubPAT.mock.invocationCallOrder[0]).toBeLessThan(
        mockSetGitHubOAuthPrincipal.mock.invocationCallOrder[0],
      )
    })

    it('rotates the OAuth principal and remounts descendants across session transitions', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })
      let mountCount = 0
      function Descendant() {
        useEffect(() => {
          mountCount += 1
        }, [])
        return <span data-testid="descendant">descendant</span>
      }

      const view = render(<GitHubTokenProvider><Descendant /></GitHubTokenProvider>)
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
      const initialClearCount = mockClearGitHubCache.mock.calls.length

      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-b', githubUsername: 'bob' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })
      view.rerender(<GitHubTokenProvider><Descendant /></GitHubTokenProvider>)
      await waitFor(() => expect(mockSetGitHubOAuthPrincipal).toHaveBeenCalledWith('account-b'))
      await waitFor(() => expect(mountCount).toBe(2))

      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
      view.rerender(<GitHubTokenProvider><Descendant /></GitHubTokenProvider>)
      await waitFor(() => expect(mockSetGitHubOAuthPrincipal).toHaveBeenCalledWith(null))
      expect(mockClearGitHubCache.mock.calls.length).toBeGreaterThan(initialClearCount + 1)
      await waitFor(() => expect(mountCount).toBe(3))
      expect(screen.getByTestId('descendant')).toBeInTheDocument()
    })

    it('keeps descendants gated after failed sign-out cleanup while OAuth remains active', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })

      render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())

      act(() => window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT)))
      await waitFor(() => expect(screen.queryByTestId('descendant')).toBeNull())

      act(() => notifyPrivateRepositoryAccessRevocationFinished(false))
      expect(screen.queryByTestId('descendant')).toBeNull()
    })

    it('keeps descendants gated until a successful sign-out changes the OAuth session', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })

      const view = render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())

      act(() => notifyPrivateRepositoryAccessRevoked())
      await waitFor(() => expect(screen.queryByTestId('descendant')).toBeNull())
      act(() => notifyPrivateRepositoryAccessRevocationFinished(true))
      expect(screen.queryByTestId('descendant')).toBeNull()

      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
      view.rerender(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
    })
  })

  // -----------------------------------------------------------------------
  // setToken
  // -----------------------------------------------------------------------

  describe('setToken', () => {
    it('persists token to localStorage and syncs to PAT module', async () => {
      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      await act(async () => {
        await result.current.setToken('ghp_new_token')
      })

      expect(result.current.token).toBe('ghp_new_token')
      expect(mockSaveGitHubToken).toHaveBeenCalledWith('ghp_new_token')
      expect(mockSetGitHubPAT).toHaveBeenCalledWith('ghp_new_token')
      expect(mockClearGitHubCache).toHaveBeenCalled()
    })

    it('gates descendants for the full credential cleanup transition', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      let finishCleanup!: () => void
      mockClearPrivateRepoCache.mockReturnValueOnce(new Promise<void>(resolve => { finishCleanup = resolve }))
      let context: ReturnType<typeof useGitHubToken> | null = null
      const view = render(
        <GitHubTokenProvider>
          <TokenConsumer onContext={value => { context = value }} />
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('credential-descendant')).toBeInTheDocument())

      let transition!: Promise<void>
      act(() => { transition = context!.setToken('ghp_new') })
      expect(screen.queryByTestId('credential-descendant')).toBeNull()

      finishCleanup()
      await act(async () => { await transition })
      expect(screen.getByTestId('credential-descendant')).toBeInTheDocument()
      expect(context!.token).toBe('ghp_new')
      view.unmount()
    })

    it('revokes the prior PAT when credential cleanup fails', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      mockClearPrivateRepoCache.mockRejectedValueOnce(new Error('cleanup failed'))
      let context: ReturnType<typeof useGitHubToken> | null = null
      render(
        <GitHubTokenProvider>
          <TokenConsumer onContext={value => { context = value }} />
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('credential-descendant')).toBeInTheDocument())

      await act(async () => { await expect(context!.setToken('ghp_new')).rejects.toThrow('cleanup failed') })
      expect(context!.token).toBeNull()
      expect(screen.getByTestId('credential-descendant')).toBeInTheDocument()
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)
      expect(mockSaveGitHubToken).not.toHaveBeenCalledWith('ghp_new')
    })
  })

  // -----------------------------------------------------------------------
  // validateToken
  // -----------------------------------------------------------------------

  describe('validateToken', () => {
    it('calls validation endpoint and updates state on success', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_valid')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            valid: true,
            login: 'octocat',
            scopes: ['repo'],
          }),
      })

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let validateResult: boolean
      await act(async () => {
        validateResult = await result.current.validateToken()
      })

      expect(validateResult!).toBe(true)
      expect(result.current.isValid).toBe(true)
      expect(result.current.username).toBe('octocat')
      expect(result.current.scopes).toEqual(['repo'])
    })

    it('sets isValid=false when validation returns valid=false', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_invalid')

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            valid: false,
            error: 'Invalid token',
          }),
      })

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let validateResult: boolean
      await act(async () => {
        validateResult = await result.current.validateToken()
      })

      expect(validateResult!).toBe(false)
      expect(result.current.isValid).toBe(false)
      expect(result.current.username).toBeNull()
    })

    it('returns false when no token is set', async () => {
      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let validateResult: boolean
      await act(async () => {
        validateResult = await result.current.validateToken()
      })

      expect(validateResult!).toBe(false)
    })

    it('handles network errors gracefully', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_network_err')

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      await act(async () => {
        await result.current.validateToken()
      })

      expect(result.current.isValid).toBe(false)
    })

    it('ignores a validation response for a token that was replaced', async () => {
      let resolveValidation!: (value: unknown) => void
      globalThis.fetch = vi.fn().mockReturnValue(new Promise(resolve => { resolveValidation = resolve }))
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let validation!: Promise<boolean>
      act(() => { validation = result.current.validateToken() })
      await act(async () => { await result.current.setToken('ghp_new') })
      resolveValidation({ ok: true, json: () => Promise.resolve({ valid: true, login: 'old-user', scopes: ['repo'] }) })
      await act(async () => { await validation })

      expect(result.current.token).toBe('ghp_new')
      expect(result.current.isValid).toBeNull()
      expect(result.current.username).toBeNull()
      expect(result.current.isValidating).toBe(false)
    })

    it('ignores parsed validation data when the token changes while the response body is parsing', async () => {
      let resolveBody!: (value: unknown) => void
      let signalBodyParsing!: () => void
      const bodyParsing = new Promise<void>(resolve => { signalBodyParsing = resolve })
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => {
          signalBodyParsing()
          return new Promise(resolve => { resolveBody = resolve })
        },
      })
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let validation!: Promise<boolean>
      act(() => { validation = result.current.validateToken() })
      await act(async () => { await bodyParsing })
      await act(async () => { await result.current.setToken('ghp_new') })
      resolveBody({ valid: true, login: 'old-user', scopes: ['repo'] })
      await act(async () => { await validation })

      expect(result.current.token).toBe('ghp_new')
      expect(result.current.isValid).toBeNull()
      expect(result.current.username).toBeNull()
      expect(result.current.scopes).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // removeToken
  // -----------------------------------------------------------------------

  describe('removeToken', () => {
    it('clears state, localStorage, and PAT module', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_to_remove')

      const { result } = renderHook(() => useGitHubToken(), { wrapper })

      await waitFor(() => expect(result.current.isHydrated).toBe(true))
      expect(result.current.token).toBe('ghp_to_remove')

      await act(async () => {
        await result.current.removeToken()
      })

      expect(result.current.token).toBeNull()
      expect(result.current.isValid).toBeNull()
      expect(result.current.username).toBeNull()
      expect(result.current.scopes).toEqual([])
      expect(mockRemoveGitHubToken).toHaveBeenCalled()
      expect(mockSetGitHubPAT).toHaveBeenCalledWith(null)
      expect(mockClearGitHubCache).toHaveBeenCalled()
    })

    it('removes the PAT even when private repository cleanup fails', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_to_remove')
      mockClearPrivateRepoCache.mockRejectedValueOnce(new Error('cleanup failed'))

      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      let removal!: Promise<void>
      await act(async () => {
        removal = result.current.removeToken()
        await expect(removal).rejects.toThrow('cleanup failed')
      })

      expect(result.current.token).toBeNull()
      expect(mockRemoveGitHubToken).toHaveBeenCalledOnce()
    })

    it('does not restore the prior PAT when browser storage removal fails', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_to_remove')
      mockRemoveGitHubToken.mockImplementationOnce(() => { throw new Error('storage failed') })

      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      await act(async () => { await expect(result.current.removeToken()).rejects.toThrow('storage failed') })
      expect(result.current.token).toBeNull()
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)
      expect(mockSaveGitHubToken).not.toHaveBeenCalled()
    })

    it('removes stored PAT before reporting private cleanup failure', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_to_remove')
      mockClearPrivateRepoCache.mockRejectedValueOnce(new Error('cleanup failed'))

      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      await act(async () => { await expect(result.current.removeToken()).rejects.toThrow('cleanup failed') })
      expect(result.current.token).toBeNull()
      expect(mockRemoveGitHubToken).toHaveBeenCalledOnce()
      expect(mockSaveGitHubToken).not.toHaveBeenCalled()
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)
    })

    it('revokes local credential state immediately on a cross-tab revocation', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY,
          newValue: 'other-tab-revocation',
        }))
      })

      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)
      expect(clearScanCache).toHaveBeenCalled()
      expect(clearValidationCache).toHaveBeenCalled()
      expect(mockClearPrivateRepoCache).toHaveBeenCalled()
    })

    it('keeps descendants gated after a cross-tab OAuth revocation until the session changes', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { githubUserId: 'account-a', githubUsername: 'alice' },
          expires: '2099-01-01T00:00:00.000Z',
        },
        status: 'authenticated',
      })
      const view = render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())

      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY,
          newValue: 'other-tab-sign-out',
        }))
      })
      await waitFor(() => expect(mockClearPrivateRepoCache).toHaveBeenCalled())
      expect(screen.queryByTestId('descendant')).toBeNull()

      mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
      view.rerender(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
    })

    it('accepts a cross-tab replacement only after private cleanup completes', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      let finishCleanup!: () => void
      mockClearPrivateRepoCache.mockReturnValueOnce(
        new Promise<void>(resolve => { finishCleanup = resolve }),
      )
      const { result } = renderHook(() => useGitHubToken(), { wrapper })
      await waitFor(() => expect(result.current.isHydrated).toBe(true))

      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'repolens:github-token',
          oldValue: 'ghp_old',
          newValue: 'ghp_new',
        }))
      })
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)

      finishCleanup()
      await waitFor(() => expect(result.current.token).toBe('ghp_new'))
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith('ghp_new')
      expect(mockSaveGitHubToken).not.toHaveBeenCalledWith('ghp_new')
    })

    it('releases descendants after a cross-tab PAT removal completes', async () => {
      mockLoadGitHubToken.mockReturnValue('ghp_old')
      const view = render(
        <GitHubTokenProvider>
          <span data-testid="descendant">descendant</span>
        </GitHubTokenProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())

      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'repolens:github-token',
          oldValue: 'ghp_old',
          newValue: null,
        }))
      })
      await waitFor(() => expect(screen.getByTestId('descendant')).toBeInTheDocument())
      expect(mockSetGitHubPAT).toHaveBeenLastCalledWith(null)
      view.unmount()
    })
  })

  // -----------------------------------------------------------------------
  // useGitHubToken outside provider
  // -----------------------------------------------------------------------

  it('throws when used outside GitHubTokenProvider', () => {
    // Suppress React error boundary noise in the test output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useGitHubToken())
    }).toThrow('useGitHubToken must be used within a GitHubTokenProvider')

    spy.mockRestore()
  })
})
