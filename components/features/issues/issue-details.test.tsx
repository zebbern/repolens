import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIssue, ValidationResult, DiffLine, FixSuggestion } from '@/lib/code/scanner'

// Mock TaintFlowDiagram
vi.mock('./taint-flow-diagram', () => ({
  TaintFlowDiagram: ({ flow }: { flow: { source: string; sink: string } }) => (
    <div data-testid="taint-flow">{flow.source} → {flow.sink}</div>
  ),
}))

import { IssueDetails } from './issue-details'

function createIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'issue-1',
    ruleId: 'no-eval',
    category: 'security',
    severity: 'critical',
    title: 'Eval usage',
    description: 'Using eval() is dangerous and can lead to code injection.',
    file: 'src/utils.ts',
    line: 10,
    column: 1,
    snippet: 'eval(userInput)',
    suggestion: 'Use JSON.parse() instead.',
    cwe: 'CWE-95',
    owasp: 'A03:2021',
    learnMoreUrl: 'https://example.com/eval',
    ...overrides,
  }
}

function createFix(): FixSuggestion {
  return {
    ruleId: 'no-eval',
    original: 'eval(userInput)',
    fixed: 'JSON.parse(userInput)',
    explanation: 'Replace eval with JSON.parse for safe parsing.',
    confidence: 'auto',
    diffLines: [
      { type: 'remove', content: 'eval(userInput)', lineNumber: 10 },
      { type: 'add', content: 'JSON.parse(userInput)', lineNumber: 10 },
      { type: 'context', content: 'const result = data;', lineNumber: 11 },
    ],
  }
}

function createValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    issueId: 'issue-1',
    verdict: 'true-positive',
    confidence: 'high',
    reasoning: 'This is indeed a real vulnerability.',
    ...overrides,
  }
}

const baseProps = {
  showFix: false,
  fix: undefined as FixSuggestion | null | undefined,
  validationResult: undefined as ValidationResult | undefined,
  isValidating: false,
  hasValidApiKey: true,
  onShowFix: vi.fn(),
  onValidate: vi.fn(),
}

