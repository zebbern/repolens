import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CommitGroup } from '@/lib/git-history'
import { CommitTimeline } from '../commit-timeline'

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

function makeGroup(overrides: Partial<CommitGroup> = {}): CommitGroup {
  return {
    dateKey: '2024-06-15',
    label: 'Today',
    commits: [
      {
        sha: 'abc',
        message: 'fix: something',
        authorName: 'Alice',
        authorEmail: 'alice@test.com',
        authorDate: '2024-06-15T10:00:00Z',
        committerName: 'Alice',
        committerDate: '2024-06-15T10:00:00Z',
        url: '',
        authorLogin: 'alice',
        authorAvatarUrl: null,
        parents: [{ sha: 'parent' }],
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommitTimeline', () => {
  const onCommitClick = vi.fn()
  const onLoadMore = vi.fn()

  it('renders commit groups with date labels', () => {
    render(
      <CommitTimeline
        commitGroups={[makeGroup()]}
        onCommitClick={onCommitClick}
        onLoadMore={onLoadMore}
        hasMore={false}
        isLoading={false}
      />,
    )

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows "Load more" button when hasMore is true', () => {
    render(
      <CommitTimeline
        commitGroups={[makeGroup()]}
        onCommitClick={onCommitClick}
        onLoadMore={onLoadMore}
        hasMore={true}
        isLoading={false}
      />,
    )

    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  it('fires onCommitClick when a commit row is clicked', async () => {
    const user = userEvent.setup()

    render(
      <CommitTimeline
        commitGroups={[makeGroup()]}
        onCommitClick={onCommitClick}
        onLoadMore={onLoadMore}
        hasMore={false}
        isLoading={false}
      />,
    )

    // The commit row is a button containing the author name
    const commitButtons = screen.getAllByRole('button')
    const commitButton = commitButtons.find(b => b.textContent?.includes('Alice'))!
    await user.click(commitButton)

    expect(onCommitClick).toHaveBeenCalledWith('abc')
  })

  it('shows empty state when no commits and not loading', () => {
    render(
      <CommitTimeline
        commitGroups={[]}
        onCommitClick={onCommitClick}
        onLoadMore={onLoadMore}
        hasMore={false}
        isLoading={false}
      />,
    )

    expect(screen.getByText('No commits found')).toBeInTheDocument()
  })
})
