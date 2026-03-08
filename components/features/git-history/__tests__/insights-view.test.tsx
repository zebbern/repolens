import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { GitHubCommit } from '@/types/repository'
import type { AuthorHoursEstimate, CodingSession } from '@/lib/git-history'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/lazy-recharts', () => ({
  loadRecharts: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/git-history', async () => {
  const actual = await vi.importActual<typeof import('@/lib/git-history')>('@/lib/git-history')
  return {
    ...actual,
    // Allow estimateHours to run normally but can be spied on
  }
})

import { InsightsView } from '../insights-view'
import { InsightsPulseCards } from '../insights-pulse-cards'
import { InsightsAuthorChart } from '../insights-author-chart'
import { InsightsHoursChart } from '../insights-hours-chart'
import { InsightsPunchcard } from '../insights-punchcard'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<GitHubCommit> = {}): GitHubCommit {
  return {
    sha: 'abc123',
    message: 'feat: add feature',
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2025-06-15T10:00:00Z',
    committerName: 'Alice',
    committerDate: '2025-06-15T10:00:00Z',
    url: 'https://github.com/test/repo/commit/abc123',
    authorLogin: 'alice',
    authorAvatarUrl: 'https://avatars.example.com/alice',
    parents: [{ sha: 'parent1' }],
    ...overrides,
  }
}

/** Build commits spread out enough to produce valid sessions (gap < 120 min). */
function makeCommitSeries(): GitHubCommit[] {
  return [
    makeCommit({
      sha: 'a1',
      authorDate: '2025-06-15T10:00:00Z',
      committerDate: '2025-06-15T10:00:00Z',
    }),
    makeCommit({
      sha: 'a2',
      authorDate: '2025-06-15T10:30:00Z',
      committerDate: '2025-06-15T10:30:00Z',
    }),
    makeCommit({
      sha: 'a3',
      authorDate: '2025-06-15T11:00:00Z',
      committerDate: '2025-06-15T11:00:00Z',
    }),
    makeCommit({
      sha: 'b1',
      authorName: 'Bob',
      authorEmail: 'bob@example.com',
      authorLogin: 'bob',
      authorAvatarUrl: null,
      authorDate: '2025-06-16T14:00:00Z',
      committerDate: '2025-06-16T14:00:00Z',
    }),
    makeCommit({
      sha: 'b2',
      authorName: 'Bob',
      authorEmail: 'bob@example.com',
      authorLogin: 'bob',
      authorAvatarUrl: null,
      authorDate: '2025-06-16T14:45:00Z',
      committerDate: '2025-06-16T14:45:00Z',
    }),
  ]
}

