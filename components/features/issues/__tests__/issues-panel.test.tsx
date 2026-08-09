import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIndex } from '@/lib/code/code-index'

interface MockIssue {
  id: string
  title: string
}
const issuesHarness = vi.hoisted(() => {
  const harness = {
    session: { id: 1, signal: new AbortController().signal },
    isCurrent: (session: unknown) => session === harness.session,
    validateFinding: vi.fn(),
    latestProps: null as null | {
    onValidate: (issue: never) => void
    onShowFix: (issue: never) => void
    validationResults: Map<string, unknown>
    fixCache: Map<string, unknown>
    showFix: Set<string>
    },
  }
  return harness
})

// Mock child components and providers
vi.mock('../issue-summary', () => ({
  IssueSummary: () => <div data-testid="issue-summary">summary</div>,
}))
vi.mock('../issue-filters', () => ({
  IssueFilters: ({ onFilterChange, onViewModeChange }: {
    onFilterChange: (category: string) => void
    onViewModeChange: (mode: string) => void
  }) => (
    <div data-testid="issue-filters">
      <button onClick={() => onFilterChange('security')}>filter-security</button>
      <button onClick={() => onViewModeChange('compliance')}>view-compliance</button>
    </div>
  ),
}))
vi.mock('../issue-list', () => ({
  IssueList: (props: {
    groupedByFile?: Map<string, MockIssue[]>
    filteredIssueCount?: number
    onValidate: (issue: never) => void
    onShowFix: (issue: never) => void
    validationResults: Map<string, unknown>
    fixCache: Map<string, unknown>
    showFix: Set<string>
  }) => {
    issuesHarness.latestProps = props
    const { groupedByFile, filteredIssueCount } = props
    return (
    <div data-testid="issue-list">
      <span data-testid="issue-count">{filteredIssueCount ?? 0}</span>
      {groupedByFile && Array.from(groupedByFile.entries()).map(([file, issues]) =>
        issues.map(issue => <div key={`${file}:${issue.id}`}>{issue.title}</div>)
      )}
      <button onClick={() => props.onValidate(mockScanResults.issues[0] as never)}>validate-first</button>
      <button onClick={() => props.onShowFix(mockScanResults.issues[0] as never)}>fix-first</button>
    </div>
    )
  },
}))
vi.mock('../compliance-dashboard', () => ({
  ComplianceDashboard: () => <div data-testid="compliance-dashboard">compliance</div>,
}))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockScanResults = {
  issues: [
    {
      id: 'issue-1',
      ruleId: 'no-eval',
      category: 'security',
      severity: 'critical',
      title: 'Dangerous eval usage',
      description: 'eval is dangerous',
      file: 'src/utils.ts',
      line: 10,
      column: 1,
      snippet: 'eval(x)',
      confidence: 'high',
    },
    {
      id: 'issue-2',
      ruleId: 'no-console',
      category: 'bad-practice',
      severity: 'warning',
      title: 'Console log usage',
      description: 'Avoid console.log',
      file: 'src/helper.ts',
      line: 20,
      column: 1,
      snippet: 'console.log(x)',
      confidence: 'high',
    },
    {
      id: 'issue-3',
      ruleId: 'info-rule',
      category: 'reliability',
      severity: 'info',
      title: 'Info issue',
      description: 'Informational',
      file: 'src/misc.ts',
      line: 5,
      column: 1,
      snippet: 'foo()',
      confidence: 'high',
    },
  ],
  summary: { total: 3, critical: 1, warning: 1, info: 1 },
  ruleOverflow: false,
  scannedFiles: 2,
  languagesDetected: ['typescript'],
  healthGrade: { grade: 'B', score: 75, label: 'Good' },
}

vi.mock('@/lib/code/issue-scanner', () => ({
  scanInWorker: vi.fn((codeIndex: { totalFiles: number }) => {
    if (codeIndex.totalFiles === 0) return Promise.resolve(null)
    return Promise.resolve(mockScanResults)
  }),
  generateFix: vi.fn(() => null),
  validateFinding: (...args: unknown[]) => issuesHarness.validateFinding(...args),
}))

vi.mock('@/providers', () => ({
  useRepository: () => ({
    codebaseAnalysis: { files: new Map() },
    getTabCache: () => undefined,
    setTabCache: () => {},
  }),
  useRepositoryData: () => ({
    codebaseAnalysis: { files: new Map() },
    repositorySession: issuesHarness.session,
  }),
  useRepositoryActions: () => ({
    getTabCache: () => undefined,
    setTabCache: () => {},
    isRepositorySessionCurrent: issuesHarness.isCurrent,
  }),
}))

