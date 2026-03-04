import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIssue } from '@/lib/code/scanner/types'
import type { FixSuggestion, ValidationResult } from '@/lib/code/scanner'
import { IssueList } from './issue-list'

// Mock IssueCard to isolate IssueList tests
vi.mock('./issue-card', () => ({
  IssueCard: ({ issue }: { issue: CodeIssue }) => (
    <div data-testid={`issue-card-${issue.id}`}>{issue.title}</div>
  ),
}))

function createIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'issue-1',
    ruleId: 'no-eval',
    category: 'security',
    severity: 'critical',
    title: 'Eval usage',
    description: 'Bad eval',
    file: 'src/utils.ts',
    line: 10,
    column: 1,
    snippet: 'eval(x)',
    ...overrides,
  }
}

const baseProps = {
  isGroupExpanded: () => false,
  toggleGroup: vi.fn(),
  expandedIssues: new Set<string>(),
  toggleIssue: vi.fn(),
  onNavigateToFile: vi.fn(),
  ruleOverflow: new Map<string, number>(),
  scannedFiles: 100,
  languagesDetected: ['TypeScript'],
  totalIssueCount: 0,
  filteredIssueCount: 0,
  showFix: new Set<string>(),
  fixCache: new Map<string, FixSuggestion | null>(),
  validationResults: new Map<string, ValidationResult>(),
  validatingIssues: new Set<string>(),
  hasValidApiKey: true,
  onShowFix: vi.fn(),
  onValidate: vi.fn(),
}

describe('IssueList', () => {
  describe('empty state', () => {
    it('shows "Clean Codebase" when totalIssueCount is 0', () => {
      render(
        <IssueList
          {...baseProps}
          groupedByFile={new Map()}
          totalIssueCount={0}
          filteredIssueCount={0}
        />,
      )
      expect(screen.getByText('Clean Codebase')).toBeInTheDocument()
      expect(screen.getByText(/No security risks/)).toBeInTheDocument()
    })

    it('shows "No issues match this filter" when total > 0 but filtered is 0', () => {
      render(
        <IssueList
          {...baseProps}
          groupedByFile={new Map()}
          totalIssueCount={10}
          filteredIssueCount={0}
        />,
      )
      expect(screen.getByText('No issues match this filter')).toBeInTheDocument()
    })
  })

  describe('file groups', () => {
    it('renders file group headers', () => {
      const issues = [createIssue({ id: 'i1', file: 'src/a.ts' })]
      const grouped = new Map([['src/a.ts', issues]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
        />,
      )
      expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    })

    it('renders issue count badge per file', () => {
      const issues = [
        createIssue({ id: 'i1', file: 'src/a.ts' }),
        createIssue({ id: 'i2', file: 'src/a.ts' }),
      ]
      const grouped = new Map([['src/a.ts', issues]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={2}
          totalIssueCount={2}
        />,
      )
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('calls toggleGroup when file header is clicked', async () => {
      const toggleGroup = vi.fn()
      const user = userEvent.setup()
      const grouped = new Map([['src/a.ts', [createIssue()]]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
          toggleGroup={toggleGroup}
        />,
      )

      await user.click(screen.getByText('src/a.ts'))
      expect(toggleGroup).toHaveBeenCalledWith('src/a.ts')
    })

    it('shows IssueCards when group is expanded', () => {
      const issue = createIssue({ id: 'i1', title: 'Test issue' })
      const grouped = new Map([['src/a.ts', [issue]]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
          isGroupExpanded={() => true}
        />,
      )
      expect(screen.getByTestId('issue-card-i1')).toBeInTheDocument()
    })

    it('hides IssueCards when group is collapsed', () => {
      const issue = createIssue({ id: 'i1' })
      const grouped = new Map([['src/a.ts', [issue]]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
          isGroupExpanded={() => false}
        />,
      )
      expect(screen.queryByTestId('issue-card-i1')).not.toBeInTheDocument()
    })

    it('sets aria-expanded on file group button', () => {
      const grouped = new Map([['src/a.ts', [createIssue()]]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
          isGroupExpanded={(file) => file === 'src/a.ts'}
        />,
      )
      const btn = screen.getByRole('button', { expanded: true })
      expect(btn).toBeInTheDocument()
    })
  })

  describe('rule overflow', () => {
    it('renders overflow notice when ruleOverflow has entries', () => {
      const ruleOverflow = new Map([['no-eval', 5], ['sql-injection', 3]])
      const grouped = new Map([['src/a.ts', [createIssue()]]])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={1}
          totalIssueCount={1}
          ruleOverflow={ruleOverflow}
        />,
      )
      expect(screen.getByText(/Showing top 15 per rule/)).toBeInTheDocument()
      expect(screen.getByText('no-eval')).toBeInTheDocument()
      expect(screen.getByText('(+5)')).toBeInTheDocument()
    })
  })

  describe('multiple file groups', () => {
    it('renders multiple file groups sorted by map insertion order', () => {
      const grouped = new Map([
        ['src/a.ts', [createIssue({ id: 'i1', file: 'src/a.ts', severity: 'critical' })]],
        ['src/b.ts', [createIssue({ id: 'i2', file: 'src/b.ts', severity: 'info' })]],
      ])
      render(
        <IssueList
          {...baseProps}
          groupedByFile={grouped}
          filteredIssueCount={2}
          totalIssueCount={2}
        />,
      )
      expect(screen.getByText('src/a.ts')).toBeInTheDocument()
      expect(screen.getByText('src/b.ts')).toBeInTheDocument()
    })
  })
})
