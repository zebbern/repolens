import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/providers', () => ({
  useApp: vi.fn(() => ({ selectedFilePath: null, setSelectedFilePath: vi.fn() })),
  useRepository: vi.fn(() => ({
    repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
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

import { useApp, useRepository } from '@/providers'
import { GitHistoryPanel } from '../git-history-panel'

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
    } as unknown as ReturnType<typeof useRepository>)
  })

  it('shows view mode tabs including Timeline', () => {
    render(<GitHistoryPanel />)

    expect(screen.getByRole('button', { name: /timeline/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /blame/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /file history/i })).toBeInTheDocument()
  })

  it('shows "no repo" message when repo is null', () => {
    vi.mocked(useRepository).mockReturnValue({ repo: null } as ReturnType<typeof useRepository>)

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
})
