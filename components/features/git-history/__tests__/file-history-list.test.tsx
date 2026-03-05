import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileHistoryList } from '../file-history-list'

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

function makeCommit(sha: string, date: string) {
  return {
    sha,
    message: `commit ${sha}`,
    authorName: 'Alice',
    authorEmail: 'alice@test.com',
    authorDate: date,
    committerName: 'Alice',
    committerDate: date,
    url: '',
    authorLogin: 'alice',
    authorAvatarUrl: null,
    parents: [{ sha: 'parent' }],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileHistoryList', () => {
  const onCommitClick = vi.fn()

  it('renders commits grouped by date', () => {
    render(
      <FileHistoryList
        commits={[
          makeCommit('a', '2024-06-15T10:00:00Z'),
          makeCommit('b', '2024-06-14T10:00:00Z'),
        ]}
        filePath="src/index.ts"
        onCommitClick={onCommitClick}
        isLoading={false}
      />,
    )

    // File path header
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    // Commit count
    expect(screen.getByText('2 commits')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    render(
      <FileHistoryList
        commits={[]}
        filePath="file.ts"
        onCommitClick={onCommitClick}
        isLoading={true}
      />,
    )

    expect(screen.getByText(/loading file history/i)).toBeInTheDocument()
  })

  it('shows empty state when no commits', () => {
    render(
      <FileHistoryList
        commits={[]}
        filePath="file.ts"
        onCommitClick={onCommitClick}
        isLoading={false}
      />,
    )

    expect(screen.getByText('No commits found for this file')).toBeInTheDocument()
  })

  it('calls onCommitClick when a commit is clicked', async () => {
    const user = userEvent.setup()

    render(
      <FileHistoryList
        commits={[makeCommit('xyz', '2024-06-15T10:00:00Z')]}
        filePath="file.ts"
        onCommitClick={onCommitClick}
        isLoading={false}
      />,
    )

    const commitButton = screen.getAllByRole('button').find(b => b.textContent?.includes('Alice'))!
    await user.click(commitButton)

    expect(onCommitClick).toHaveBeenCalledWith('xyz')
  })
})
