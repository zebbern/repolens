import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CommitDetail } from '@/types/git-history'
import { CommitDetailView } from '../commit-detail-view'

// ---------------------------------------------------------------------------
// Mock tooltip primitives
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommitDetail(overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    sha: 'abc1234567890',
    message: 'feat: add new feature\n\nDetailed description here.',
    authorName: 'Alice',
    authorEmail: 'alice@test.com',
    authorDate: '2024-06-15T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2024-06-15T10:00:00Z',
    url: 'https://github.com/owner/repo/commit/abc1234567890',
    authorLogin: 'alice',
    authorAvatarUrl: null,
    parents: [{ sha: 'parent1' }],
    stats: { additions: 15, deletions: 5, total: 20 },
    files: [
      {
        filename: 'src/utils.ts',
        status: 'modified',
        additions: 10,
        deletions: 3,
        changes: 13,
        patch: '@@ -1,3 +1,4 @@\n context\n-old\n+new\n+added',
      },
      {
        filename: 'src/index.ts',
        status: 'added',
        additions: 5,
        deletions: 2,
        changes: 7,
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommitDetailView', () => {
  const onBack = vi.fn()

  it('renders commit headline and author info', () => {
    render(<CommitDetailView commit={makeCommitDetail()} onBack={onBack} />)

    expect(screen.getByText('feat: add new feature')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // Short SHA displayed
    expect(screen.getByText('abc1234')).toBeInTheDocument()
  })

  it('shows file list with status badges', () => {
    render(<CommitDetailView commit={makeCommitDetail()} onBack={onBack} />)

    expect(screen.getByText('src/utils.ts')).toBeInTheDocument()
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    // File status badges — use getAllByText since single letters appear in other text
    expect(screen.getAllByText('M').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(1)
  })

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    render(<CommitDetailView commit={makeCommitDetail()} onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows diff stats summary', () => {
    render(<CommitDetailView commit={makeCommitDetail()} onBack={onBack} />)

    expect(screen.getByText('+15')).toBeInTheDocument()
    expect(screen.getByText('-5')).toBeInTheDocument()
    expect(screen.getByText(/2 files changed/)).toBeInTheDocument()
  })
})
