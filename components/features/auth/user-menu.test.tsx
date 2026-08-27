import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
  useSession: vi.fn(),
}))
vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))
vi.mock('@/lib/cache/repo-cache', () => ({
  clearPrivateRepoCache: vi.fn(),
}))
vi.mock('@/lib/github/client', () => ({ clearGitHubCache: vi.fn() }))
vi.mock('@/lib/code/scanner/scanner', () => ({ clearScanCache: vi.fn() }))
vi.mock('@/lib/code/scanner/ai-validator', () => ({ clearValidationCache: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { signOut, useSession } from 'next-auth/react'
import { clearPrivateRepoCache } from '@/lib/cache/repo-cache'
import { UserMenu } from './user-menu'
import { clearGitHubCache } from '@/lib/github/client'
import { clearScanCache } from '@/lib/code/scanner/scanner'
import { clearValidationCache } from '@/lib/code/scanner/ai-validator'
import { toast } from 'sonner'
import { PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT } from '@/lib/auth/credential-events'

const mockUseSession = vi.mocked(useSession)
const mockSignOut = vi.mocked(signOut)
const mockClearPrivateRepoCache = vi.mocked(clearPrivateRepoCache)

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClearPrivateRepoCache.mockResolvedValue(undefined)
    mockSignOut.mockResolvedValue({ url: 'http://localhost' })
  })

  it('renders nothing when there is no session', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: vi.fn(),
    })

    const { container } = render(<UserMenu />)
    expect(container.innerHTML).toBe('')
  })

  it('renders a next/image Image with correct props when githubAvatar is present', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: 'Octocat',
          githubUsername: 'octocat',
          githubAvatar: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
        expires: '2099-01-01',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<UserMenu />)
    const avatar = screen.getByAltText('octocat')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveAttribute(
      'src',
      'https://avatars.githubusercontent.com/u/1?v=4',
    )
    expect(avatar).toHaveAttribute('width', '20')
    expect(avatar).toHaveAttribute('height', '20')
  })

  it('renders fallback icon when githubAvatar is absent', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: 'Anon',
          githubUsername: undefined,
          githubAvatar: undefined,
        },
        expires: '2099-01-01',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<UserMenu />)
    // No img element, just the fallback icon button
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('revokes the OAuth session before waiting for private cache cleanup', async () => {
    const user = userEvent.setup()
    const finished: boolean[] = []
    const onFinished = (event: Event) => {
      finished.push((event as CustomEvent<{ success: boolean }>).detail.success)
    }
    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
    let finishCleanup!: () => void
    mockClearPrivateRepoCache.mockReturnValue(new Promise<void>(resolve => { finishCleanup = resolve }))
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Octocat', githubUsername: 'octocat' },
        expires: '2099-01-01',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /open user menu/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(mockClearPrivateRepoCache).toHaveBeenCalledOnce()
    expect(clearGitHubCache).toHaveBeenCalledOnce()
    expect(clearScanCache).toHaveBeenCalledOnce()
    expect(clearValidationCache).toHaveBeenCalledOnce()
    expect(mockSignOut).toHaveBeenCalledOnce()

    finishCleanup()
    await waitFor(() => expect(finished).toEqual([true]))
    window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
  })

  it('signs out even when private cleanup fails and reports incomplete cleanup', async () => {
    const user = userEvent.setup()
    const finished: boolean[] = []
    const onFinished = (event: Event) => {
      finished.push((event as CustomEvent<{ success: boolean }>).detail.success)
    }
    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
    mockClearPrivateRepoCache.mockRejectedValueOnce(new Error('coordination unavailable'))
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Octocat', githubUsername: 'octocat' },
        expires: '2099-01-01',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /open user menu/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(finished).toEqual([false])
    window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
  })

  it('releases the transition gate when sign-out itself fails', async () => {
    const user = userEvent.setup()
    const finished: boolean[] = []
    const onFinished = (event: Event) => {
      finished.push((event as CustomEvent<{ success: boolean }>).detail.success)
    }
    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
    mockSignOut.mockRejectedValueOnce(new Error('sign-out failed'))
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Octocat', githubUsername: 'octocat' },
        expires: '2099-01-01',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /open user menu/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(finished).toEqual([false])
    window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, onFinished)
  })
})
