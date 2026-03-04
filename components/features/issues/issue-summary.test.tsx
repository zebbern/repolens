import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ScanResults } from '@/lib/code/scanner/types'
import type { BatchProgress } from '@/hooks/use-batch-operations'

// Mock tooltip to avoid Radix portal issues in jsdom
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>,
}))

import { IssueSummary } from './issue-summary'

function createResults(overrides: Partial<ScanResults> = {}): ScanResults {
  return {
    issues: [],
    summary: {
      total: 20,
      critical: 5,
      warning: 10,
      info: 5,
      bySecurity: 8,
      byBadPractice: 6,
      byReliability: 4,
    },
    healthGrade: 'B',
    healthScore: 72,
    ruleOverflow: new Map(),
    languagesDetected: ['TypeScript', 'JavaScript'],
    rulesEvaluated: 268,
    scannedFiles: 150,
    scannedAt: new Date('2026-01-01'),
    securityGrade: 'C',
    qualityGrade: 'B',
    issuesPerKloc: 3.2,
    isPartialScan: false,
    suppressionCount: 2,
    projectRiskScore: 5.4,
    riskDistribution: { critical: 3, high: 5, medium: 8, low: 4 },
    ...overrides,
  }
}

const idleProgress: BatchProgress = {
  completed: 0,
  total: 0,
  failed: 0,
  inProgress: false,
}

const baseProps = {
  hasValidApiKey: true,
  filteredIssueCount: 20,
  criticalCount: 5,
  validationProgress: idleProgress,
  fixProgress: idleProgress,
  onBatchValidate: vi.fn(),
  onBatchGenerateFixes: vi.fn(),
  onCancelBatch: vi.fn(),
}

describe('IssueSummary', () => {
  it('renders the Code Analysis title', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.getByText('Code Analysis')).toBeInTheDocument()
  })

  it('renders health grade badge', () => {
    render(<IssueSummary results={createResults({ healthGrade: 'B', qualityGrade: 'C' })} {...baseProps} />)
    // healthGrade 'B' and qualityGrade 'C' are different to avoid ambiguity
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('72/100')).toBeInTheDocument()
  })

  it('renders project risk score badge', () => {
    render(<IssueSummary results={createResults({ projectRiskScore: 5.4 })} {...baseProps} />)
    expect(screen.getByText('5.4')).toBeInTheDocument()
  })

  it('does not render project risk badge when projectRiskScore is undefined', () => {
    render(
      <IssueSummary results={createResults({ projectRiskScore: undefined })} {...baseProps} />,
    )
    expect(screen.queryByText('5.4')).not.toBeInTheDocument()
  })

  it('renders risk distribution bar when riskDistribution exists', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.getByText('Risk Distribution')).toBeInTheDocument()
    expect(screen.getByText('3 critical risk')).toBeInTheDocument()
    expect(screen.getByText('5 high risk')).toBeInTheDocument()
    expect(screen.getByText('8 medium risk')).toBeInTheDocument()
    expect(screen.getByText('4 low risk')).toBeInTheDocument()
  })

  it('does not render risk distribution when riskDistribution is undefined', () => {
    render(
      <IssueSummary results={createResults({ riskDistribution: undefined })} {...baseProps} />,
    )
    expect(screen.queryByText('Risk Distribution')).not.toBeInTheDocument()
  })

  it('renders meta row with files scanned and rules evaluated', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.getByText('150 files scanned')).toBeInTheDocument()
    expect(screen.getByText('268 rules evaluated')).toBeInTheDocument()
    expect(screen.getByText('TypeScript, JavaScript')).toBeInTheDocument()
  })

  it('renders all four metric cards', () => {
    render(
      <IssueSummary
        results={createResults({ securityGrade: 'C', qualityGrade: 'B', issuesPerKloc: 3.2, suppressionCount: 2 })}
        {...baseProps}
      />,
    )
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('3.2')).toBeInTheDocument() // Issues per KLOC
    expect(screen.getByText('Issues / KLOC')).toBeInTheDocument()
    expect(screen.getByText('Suppressions')).toBeInTheDocument()
  })

  it('renders Validate Critical button', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.getByText('Validate Critical')).toBeInTheDocument()
  })

  it('renders Show All Fixes button', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.getByText('Show All Fixes')).toBeInTheDocument()
  })

  it('disables Validate Critical when no API key', () => {
    render(
      <IssueSummary results={createResults()} {...baseProps} hasValidApiKey={false} />,
    )
    const btn = screen.getByText('Validate Critical').closest('button')
    expect(btn).toBeDisabled()
  })

  it('disables Validate Critical when criticalCount is 0', () => {
    render(
      <IssueSummary results={createResults()} {...baseProps} criticalCount={0} />,
    )
    const btn = screen.getByText('Validate Critical').closest('button')
    expect(btn).toBeDisabled()
  })

  it('shows validation progress text when validation is in progress', () => {
    const progressProps = {
      ...baseProps,
      validationProgress: { completed: 2, total: 5, failed: 0, inProgress: true },
    }
    render(<IssueSummary results={createResults()} {...progressProps} />)
    expect(screen.getByText('Validating 2/5…')).toBeInTheDocument()
  })

  it('shows fix progress text when fix generation is in progress', () => {
    const progressProps = {
      ...baseProps,
      fixProgress: { completed: 3, total: 10, failed: 0, inProgress: true },
    }
    render(<IssueSummary results={createResults()} {...progressProps} />)
    expect(screen.getByText('Generating 3/10…')).toBeInTheDocument()
  })

  it('shows Cancel button during validation', () => {
    const progressProps = {
      ...baseProps,
      validationProgress: { completed: 1, total: 5, failed: 0, inProgress: true },
    }
    render(<IssueSummary results={createResults()} {...progressProps} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('does not show Cancel button when not in progress', () => {
    render(<IssueSummary results={createResults()} {...baseProps} />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('shows completion summary with failed count after validation', () => {
    const progressProps = {
      ...baseProps,
      validationProgress: { completed: 5, total: 5, failed: 2, inProgress: false },
    }
    render(<IssueSummary results={createResults()} {...progressProps} />)
    expect(screen.getByText('Validated 5')).toBeInTheDocument()
    expect(screen.getByText('(2 failed)')).toBeInTheDocument()
  })

  it('shows fixes found count after fix generation', () => {
    const progressProps = {
      ...baseProps,
      fixProgress: { completed: 10, total: 10, failed: 3, inProgress: false },
    }
    render(<IssueSummary results={createResults()} {...progressProps} />)
    expect(screen.getByText('7 fixes found')).toBeInTheDocument()
  })

  it('renders grade A with correct label', () => {
    render(
      <IssueSummary
        results={createResults({ healthGrade: 'A', securityGrade: 'A', qualityGrade: 'A' })}
        {...baseProps}
      />,
    )
    expect(screen.getByText('Excellent')).toBeInTheDocument()
  })

  it('renders grade F with correct label', () => {
    render(
      <IssueSummary
        results={createResults({ healthGrade: 'F' })}
        {...baseProps}
      />,
    )
    // Note: "Critical" in grade label context
    expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(1)
  })
})
