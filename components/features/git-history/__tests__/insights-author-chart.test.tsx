import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AuthorHoursEstimate } from '@/lib/git-history'

const heights: number[] = []
vi.mock('@/lib/lazy-recharts', () => ({
  loadRecharts: vi.fn(() => Promise.resolve({
    ResponsiveContainer: ({ height, children }: { height: number; children: React.ReactNode }) => { heights.push(height); return <div data-testid="chart" data-height={height}>{children}</div> },
    BarChart: ({ children, data }: { children: React.ReactNode; data: { author: string }[] }) => <div>{data.map((entry) => <span key={entry.author}>{entry.author}</span>)}{children}</div>,
    Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
    Tooltip: () => null,
  })),
}))

import { InsightsAuthorChart } from '../insights-author-chart'

function estimate(i: number): AuthorHoursEstimate {
  return { author: `Author${i}`, login: null, avatarUrl: null, totalHours: 30 - i, sessions: [], commitCount: 1, activeDays: 1, avgHoursPerActiveDay: 1, mostProductiveDay: 'Monday', longestStreakDays: 1 }
}

describe('InsightsAuthorChart disclosures', () => {
  it('expands contributors and recomputes chart height', async () => {
    heights.length = 0
    render(<InsightsAuthorChart estimates={Array.from({ length: 17 }, (_, i) => estimate(i))} />)
    await waitFor(() => expect(screen.getByText('and 2 more contributors')).toBeInTheDocument())
    const more = screen.getByRole('button', { name: 'View 2 more contributors' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(screen.getByText('Author16')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer contributors' })).toHaveAttribute('aria-expanded', 'true')
    expect(heights).toContain(17 * 32)
  })
})
