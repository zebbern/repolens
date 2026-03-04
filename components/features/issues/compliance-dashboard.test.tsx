import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIndex } from '@/lib/code/code-index'
import type { ScanResults } from '@/lib/code/scanner/types'
import type { ComplianceReport } from '@/lib/code/scanner'

// Mock the scanner barrel
const mockGetAllRules = vi.fn(() => [])
const mockGenerateComplianceReport = vi.fn((): ComplianceReport => ({
  owaspCoverage: {
    'A01': {
      name: 'Broken Access Control',
      description: 'Access control failures',
      covered: true,
      ruleCount: 3,
      findingCount: 1,
      ruleIds: ['r1'],
      status: 'pass' as const,
    },
  },
  cweCoverage: {
    'CWE-79': {
      name: 'XSS',
      description: 'Cross-site scripting',
      covered: true,
      ruleCount: 2,
      findingCount: 0,
      ruleIds: ['r2'],
      status: 'pass' as const,
    },
  },
  overallOwaspPercent: 80,
  overallCwePercent: 60,
  generatedAt: '2026-01-01T00:00:00.000Z',
}))
const mockExportComplianceJSON = vi.fn(() => '{}')

vi.mock('@/lib/code/issue-scanner', () => ({
  generateComplianceReport: (...args: unknown[]) => mockGenerateComplianceReport(...args),
  exportComplianceJSON: (...args: unknown[]) => mockExportComplianceJSON(...args),
  getAllRules: () => mockGetAllRules(),
  lookupCves: vi.fn().mockResolvedValue({ results: [], scannedPackages: 0, vulnerablePackages: 0, lookupErrors: [] }),
}))

// Mock child components to isolate compliance dashboard tests
vi.mock('./coverage-chart', () => ({
  CoverageSummaryChart: ({ report }: { report: ComplianceReport }) => (
    <div data-testid="coverage-chart">OWASP: {report.overallOwaspPercent}%</div>
  ),
}))
vi.mock('./coverage-grid', () => ({
  CoverageGrid: ({ title }: { title: string }) => <div data-testid="coverage-grid">{title}</div>,
}))
vi.mock('./cve-section', () => ({
  CveSection: () => <div data-testid="cve-section">CVE Section</div>,
}))

import { ComplianceDashboard } from './compliance-dashboard'

function createCodeIndex(): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
    isIndexing: false,
  }
}

function createScanResults(): ScanResults {
  return {
    issues: [],
    summary: { total: 0, critical: 0, warning: 0, info: 0, bySecurity: 0, byBadPractice: 0, byReliability: 0 },
    healthGrade: 'A',
    healthScore: 100,
    ruleOverflow: new Map(),
    languagesDetected: [],
    rulesEvaluated: 0,
    scannedFiles: 0,
    scannedAt: new Date(),
    securityGrade: 'A',
    qualityGrade: 'A',
    issuesPerKloc: 0,
    isPartialScan: false,
    suppressionCount: 0,
  }
}

describe('ComplianceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Compliance Dashboard heading', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    expect(screen.getByText('Compliance Dashboard')).toBeInTheDocument()
  })

  it('renders the Export JSON button', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    expect(screen.getByText('Export JSON')).toBeInTheDocument()
  })

  it('renders CoverageSummaryChart with report data', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    expect(screen.getByTestId('coverage-chart')).toBeInTheDocument()
    expect(screen.getByText('OWASP: 80%')).toBeInTheDocument()
  })

  it('renders both CoverageGrid instances for OWASP and CWE', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    const grids = screen.getAllByTestId('coverage-grid')
    expect(grids).toHaveLength(2)
    expect(screen.getByText('OWASP Top 10 — 2025')).toBeInTheDocument()
    expect(screen.getByText('CWE Top 25 — 2024')).toBeInTheDocument()
  })

  it('renders CveSection', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    expect(screen.getByTestId('cve-section')).toBeInTheDocument()
  })

  it('renders the generated timestamp', () => {
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    expect(screen.getByText(/Generated:/)).toBeInTheDocument()
  })

  it('calls generateComplianceReport with scanResults', () => {
    const scanResults = createScanResults()
    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={scanResults} />)
    expect(mockGenerateComplianceReport).toHaveBeenCalledWith(scanResults, [])
  })

  it('calls exportComplianceJSON when Export JSON is clicked', async () => {
    const user = userEvent.setup()
    // Mock DOM APIs for download
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = createObjectURL
    globalThis.URL.revokeObjectURL = revokeObjectURL

    render(<ComplianceDashboard codeIndex={createCodeIndex()} scanResults={createScanResults()} />)
    await user.click(screen.getByText('Export JSON'))
    expect(mockExportComplianceJSON).toHaveBeenCalled()
  })
})
