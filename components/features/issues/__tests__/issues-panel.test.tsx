import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock child components and providers
vi.mock('../issue-summary', () => ({
  IssueSummary: () => <div data-testid="issue-summary">summary</div>,
}))
vi.mock('../issue-filters', () => ({
  IssueFilters: ({ onFilterChange, onViewModeChange }: any) => (
    <div data-testid="issue-filters">
      <button onClick={() => onFilterChange('security')}>filter-security</button>
      <button onClick={() => onViewModeChange('compliance')}>view-compliance</button>
    </div>
  ),
}))
vi.mock('../issue-list', () => ({
  IssueList: ({ groupedByFile, filteredIssueCount }: any) => (
    <div data-testid="issue-list">
      <span data-testid="issue-count">{filteredIssueCount ?? 0}</span>
      {groupedByFile && Array.from((groupedByFile as Map<string, any[]>).entries()).map(([file, issues]) =>
        issues.map((i: any) => <div key={i.id}>{i.title}</div>)
      )}
    </div>
  ),
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
  scanInWorker: vi.fn((codeIndex: any) => {
    if (codeIndex.totalFiles === 0) return Promise.resolve(null)
    return Promise.resolve(mockScanResults)
  }),
  generateFix: vi.fn(() => null),
  validateFinding: vi.fn().mockResolvedValue({
    issueId: 'issue-1',
    verdict: 'true-positive',
    confidence: 'high',
    reasoning: 'Confirmed',
  }),
}))

vi.mock('@/providers', () => ({
  useRepository: () => ({
    codebaseAnalysis: { files: new Map() },
    getTabCache: () => undefined,
    setTabCache: () => {},
  }),
  useRepositoryData: () => ({
    codebaseAnalysis: { files: new Map() },
  }),
  useRepositoryActions: () => ({
    getTabCache: () => undefined,
    setTabCache: () => {},
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
  const actual = await importOriginal() as any
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
  })

  it('renders issue summary', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as any} />)
    await waitFor(() => {
      expect(screen.getByTestId('issue-summary')).toBeInTheDocument()
    })
  })

  it('renders issue filters', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as any} />)
    await waitFor(() => {
      expect(screen.getByTestId('issue-filters')).toBeInTheDocument()
    })
  })

  it('renders issue list with filtered issues', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as any} />)
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
    const { container } = render(<IssuesPanel codeIndex={emptyIndex as any} />)
    // With 0 files, scanInWorker is not called → no issue-summary rendered
    expect(screen.queryByTestId('issue-summary')).not.toBeInTheDocument()
  })
})
