import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BlameData } from '@/types/git-history'
import type { BlameAuthorStats } from '@/lib/git-history'
import { BlameView } from '../blame-view'

// ---------------------------------------------------------------------------
// Mock tooltip primitives to simplify testing
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlameData(lineCount = 3): BlameData {
  return {
    ranges: [
      {
        startingLine: 1,
        endingLine: lineCount,
        age: 3,
        commit: {
          oid: 'abc1234',
          abbreviatedOid: 'abc1234',
          message: 'fix: something',
          messageHeadline: 'fix: something',
          committedDate: '2024-06-15T10:00:00Z',
          url: '',
          author: {
            name: 'Alice',
            email: 'alice@test.com',
            date: '2024-06-15T10:00:00Z',
            user: { login: 'alice', avatarUrl: 'https://avatar.test/alice' },
          },
        },
      },
    ],
    isTruncated: false,
    byteSize: 100,
  }
}

const defaultStats: BlameAuthorStats[] = [
  { name: 'Alice', email: 'alice@test.com', login: 'alice', avatarUrl: 'https://avatar.test/alice', lineCount: 3, percentage: 100 },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlameView', () => {
  const onCommitClick = vi.fn()

  it('renders blame gutter with annotations', () => {
    render(
      <BlameView
        data={{
          blameData: makeBlameData(3),
          filePath: "src/index.ts",
          fileContent: 'line1\nline2\nline3',
          blameStats: defaultStats,
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // The commit hash should appear
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    // Author stats shown
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('(100%)')).toBeInTheDocument()
    // Code lines rendered
    expect(screen.getByText('line1')).toBeInTheDocument()
    expect(screen.getByText('line3')).toBeInTheDocument()
  })

  it('renders file name from filePath', () => {
    render(
      <BlameView
        data={{
          blameData: makeBlameData(),
          filePath: "src/utils/helpers.ts",
          fileContent: "a",
          blameStats: defaultStats,
        }}
        onCommitClick={onCommitClick}
      />,
    )

    expect(screen.getByText('helpers.ts')).toBeInTheDocument()
  })

  it('renders code lines even when no blame data covers them', () => {
    const emptyBlame: BlameData = { ranges: [], isTruncated: false, byteSize: 0 }

    render(
      <BlameView
        data={{
          blameData: emptyBlame,
          filePath: "file.ts",
          fileContent: 'hello\nworld',
          blameStats: [],
        }}
        onCommitClick={onCommitClick}
      />,
    )

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('shows multiple stats with "+N more" for many authors', () => {
    const manyStats: BlameAuthorStats[] = Array.from({ length: 7 }, (_, i) => ({
      name: `Author${i}`,
      email: `a${i}@test.com`,
      login: `a${i}`,
      avatarUrl: null,
      lineCount: 10 - i,
      percentage: 14.3,
    }))

    render(
      <BlameView
        data={{
          blameData: makeBlameData(10),
          filePath: "file.ts",
          fileContent: Array(10).fill('x').join('\n'),
          blameStats: manyStats,
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // First 5 shown, "+2 more" for the rest
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