describe('IssueDetails', () => {
  it('renders the issue description', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} />)
    expect(screen.getByText(/Using eval\(\) is dangerous/)).toBeInTheDocument()
  })

  it('renders the code snippet', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} />)
    expect(screen.getByText('eval(userInput)')).toBeInTheDocument()
  })

  it('renders the suggestion when present', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} />)
    expect(screen.getByText('Use JSON.parse() instead.')).toBeInTheDocument()
  })

  it('does not render suggestion when absent', () => {
    render(<IssueDetails issue={createIssue({ suggestion: undefined })} {...baseProps} />)
    expect(screen.queryByText(/Fix:/)).not.toBeInTheDocument()
  })

  it('renders TaintFlowDiagram when taintFlow is present', () => {
    const issue = createIssue({
      taintFlow: {
        source: 'req.body',
        sink: 'db.query',
        path: ['req.body', 'userData', 'db.query'],
        startLine: 10,
        endLine: 20,
      },
    })
    render(<IssueDetails issue={issue} {...baseProps} />)
    expect(screen.getByTestId('taint-flow')).toBeInTheDocument()
    expect(screen.getByText('req.body → db.query')).toBeInTheDocument()
  })

  it('does not render TaintFlowDiagram when taintFlow is absent', () => {
    render(<IssueDetails issue={createIssue({ taintFlow: undefined })} {...baseProps} />)
    expect(screen.queryByTestId('taint-flow')).not.toBeInTheDocument()
  })

  it('renders Show Fix button', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} />)
    expect(screen.getByText('Show Fix')).toBeInTheDocument()
  })

  it('renders Hide Fix when showFix is true', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} showFix={true} fix={null} />)
    expect(screen.getByText('Hide Fix')).toBeInTheDocument()
  })

  it('calls onShowFix when Show Fix is clicked', async () => {
    const onShowFix = vi.fn()
    const user = userEvent.setup()
    const issue = createIssue()
    render(<IssueDetails issue={issue} {...baseProps} onShowFix={onShowFix} />)

    await user.click(screen.getByText('Show Fix'))
    expect(onShowFix).toHaveBeenCalledWith(issue)
  })

  it('renders Verify with AI button when no validation result', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} />)
    expect(screen.getByText('Verify with AI')).toBeInTheDocument()
  })

  it('does not render Verify button when validationResult exists', () => {
    render(
      <IssueDetails
        issue={createIssue()}
        {...baseProps}
        validationResult={createValidationResult()}
      />,
    )
    expect(screen.queryByText('Verify with AI')).not.toBeInTheDocument()
  })

  it('calls onValidate when Verify with AI is clicked', async () => {
    const onValidate = vi.fn()
    const user = userEvent.setup()
    const issue = createIssue()
    render(<IssueDetails issue={issue} {...baseProps} onValidate={onValidate} />)

    await user.click(screen.getByText('Verify with AI'))
    expect(onValidate).toHaveBeenCalledWith(issue)
  })

  it('disables Verify button when no API key', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} hasValidApiKey={false} />)
    const btn = screen.getByText('Verify with AI').closest('button')
    expect(btn).toBeDisabled()
  })

  it('shows Verifying… when isValidating', () => {
    render(<IssueDetails issue={createIssue()} {...baseProps} isValidating={true} />)
    expect(screen.getByText('Verifying…')).toBeInTheDocument()
  })

  it('renders fix diff when showFix is true and fix is present', () => {
    render(
      <IssueDetails
        issue={createIssue()}
        {...baseProps}
        showFix={true}
        fix={createFix()}
      />,
    )
    expect(screen.getByText('Suggested Fix')).toBeInTheDocument()
    expect(screen.getByText('Replace eval with JSON.parse for safe parsing.')).toBeInTheDocument()
  })

  it('shows "No automated fix available" when showFix is true and fix is null', () => {
    render(
      <IssueDetails
        issue={createIssue()}
        {...baseProps}
        showFix={true}
        fix={null}
      />,
    )
    expect(screen.getByText('No automated fix available for this issue.')).toBeInTheDocument()
  })

  it('renders validation result with verdict label', () => {
    render(
      <IssueDetails
        issue={createIssue()}
        {...baseProps}
        validationResult={createValidationResult({ verdict: 'true-positive' })}
      />,
    )
    expect(screen.getByText('True Positive')).toBeInTheDocument()
    expect(screen.getByText('This is indeed a real vulnerability.')).toBeInTheDocument()
  })

  it('renders false-positive validation result', () => {
    render(
      <IssueDetails
        issue={createIssue()}
        {...baseProps}
        validationResult={createValidationResult({ verdict: 'false-positive', reasoning: 'Not exploitable.' })}
      />,
    )
    expect(screen.getByText('False Positive')).toBeInTheDocument()
    expect(screen.getByText('Not exploitable.')).toBeInTheDocument()
  })

  it('renders suggested severity when different from issue severity', () => {
    render(
      <IssueDetails
        issue={createIssue({ severity: 'critical' })}
        {...baseProps}
        validationResult={createValidationResult({ suggestedSeverity: 'warning' })}
      />,
    )
    expect(screen.getByText(/Suggested severity:/)).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })

  it('renders CWE reference link', () => {
    render(<IssueDetails issue={createIssue({ cwe: 'CWE-95' })} {...baseProps} />)
    const link = screen.getByText('CWE-95')
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'https://cwe.mitre.org/data/definitions/95.html',
    )
  })

  it('renders OWASP badge', () => {
    render(<IssueDetails issue={createIssue({ owasp: 'A03:2021' })} {...baseProps} />)
    expect(screen.getByText('A03:2021')).toBeInTheDocument()
  })

  it('renders Learn more link', () => {
    render(
      <IssueDetails
        issue={createIssue({ learnMoreUrl: 'https://example.com/eval' })}
        {...baseProps}
      />,
    )
    const link = screen.getByText('Learn more')
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/eval')
  })

  it('does not render references section when no cwe/owasp/url', () => {
    render(
      <IssueDetails
        issue={createIssue({ cwe: undefined, owasp: undefined, learnMoreUrl: undefined })}
        {...baseProps}
      />,
    )
    expect(screen.queryByText('Learn more')).not.toBeInTheDocument()
  })
})
