import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComplianceReport } from '@/lib/code/scanner'

// Mock Recharts — it relies on DOM measurement APIs unavailable in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Cell: () => null,
  Tooltip: () => null,
}))

import { CoverageSummaryChart } from './coverage-chart'

function createReport(overrides: Partial<ComplianceReport> = {}): ComplianceReport {
  return {
    owaspCoverage: {},
    cweCoverage: {},
    overallOwaspPercent: 75,
    overallCwePercent: 60,
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('CoverageSummaryChart', () => {
  it('renders the Coverage Overview heading', () => {
    render(<CoverageSummaryChart report={createReport()} />)
    expect(screen.getByText('Coverage Overview')).toBeInTheDocument()
  })

  it('renders aria-label with correct percentages', () => {
    render(
      <CoverageSummaryChart report={createReport({ overallOwaspPercent: 85, overallCwePercent: 42 })} />,
    )
    const chartContainer = screen.getByRole('img')
    expect(chartContainer).toHaveAttribute(
      'aria-label',
      expect.stringContaining('85%'),
    )
    expect(chartContainer).toHaveAttribute(
      'aria-label',
      expect.stringContaining('42%'),
    )
  })

  it('renders percentage badges', () => {
    render(<CoverageSummaryChart report={createReport({ overallOwaspPercent: 75, overallCwePercent: 60 })} />)
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('renders bar chart component', () => {
    render(<CoverageSummaryChart report={createReport()} />)
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })

  it('applies emerald colors for high coverage (>=80%)', () => {
    render(<CoverageSummaryChart report={createReport({ overallOwaspPercent: 90 })} />)
    const badge = screen.getByText('90%')
    // The badge parent should have emerald styling class
    expect(badge.closest('div')).toHaveClass('bg-emerald-500/10')
  })

  it('applies red colors for low coverage (<50%)', () => {
    render(<CoverageSummaryChart report={createReport({ overallCwePercent: 30 })} />)
    const badge = screen.getByText('30%')
    expect(badge.closest('div')).toHaveClass('bg-red-500/10')
  })
})
