import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/providers', () => ({
  useApp: vi.fn(() => ({ selectedFilePath: null, setSelectedFilePath: vi.fn() })),
  useRepository: vi.fn(() => ({
    repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
    getTabCache: vi.fn(() => undefined),
    setTabCache: vi.fn(),
  })),
  useRepositoryData: vi.fn(() => ({
    repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
    repositorySession: { id: 1, signal: new AbortController().signal },
  })),
  useRepositoryActions: vi.fn(() => ({
    getTabCache: vi.fn(() => undefined),
    setTabCache: vi.fn(),
    isRepositorySessionCurrent: vi.fn(() => true),
  })),
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
}))

vi.mock('@/lib/github/client', () => ({
  fetchBlameViaProxy: vi.fn(),
  fetchCommitsViaProxy: vi.fn().mockResolvedValue([]),
  fetchFileCommitsViaProxy: vi.fn(),
  fetchCommitDetailViaProxy: vi.fn(),
  fetchFileViaProxy: vi.fn(),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { useApp, useRepository, useRepositoryData, useRepositoryActions } from '@/providers'
import { fetchCommitsViaProxy } from '@/lib/github/client'
import { GitHistoryPanel } from '../git-history-panel'

function makeCommit(sha: string, message: string) {
  return {
    sha,
    message,
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2024-06-15T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2024-06-15T10:00:00Z',
    url: `https://github.com/test/repo/commit/${sha}`,
    authorLogin: 'alice',
    authorAvatarUrl: null,
    parents: [{ sha: 'parent' }],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocks to default values for each test
    vi.mocked(useApp).mockReturnValue({
      selectedFilePath: null,
      setSelectedFilePath: vi.fn(),
    } as unknown as ReturnType<typeof useApp>)
    vi.mocked(useRepository).mockReturnValue({
      repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
      getTabCache: vi.fn(() => undefined),
      setTabCache: vi.fn(),
    } as unknown as ReturnType<typeof useRepository>)
    vi.mocked(useRepositoryData).mockReturnValue({
      repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
    } as unknown as ReturnType<typeof useRepositoryData>)
    vi.mocked(useRepositoryActions).mockReturnValue({
      getTabCache: vi.fn(() => undefined),
      setTabCache: vi.fn(),
      isRepositorySessionCurrent: vi.fn(() => true),
    } as unknown as ReturnType<typeof useRepositoryActions>)
    vi.mocked(fetchCommitsViaProxy).mockResolvedValue([])
  })

  it('shows view mode tabs including Timeline', () => {
    render(<GitHistoryPanel />)

    expect(screen.getByRole('button', { name: /timeline/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /blame/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /file history/i })).toBeInTheDocument()
  })

  it('shows "no repo" message when repo is null', () => {
    vi.mocked(useRepository).mockReturnValue({ repo: null, getTabCache: vi.fn(() => undefined), setTabCache: vi.fn() } as unknown as ReturnType<typeof useRepository>)
    vi.mocked(useRepositoryData).mockReturnValue({ repo: null } as unknown as ReturnType<typeof useRepositoryData>)

    render(<GitHistoryPanel />)

    expect(screen.getByText(/connect a repository/i)).toBeInTheDocument()
  })

  it('disables file-specific tabs when no file is selected', () => {
    render(<GitHistoryPanel />)

    const blameBtn = screen.getByRole('button', { name: /blame/i })
    const fileHistoryBtn = screen.getByRole('button', { name: /file history/i })

    expect(blameBtn).toBeDisabled()
    expect(fileHistoryBtn).toBeDisabled()
  })

  it('enables file-specific tabs when a file is selected', () => {
    vi.mocked(useApp).mockReturnValue({
      selectedFilePath: 'src/index.ts',
      setSelectedFilePath: vi.fn(),
    } as unknown as ReturnType<typeof useApp>)

    render(<GitHistoryPanel />)

    const blameBtn = screen.getByRole('button', { name: /blame/i })
    const fileHistoryBtn = screen.getByRole('button', { name: /file history/i })

    expect(blameBtn).not.toBeDisabled()
    expect(fileHistoryBtn).not.toBeDisabled()
  })

  it('shows cursor-not-allowed on disabled tabs', () => {
    render(<GitHistoryPanel />)

    const blameBtn = screen.getByRole('button', { name: /blame/i })
    expect(blameBtn.className).toContain('cursor-not-allowed')
  })

  it('shows hint to select a file when on timeline with no file', () => {
    render(<GitHistoryPanel />)

    expect(
      screen.getByText(/select a file in code tab to unlock file history and blame/i),
    ).toBeInTheDocument()
  })

  it('hides hint when a file is selected', () => {
    vi.mocked(useApp).mockReturnValue({
      selectedFilePath: 'src/index.ts',
      setSelectedFilePath: vi.fn(),
    } as unknown as ReturnType<typeof useApp>)

    render(<GitHistoryPanel />)

    expect(
      screen.queryByText(/select a file in code tab to unlock file history and blame/i),
    ).not.toBeInTheDocument()
  })

  it('shows tooltip text for disabled tabs', () => {
    render(<GitHistoryPanel />)

    // Tooltip content is rendered (mocked as simple span)
    const tooltipTexts = screen.getAllByText(/select a file in the code tab first/i)
    expect(tooltipTexts.length).toBeGreaterThan(0)
  })

  it('loads the new repository timeline after switching from a populated repository', async () => {
    const firstSession = { id: 1, signal: new AbortController().signal }
    const secondSession = { id: 2, signal: new AbortController().signal }
    let repositoryData = {
      repo: { owner: 'first-owner', name: 'first-repo', defaultBranch: 'main' },
      repositorySession: firstSession,
    }
    vi.mocked(useRepositoryData).mockImplementation(
      () => repositoryData as ReturnType<typeof useRepositoryData>,
    )
    vi.mocked(useRepositoryActions).mockReturnValue({
      getTabCache: vi.fn(() => undefined),
      setTabCache: vi.fn(),
      isRepositorySessionCurrent: vi.fn(
        candidate => candidate === repositoryData.repositorySession,
      ),
    } as unknown as ReturnType<typeof useRepositoryActions>)
    vi.mocked(fetchCommitsViaProxy)
      .mockResolvedValueOnce([makeCommit('first-sha', 'First repository commit')])
      .mockResolvedValueOnce([makeCommit('second-sha', 'Second repository commit')])

    const { rerender } = render(<GitHistoryPanel />)
    expect(await screen.findByText('First repository commit')).toBeInTheDocument()

    repositoryData = {
      repo: { owner: 'second-owner', name: 'second-repo', defaultBranch: 'main' },
      repositorySession: secondSession,
    }
    rerender(<GitHistoryPanel />)

    expect(await screen.findByText('Second repository commit')).toBeInTheDocument()
    expect(screen.queryByText('First repository commit')).not.toBeInTheDocument()
    expect(fetchCommitsViaProxy).toHaveBeenLastCalledWith(
      'second-owner',
      'second-repo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('loads the new repository timeline when the previous request is still pending', async () => {
    const firstSession = { id: 1, signal: new AbortController().signal }
    const secondSession = { id: 2, signal: new AbortController().signal }
    let repositoryData = {
      repo: { owner: 'first-owner', name: 'first-repo', defaultBranch: 'main' },
      repositorySession: firstSession,
    }
    let resolveFirstRequest!: (commits: ReturnType<typeof makeCommit>[]) => void
    const firstRequest = new Promise<ReturnType<typeof makeCommit>[]>(resolve => {
      resolveFirstRequest = resolve
    })
    vi.mocked(useRepositoryData).mockImplementation(
      () => repositoryData as ReturnType<typeof useRepositoryData>,
    )
    vi.mocked(useRepositoryActions).mockReturnValue({
      getTabCache: vi.fn(() => undefined),
      setTabCache: vi.fn(),
      isRepositorySessionCurrent: vi.fn(
        candidate => candidate === repositoryData.repositorySession,
      ),
    } as unknown as ReturnType<typeof useRepositoryActions>)
    vi.mocked(fetchCommitsViaProxy)
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce([makeCommit('second-sha', 'Second repository commit')])

    const { rerender } = render(<GitHistoryPanel />)
    await waitFor(() => expect(fetchCommitsViaProxy).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /insights/i }))
    expect(fetchCommitsViaProxy).toHaveBeenCalledTimes(1)

    repositoryData = {
      repo: { owner: 'second-owner', name: 'second-repo', defaultBranch: 'main' },
      repositorySession: secondSession,
    }
    rerender(<GitHistoryPanel />)

    expect(await screen.findByText('Second repository commit')).toBeInTheDocument()
    expect(fetchCommitsViaProxy).toHaveBeenLastCalledWith(
      'second-owner',
      'second-repo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await act(async () => {
      resolveFirstRequest([makeCommit('first-sha', 'First repository commit')])
      await firstRequest
    })
    expect(screen.queryByText('First repository commit')).not.toBeInTheDocument()
  })
})