vi.mock('@/providers/api-keys-provider', () => ({
  useAPIKeys: () => ({
    selectedProvider: 'openai',
    selectedModel: { id: 'gpt-4o', name: 'GPT-4o' },
    apiKeys: { openai: { key: 'sk-test', isValid: true } },
  }),
}))

vi.mock('@/hooks/use-batch-operations', () => ({
  useBatchOperations: () => ({
    batchValidate: vi.fn(),
    batchGenerateFixes: vi.fn(),
    cancelBatch: vi.fn(),
    validationProgress: null,
    fixProgress: null,
    hasValidApiKey: true,
  }),
}))

import { IssuesPanel } from '../issues-panel'

// Also mock issue-types to avoid import issues
vi.mock('../issue-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../issue-types')>()
  return {
    ...actual,
    isSupplyChainIssue: vi.fn(() => false),
    isStructuralIssue: vi.fn(() => false),
  }
})

const mockCodeIndex = {
  totalFiles: 10,
  files: new Map([
    ['src/utils.ts', { content: 'eval(x)', path: 'src/utils.ts' }],
    ['src/helper.ts', { content: 'console.log(x)', path: 'src/helper.ts' }],
  ]),
}

describe('IssuesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    issuesHarness.session = { id: 1, signal: new AbortController().signal }
    issuesHarness.latestProps = null
    issuesHarness.validateFinding.mockResolvedValue({ issueId: 'issue-1', verdict: 'true-positive', confidence: 'high', reasoning: 'Confirmed' })
  })

  it('does not publish a single validation that completes after a session switch', async () => {
    let resolve!: (value: unknown) => void
    issuesHarness.validateFinding.mockReturnValue(new Promise(done => { resolve = done }))
    const { rerender } = render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await waitFor(() => expect(screen.getByText('validate-first')).toBeInTheDocument())
    await userEvent.click(screen.getByText('validate-first'))

    issuesHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    resolve({ issueId: 'issue-1', verdict: 'true-positive', confidence: 'high', reasoning: 'stale' })

    await waitFor(() => expect(issuesHarness.latestProps?.validationResults.size).toBe(0))
  })

  it('does not publish a single fix whose content read completes after a session switch', async () => {
    let resolve!: (value: string) => void
    const index = {
      ...mockCodeIndex,
      files: new Map([['src/utils.ts', { content: '', path: 'src/utils.ts' }]]),
      contentStore: { get: () => new Promise<string>(done => { resolve = done }) },
    }
    const { rerender } = render(<IssuesPanel codeIndex={index as unknown as CodeIndex} />)
    await waitFor(() => expect(screen.getByText('fix-first')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix-first'))

    issuesHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<IssuesPanel codeIndex={index as unknown as CodeIndex} />)
    resolve('eval(x)')

    await waitFor(() => {
      expect(issuesHarness.latestProps?.fixCache.size).toBe(0)
      expect(issuesHarness.latestProps?.showFix.size).toBe(0)
    })
  })

  it('renders issue summary', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await waitFor(() => {
      expect(screen.getByTestId('issue-summary')).toBeInTheDocument()
    })
  })

  it('renders issue filters', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await waitFor(() => {
      expect(screen.getByTestId('issue-filters')).toBeInTheDocument()
    })
  })

  it('renders issue list with filtered issues', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await waitFor(() => {
      expect(screen.getByTestId('issue-list')).toBeInTheDocument()
    })
    // By default, hideInfo is true, so info-level issues are hidden
    expect(screen.getByText('Dangerous eval usage')).toBeInTheDocument()
    expect(screen.getByText('Console log usage')).toBeInTheDocument()
    expect(screen.queryByText('Info issue')).not.toBeInTheDocument()
  })

  it('renders nothing useful when codeIndex has zero files', () => {
    const emptyIndex = { totalFiles: 0, files: new Map() }
    const { container } = render(<IssuesPanel codeIndex={emptyIndex as unknown as CodeIndex} />)
    // With 0 files, scanInWorker is not called → no issue-summary rendered
    expect(screen.queryByTestId('issue-summary')).not.toBeInTheDocument()
  })
})
