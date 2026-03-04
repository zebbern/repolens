import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIssue } from '@/lib/code/scanner/types'

// Mock tooltip to avoid Radix portal issues in jsdom
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tooltip-content">{children}</span>,
}))

// Mock IssueDetails so IssueCard tests stay focused on the card itself
vi.mock('./issue-details', () => ({
  IssueDetails: () => <div data-testid="issue-details">details-rendered</div>,
}))

import { IssueCard } from './issue-card'

function createIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'issue-1',
    ruleId: 'no-eval',
    category: 'security',
    severity: 'critical',
    title: 'Dangerous eval() usage',
    description: 'Using eval() can lead to code injection',
    file: 'src/utils.ts',
    line: 42,
    column: 5,
    snippet: 'eval(userInput)',
    cwe: 'CWE-95',
    owasp: 'A03:2021',
    riskScore: 8.5,
    cvssVector: 'S:critical/C:high/CAT:security/CWE:95',
    ...overrides,
  }
}

const baseProps = {
  isExpanded: false,
  onToggle: vi.fn(),
  onNavigateToFile: vi.fn(),
  showFix: false,
  fix: undefined as null | undefined,
  validationResult: undefined,
  isValidating: false,
  hasValidApiKey: true,
  onShowFix: vi.fn(),
  onValidate: vi.fn(),
}

describe('IssueCard', () => {
  it('renders the issue title', () => {
    render(<IssueCard issue={createIssue()} {...baseProps} />)
    expect(screen.getByText('Dangerous eval() usage')).toBeInTheDocument()
  })

  it('renders severity icon via the role=button area', () => {
    render(<IssueCard issue={createIssue()} {...baseProps} />)
    const btn = screen.getByRole('button', { name: /dangerous eval/i })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders risk score badge', () => {
    render(<IssueCard issue={createIssue({ riskScore: 8.5 })} {...baseProps} />)
    expect(screen.getByText('8.5')).toBeInTheDocument()
  })

  it('does not render risk score badge when riskScore is undefined', () => {
    render(<IssueCard issue={createIssue({ riskScore: undefined })} {...baseProps} />)
    expect(screen.queryByText('8.5')).not.toBeInTheDocument()
  })

  it('renders CWE badge when cwe is provided', () => {
    render(<IssueCard issue={createIssue({ cwe: 'CWE-95' })} {...baseProps} />)
    expect(screen.getByText('CWE-95')).toBeInTheDocument()
  })

  it('does not render CWE badge when cwe is undefined', () => {
    render(<IssueCard issue={createIssue({ cwe: undefined })} {...baseProps} />)
    expect(screen.queryByText('CWE-95')).not.toBeInTheDocument()
  })

  it('renders line number button when line > 0', () => {
    render(<IssueCard issue={createIssue({ line: 42 })} {...baseProps} />)
    expect(screen.getByText('L42')).toBeInTheDocument()
  })

  it('does not render line number button when line is 0', () => {
    render(<IssueCard issue={createIssue({ line: 0 })} {...baseProps} />)
    expect(screen.queryByText('L0')).not.toBeInTheDocument()
  })

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(<IssueCard issue={createIssue()} {...baseProps} onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: /dangerous eval/i }))
    expect(onToggle).toHaveBeenCalledWith('issue-1')
  })

  it('calls onNavigateToFile when line button is clicked', async () => {
    const onNavigateToFile = vi.fn()
    const user = userEvent.setup()
    render(
      <IssueCard
        issue={createIssue({ file: 'src/utils.ts', line: 42 })}
        {...baseProps}
        onNavigateToFile={onNavigateToFile}
      />,
    )

    await user.click(screen.getByText('L42'))
    expect(onNavigateToFile).toHaveBeenCalledWith('src/utils.ts')
  })

  it('renders IssueDetails when expanded', () => {
    render(<IssueCard issue={createIssue()} {...baseProps} isExpanded={true} />)
    expect(screen.getByTestId('issue-details')).toBeInTheDocument()
  })

  it('does not render IssueDetails when collapsed', () => {
    render(<IssueCard issue={createIssue()} {...baseProps} isExpanded={false} />)
    expect(screen.queryByTestId('issue-details')).not.toBeInTheDocument()
  })

  it('sets aria-expanded correctly', () => {
    const { rerender } = render(
      <IssueCard issue={createIssue()} {...baseProps} isExpanded={false} />,
    )
    expect(screen.getByRole('button', { name: /dangerous eval/i })).toHaveAttribute('aria-expanded', 'false')

    rerender(<IssueCard issue={createIssue()} {...baseProps} isExpanded={true} />)
    expect(screen.getByRole('button', { name: /dangerous eval/i })).toHaveAttribute('aria-expanded', 'true')
  })
})
