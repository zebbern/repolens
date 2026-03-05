import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { BlameData } from '@/types/git-history'
import type { BlameAuthorStats } from '@/lib/git-history'
import { BlameView } from '../blame-view'
import { useVirtualizer } from '@tanstack/react-virtual'

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
// Mock @tanstack/react-virtual — jsdom has no scroll container dimensions
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 20,
        end: (i + 1) * 20,
        size: 20,
        key: i,
      })),
    getTotalSize: () => count * 20,
  })),
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

  it('calls useVirtualizer with correct count', () => {
    const content = 'line1\nline2\nline3\nline4\nline5'

    render(
      <BlameView
        data={{
          blameData: makeBlameData(5),
          filePath: "src/app.ts",
          fileContent: content,
          blameStats: defaultStats,
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // useVirtualizer should have been called with count = number of lines
    expect(useVirtualizer).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
    )
  })

  it('renders empty file without crashing', () => {
    const emptyBlame: BlameData = { ranges: [], isTruncated: false, byteSize: 0 }

    render(
      <BlameView
        data={{
          blameData: emptyBlame,
          filePath: "empty.ts",
          fileContent: '',
          blameStats: [],
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // Empty file results in 1 line (empty string split produces [''])
    expect(useVirtualizer).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
    )
  })

  it('renders single-line file correctly', () => {
    const singleLineBlame: BlameData = {
      ranges: [{
        startingLine: 1,
        endingLine: 1,
        age: 1,
        commit: {
          oid: 'def5678',
          abbreviatedOid: 'def5678',
          message: 'init',
          messageHeadline: 'init',
          committedDate: '2024-01-01T00:00:00Z',
          url: '',
          author: {
            name: 'Bob',
            email: 'bob@test.com',
            date: '2024-01-01T00:00:00Z',
            user: { login: 'bob', avatarUrl: '' },
          },
        },
      }],
      isTruncated: false,
      byteSize: 10,
    }

    render(
      <BlameView
        data={{
          blameData: singleLineBlame,
          filePath: "single.ts",
          fileContent: 'export default 42',
          blameStats: [{ name: 'Bob', email: 'bob@test.com', login: 'bob', avatarUrl: null, lineCount: 1, percentage: 100 }],
        }}
        onCommitClick={onCommitClick}
      />,
    )

    expect(screen.getByText('export default 42')).toBeInTheDocument()
    expect(screen.getByText('def5678')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('calls onCommitClick when a commit annotation is clicked', () => {
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

    // Find the commit hash button and click it
    const commitButton = screen.getByText('abc1234').closest('button')
    expect(commitButton).toBeTruthy()
    fireEvent.click(commitButton!)

    expect(onCommitClick).toHaveBeenCalledWith('abc1234')
  })

  it('renders line numbers for all virtual items', () => {
    render(
      <BlameView
        data={{
          blameData: makeBlameData(4),
          filePath: "src/app.ts",
          fileContent: 'a\nb\nc\nd',
          blameStats: defaultStats,
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // Line numbers should be rendered
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders lines without blame info with empty gutter', () => {
    // Blame only covers line 1, but file has 3 lines
    const partialBlame: BlameData = {
      ranges: [{
        startingLine: 1,
        endingLine: 1,
        age: 2,
        commit: {
          oid: 'xyz9999',
          abbreviatedOid: 'xyz9999',
          message: 'partial',
          messageHeadline: 'partial',
          committedDate: '2024-03-01T00:00:00Z',
          url: '',
          author: {
            name: 'Carol',
            email: 'carol@test.com',
            date: '2024-03-01T00:00:00Z',
            user: { login: 'carol', avatarUrl: '' },
          },
        },
      }],
      isTruncated: false,
      byteSize: 50,
    }

    render(
      <BlameView
        data={{
          blameData: partialBlame,
          filePath: "partial.ts",
          fileContent: 'first\nsecond\nthird',
          blameStats: [{ name: 'Carol', email: 'carol@test.com', login: 'carol', avatarUrl: null, lineCount: 1, percentage: 100 }],
        }}
        onCommitClick={onCommitClick}
      />,
    )

    // All lines rendered
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByText('third')).toBeInTheDocument()
    // Only the first line has commit annotation
    expect(screen.getByText('xyz9999')).toBeInTheDocument()
  })
})