function makeEstimate(overrides: Partial<AuthorHoursEstimate> = {}): AuthorHoursEstimate {
  const session: CodingSession = {
    authorLogin: 'alice',
    authorName: 'Alice',
    startTime: '2025-06-15T10:00:00Z',
    endTime: '2025-06-15T11:00:00Z',
    durationMinutes: 60,
    commitCount: 3,
    linesChanged: 0,
  }

  return {
    author: 'Alice',
    login: 'alice',
    avatarUrl: 'https://avatars.example.com/alice',
    totalHours: 1.0,
    sessions: [session],
    commitCount: 3,
    activeDays: 1,
    avgHoursPerActiveDay: 1.0,
    mostProductiveDay: 'Sunday',
    longestStreakDays: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// InsightsView
// ---------------------------------------------------------------------------

describe('InsightsView', () => {
  it('renders empty state when given empty commits array', () => {
    render(<InsightsView commits={[]} />)

    expect(
      screen.getByText(/not enough commit data to generate insights/i),
    ).toBeInTheDocument()
  })

  it('renders all section containers when given valid commits', () => {
    const commits = makeCommitSeries()
    const { container } = render(<InsightsView commits={commits} />)

    // Pulse cards render stat labels
    expect(screen.getByText('Total Hours')).toBeInTheDocument()
    expect(screen.getByText('Contributors')).toBeInTheDocument()
    expect(screen.getByText('Active Days')).toBeInTheDocument()
    expect(screen.getByText('Avg Session')).toBeInTheDocument()

    // Punchcard renders its heading (it doesn't depend on Recharts)
    expect(screen.getByText('Activity Punchcard')).toBeInTheDocument()

    // Hours chart and Author chart show loading shimmers since loadRecharts returns null
    const shimmers = container.querySelectorAll('.animate-pulse')
    expect(shimmers.length).toBeGreaterThanOrEqual(2)
  })

  it('renders empty state when commits are all merge commits', () => {
    const mergeCommits = [
      makeCommit({
        sha: 'm1',
        message: 'Merge branch main',
        parents: [{ sha: 'p1' }, { sha: 'p2' }],
      }),
    ]
    render(<InsightsView commits={mergeCommits} />)

    expect(
      screen.getByText(/not enough commit data to generate insights/i),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InsightsPulseCards
// ---------------------------------------------------------------------------

describe('InsightsPulseCards', () => {
  it('displays correct stat values for multiple authors', () => {
    const estimates: AuthorHoursEstimate[] = [
      makeEstimate({
        author: 'Alice',
        totalHours: 2.5,
        activeDays: 3,
        sessions: [
          {
            authorLogin: 'alice',
            authorName: 'Alice',
            startTime: '2025-06-15T10:00:00Z',
            endTime: '2025-06-15T11:30:00Z',
            durationMinutes: 90,
            commitCount: 3,
            linesChanged: 0,
          },
          {
            authorLogin: 'alice',
            authorName: 'Alice',
            startTime: '2025-06-16T09:00:00Z',
            endTime: '2025-06-16T10:00:00Z',
            durationMinutes: 60,
            commitCount: 2,
            linesChanged: 0,
          },
        ],
      }),
      makeEstimate({
        author: 'Bob',
        login: 'bob',
        totalHours: 1.5,
        activeDays: 2,
        sessions: [
          {
            authorLogin: 'bob',
            authorName: 'Bob',
            startTime: '2025-06-16T14:00:00Z',
            endTime: '2025-06-16T15:30:00Z',
            durationMinutes: 90,
            commitCount: 2,
            linesChanged: 0,
          },
        ],
      }),
    ]

    render(<InsightsPulseCards estimates={estimates} />)

    // Total hours: 2.5 + 1.5 = 4.0
    expect(screen.getByText('~4.0h')).toBeInTheDocument()
    // Contributors: 2
    expect(screen.getByText('2')).toBeInTheDocument()
    // Active days: max(3, 2) = 3
    expect(screen.getByText('3')).toBeInTheDocument()
    // Avg session: (90 + 60 + 90) / 3 = 80 minutes
    expect(screen.getByText('~80m')).toBeInTheDocument()
  })

  it('handles single-author data correctly', () => {
    const estimates = [
      makeEstimate({
        totalHours: 0.5,
        activeDays: 1,
        sessions: [
          {
            authorLogin: 'alice',
            authorName: 'Alice',
            startTime: '2025-06-15T10:00:00Z',
            endTime: '2025-06-15T10:30:00Z',
            durationMinutes: 30,
            commitCount: 1,
            linesChanged: 0,
          },
        ],
      }),
    ]

    render(<InsightsPulseCards estimates={estimates} />)

    expect(screen.getByText('~0.5h')).toBeInTheDocument()
    // Both Contributors and Active Days show '1', verify via getAllByText
    expect(screen.getAllByText('1')).toHaveLength(2)
    expect(screen.getByText('~30m')).toBeInTheDocument()
    expect(screen.getByText('Total Hours')).toBeInTheDocument()
    expect(screen.getByText('Contributors')).toBeInTheDocument()
    expect(screen.getByText('Active Days')).toBeInTheDocument()
    expect(screen.getByText('Avg Session')).toBeInTheDocument()
  })

  it('handles zero sessions gracefully', () => {
    const estimates = [makeEstimate({ totalHours: 0, activeDays: 0, sessions: [] })]

    render(<InsightsPulseCards estimates={estimates} />)

    expect(screen.getByText('~0.0h')).toBeInTheDocument()
    expect(screen.getByText('~0m')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InsightsAuthorChart
// ---------------------------------------------------------------------------

describe('InsightsAuthorChart', () => {
  it('renders "No data to show" when estimates is empty', () => {
    render(<InsightsAuthorChart estimates={[]} />)

    expect(screen.getByText('No data to show')).toBeInTheDocument()
  })

  it('renders loading shimmer when recharts not yet loaded', () => {
    const { container } = render(
      <InsightsAuthorChart estimates={[makeEstimate()]} />,
    )

    // loadRecharts returns null, so the shimmer placeholder shows
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InsightsHoursChart
// ---------------------------------------------------------------------------

describe('InsightsHoursChart', () => {
  it('renders "No data to show" when estimates produce empty chart data', () => {
    const estimates = [makeEstimate({ sessions: [] })]
    render(<InsightsHoursChart estimates={estimates} />)

    expect(screen.getByText('No data to show')).toBeInTheDocument()
  })

  it('renders loading shimmer for valid data when recharts not loaded', () => {
    const { container } = render(
      <InsightsHoursChart estimates={[makeEstimate()]} />,
    )

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// InsightsPunchcard
// ---------------------------------------------------------------------------

describe('InsightsPunchcard', () => {
  it('renders "No data to show" when sessions produce zero hours', () => {
    const estimates = [makeEstimate({ sessions: [] })]
    render(<InsightsPunchcard estimates={estimates} />)

    expect(screen.getByText('No data to show')).toBeInTheDocument()
  })

  it('renders the punchcard grid with day labels', () => {
    render(<InsightsPunchcard estimates={[makeEstimate()]} />)

    expect(screen.getByText('Activity Punchcard')).toBeInTheDocument()
    expect(screen.getByText('Sun')).toBeInTheDocument()
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('Sat')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Integration: GitHistoryView type and VIEW_TABS
// ---------------------------------------------------------------------------

describe('Git History integration', () => {
  it('GitHistoryView type includes insights', async () => {
    // Type-level check: if this compiles, 'insights' is in the union
    const view: import('@/hooks/use-git-history').GitHistoryView = 'insights'
    expect(view).toBe('insights')
  })

  it('VIEW_TABS in git-history-panel includes Insights tab', async () => {
    // We import the panel and verify the Insights tab renders
    // This is already covered by git-history-panel tests but we verify explicitly
    vi.doMock('@/providers', () => ({
      useApp: vi.fn(() => ({ selectedFilePath: null, setSelectedFilePath: vi.fn() })),
      useRepository: vi.fn(() => ({
        repo: { owner: 'test', name: 'repo', defaultBranch: 'main' },
      })),
    }))

    vi.doMock('next-auth/react', () => ({
      useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
    }))

    vi.doMock('@/lib/github/client', () => ({
      fetchBlameViaProxy: vi.fn(),
      fetchCommitsViaProxy: vi.fn().mockResolvedValue([]),
      fetchFileCommitsViaProxy: vi.fn(),
      fetchCommitDetailViaProxy: vi.fn(),
      fetchFileViaProxy: vi.fn(),
    }))

    vi.doMock('@/components/ui/tooltip', () => ({
      Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
      TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    }))

    const { GitHistoryPanel } = await import('../git-history-panel')
    render(<GitHistoryPanel />)

    expect(screen.getByRole('button', { name: /insights/i })).toBeInTheDocument()
  })
})
