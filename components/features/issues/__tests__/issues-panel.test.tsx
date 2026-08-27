import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIndex } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'

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
  ComplianceDashboard: ({ onNavigateToFile }: { onNavigateToFile?: (path: string) => void }) => (
    <div data-testid="compliance-dashboard">
      compliance
      <button onClick={() => onNavigateToFile?.('src/compliance.ts')}>open-compliance-file</button>
    </div>
  ),
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
  ruleOverflow: new Map<string, number>(),
  scannedFiles: 2,
  languagesDetected: ['typescript'],
  healthGrade: { grade: 'B', score: 75, label: 'Good' },
  diagnostics: {
    engines: {} as Record<string, string>,
    failures: [] as Array<{ engine: string; message: string; paths?: string[] }>,
  },
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
    repo: { fullName: 'owner/repo' },
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
    mockScanResults.diagnostics.engines = {}
    mockScanResults.diagnostics.failures = []
    mockScanResults.ruleOverflow = new Map()
  })

  async function openIssuesView() {
    await userEvent.click(await screen.findByRole('tab', { name: 'Issues' }))
  }

  it('does not publish a single validation that completes after a session switch', async () => {
    let resolve!: (value: unknown) => void
    issuesHarness.validateFinding.mockReturnValue(new Promise(done => { resolve = done }))
    const { rerender } = render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await openIssuesView()
    await waitFor(() => expect(screen.getByText('validate-first')).toBeInTheDocument())
    await userEvent.click(screen.getByText('validate-first'))

    issuesHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    resolve({ issueId: 'issue-1', verdict: 'true-positive', confidence: 'high', reasoning: 'stale' })

    await waitFor(() => expect(issuesHarness.latestProps?.validationResults.size).toBe(0))
  })

  it('publishes a visible validation failure without an AI call when source is absent', async () => {
    const index: CodeIndex = {
      ...mockCodeIndex,
      files: new Map([['src/utils.ts', {
        path: 'src/utils.ts', name: 'utils.ts', lineCount: 1,
      }]]),
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: new InMemoryContentStore(),
    }
    render(<IssuesPanel codeIndex={index} />)
    await openIssuesView()
    await userEvent.click(await screen.findByText('validate-first'))

    await waitFor(() => expect(issuesHarness.latestProps?.validationResults.size).toBe(1))
    expect(issuesHarness.validateFinding).not.toHaveBeenCalled()
    expect(issuesHarness.latestProps?.validationResults.get('issue-1')).toMatchObject({
      verdict: 'uncertain',
      reasoning: 'File content unavailable for src/utils.ts',
    })
  })

  it('allows validation of a genuine empty file', async () => {
    const index: CodeIndex = {
      ...mockCodeIndex,
      files: new Map([['src/utils.ts', {
        path: 'src/utils.ts', name: 'utils.ts', content: '', lineCount: 1,
      }]]),
      totalLines: 1,
      isIndexing: false,
      meta: new Map(),
      contentStore: new InMemoryContentStore(new Map([['src/utils.ts', '']])),
    }
    render(<IssuesPanel codeIndex={index} />)
    await openIssuesView()
    await userEvent.click(await screen.findByText('validate-first'))

    await waitFor(() => expect(issuesHarness.validateFinding).toHaveBeenCalled())
    expect(issuesHarness.validateFinding.mock.calls[0][1]).toBe('')
    expect(issuesHarness.validateFinding.mock.calls[0][2]).toMatchObject({
      repositoryKey: 'owner/repo',
      repositorySessionId: '1',
    })
  })

  it('does not publish a single fix whose content read completes after a session switch', async () => {
    let resolve!: (value: string) => void
    const index = {
      ...mockCodeIndex,
      files: new Map([['src/utils.ts', { content: undefined, path: 'src/utils.ts' }]]),
      contentStore: { get: () => new Promise<string>(done => { resolve = done }) },
    }
    const { rerender } = render(<IssuesPanel codeIndex={index as unknown as CodeIndex} />)
    await openIssuesView()
    await waitFor(() => expect(screen.getByText('fix-first')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix-first'))

    issuesHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<IssuesPanel codeIndex={index as unknown as CodeIndex} />)
    resolve('eval(x)')

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'))
    await openIssuesView()
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

  it('separates overview, findings, and compliance into three accessible views', async () => {
    const user = userEvent.setup()
    mockScanResults.ruleOverflow = new Map([['no-eval', 5], ['sql-injection', 3]])
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Overview', 'Issues', 'Compliance'])
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('issue-summary')).toBeInTheDocument()
    expect(screen.getByText('Showing top 15 findings per rule.')).toBeInTheDocument()
    expect(screen.getByText('5 additional matches')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-list')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Issues' }))
    expect(screen.getByTestId('issue-filters')).toBeInTheDocument()
    expect(screen.getByTestId('issue-list')).toBeInTheDocument()
    expect(screen.queryByText('Showing top 15 findings per rule.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Compliance' }))
    expect(screen.getByTestId('compliance-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-list')).not.toBeInTheDocument()
  })

  it('keeps tab navigation keyboard accessible with roving focus', async () => {
    const user = userEvent.setup()
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)

    const overview = await screen.findByRole('tab', { name: 'Overview' })
    const issues = screen.getByRole('tab', { name: 'Issues' })
    const compliance = screen.getByRole('tab', { name: 'Compliance' })

    expect(overview).toHaveAttribute('tabindex', '0')
    expect(issues).toHaveAttribute('tabindex', '-1')
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(issues).toHaveFocus()
    expect(issues).toHaveAttribute('aria-selected', 'true')
    expect(issues).toHaveAttribute('tabindex', '0')

    await user.keyboard('{End}')
    expect(compliance).toHaveFocus()
    expect(compliance).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(overview).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(compliance).toHaveFocus()
    await user.keyboard('{Home}')
    expect(overview).toHaveFocus()
  })

  it('opens a compliance finding in the code view', async () => {
    const onNavigateToFile = vi.fn()
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} onNavigateToFile={onNavigateToFile} />)

    await userEvent.click(await screen.findByRole('tab', { name: 'Compliance' }))
    await userEvent.click(screen.getByRole('button', { name: 'open-compliance-file' }))

    expect(onNavigateToFile).toHaveBeenCalledWith('src/compliance.ts')
  })

  it('returns to Overview when the repository session changes', async () => {
    const { rerender } = render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Compliance' }))
    expect(screen.getByRole('tab', { name: 'Compliance' })).toHaveAttribute('aria-selected', 'true')

    issuesHarness.session = { id: 2, signal: new AbortController().signal }
    rerender(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('reports incomplete coverage when a best-effort scan engine fails', async () => {
    mockScanResults.diagnostics.engines = { 'tree-sitter': 'failed' }
    mockScanResults.diagnostics.failures = [
      { engine: 'tree-sitter', message: 'grammar unavailable' },
    ]

    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)

    expect(await screen.findByText('Issue scan coverage incomplete')).toBeInTheDocument()
    expect(screen.getByText(/tree-sitter: grammar unavailable/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Compliance' }))
    expect(screen.getByText('Issue scan coverage incomplete')).toBeInTheDocument()
  })

  it('reveals every path omitted from an incomplete engine summary', async () => {
    const user = userEvent.setup()
    const paths = Array.from({ length: 6 }, (_, index) => `src/unavailable-${index}.tsx`)
    mockScanResults.diagnostics.engines = { taint: 'partial' }
    mockScanResults.diagnostics.failures = [{
      engine: 'taint',
      message: 'Taint parsing unavailable for 6 files.',
      paths,
    }]

    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)

    expect(await screen.findByText('src/unavailable-0.tsx')).toBeInTheDocument()
    expect(screen.getByText('src/unavailable-2.tsx')).toBeInTheDocument()
    expect(screen.queryByText('src/unavailable-3.tsx')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View 3 more taint paths' }))

    expect(screen.getByText('src/unavailable-3.tsx')).toBeInTheDocument()
    expect(screen.getByText('src/unavailable-5.tsx')).toBeInTheDocument()
    const pathsRegion = screen.getByRole('region', { name: 'taint unavailable paths' })
    expect(pathsRegion).toHaveClass('max-h-32', 'overflow-y-auto')
    expect(pathsRegion.querySelectorAll('li')).toHaveLength(paths.length)

    await user.click(screen.getByRole('button', { name: 'Show fewer taint paths' }))
    expect(screen.queryByText('src/unavailable-3.tsx')).not.toBeInTheDocument()
  })

  it('renders issue filters', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await openIssuesView()
    await waitFor(() => {
      expect(screen.getByTestId('issue-filters')).toBeInTheDocument()
    })
  })

  it('renders issue list with filtered issues', async () => {
    render(<IssuesPanel codeIndex={mockCodeIndex as unknown as CodeIndex} />)
    await openIssuesView()
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
