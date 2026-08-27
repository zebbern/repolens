import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeIssue, ComplianceCategory } from '@/lib/code/scanner'
import { CoverageGrid } from './coverage-grid'

function createCategory(overrides: Partial<ComplianceCategory> = {}): ComplianceCategory {
  return {
    name: 'Broken Access Control',
    description: 'Failures related to access control enforcement.',
    covered: true,
    ruleCount: 5,
    findingCount: 2,
    ruleIds: ['path-traversal', 'idor'],
    status: 'pass',
    issues: [],
    ...overrides,
  }
}

describe('CoverageGrid', () => {
  it('renders the title', () => {
    render(<CoverageGrid title="OWASP Top 10 — 2025" categories={{}} />)
    expect(screen.getByText('OWASP Top 10 — 2025')).toBeInTheDocument()
  })

  it('renders category entries', () => {
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ name: 'Broken Access Control', status: 'pass' }),
      'A02': createCategory({ name: 'Cryptographic Failures', status: 'fail' }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    expect(screen.getByText('Broken Access Control')).toBeInTheDocument()
    expect(screen.getByText('Cryptographic Failures')).toBeInTheDocument()
  })

  it('renders category ID labels', () => {
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory(),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    expect(screen.getByText('A01')).toBeInTheDocument()
  })

  it('renders status badges in header', () => {
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ status: 'pass' }),
      'A02': createCategory({ status: 'fail' }),
      'A03': createCategory({ status: 'warn' }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    // Status count badges for 1 pass, 1 fail, 1 warn
    // Each status type has a count badge in the header
    const passStatus = screen.getAllByText('Pass')
    expect(passStatus.length).toBeGreaterThanOrEqual(1)
  })

  it('renders finding count badge when findings > 0', () => {
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ findingCount: 3 }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    expect(screen.getByText('3 issues')).toBeInTheDocument()
  })

  it('renders "1 issue" (singular) when findingCount is 1', () => {
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ findingCount: 1 }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    expect(screen.getByText('1 issue')).toBeInTheDocument()
  })

  it('expands category details on click', async () => {
    const user = userEvent.setup()
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ description: 'Access control test description', ruleCount: 5, findingCount: 2, ruleIds: ['r1', 'r2'] }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)

    await user.click(screen.getByText('Broken Access Control'))
    expect(screen.getByText('Access control test description')).toBeInTheDocument()
    expect(screen.getByText('5 rules mapped')).toBeInTheDocument()
    expect(screen.getByText('2 findings')).toBeInTheDocument()
    expect(screen.getByText(/Rules: r1, r2/)).toBeInTheDocument()
  })

  it('collapses category details on second click', async () => {
    const user = userEvent.setup()
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory({ description: 'Details here' }),
    }
    render(<CoverageGrid title="Test" categories={categories} />)

    await user.click(screen.getByText('Broken Access Control'))
    expect(screen.getByText('Details here')).toBeInTheDocument()

    await user.click(screen.getByText('Broken Access Control'))
    expect(screen.queryByText('Details here')).not.toBeInTheDocument()
  })

  it('sets aria-expanded on category button', async () => {
    const user = userEvent.setup()
    const categories: Record<string, ComplianceCategory> = {
      'A01': createCategory(),
    }
    render(<CoverageGrid title="Test" categories={categories} />)
    const btn = screen.getByRole('button', { name: /Broken Access Control/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')

    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows mapped findings and expands each finding for details', async () => {
    const user = userEvent.setup()
    const issue: CodeIssue = {
      id: 'issue-1',
      ruleId: 'xss-rule',
      category: 'security',
      severity: 'critical',
      title: 'Reflected XSS',
      description: 'User input reaches HTML output.',
      file: 'src/search.ts',
      line: 42,
      column: 4,
      snippet: 'return query;',
      cwe: 'CWE-79',
      suggestion: 'Escape the value before rendering it.',
    }
    render(<CoverageGrid title="Test" categories={{ A01: createCategory({ issues: [issue], findingCount: 1 }) }} />)

    await user.click(screen.getByRole('button', { name: /Broken Access Control/i }))
    expect(screen.getByText('Reflected XSS')).toBeInTheDocument()
    expect(screen.getByText('src/search.ts:42')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Reflected XSS/i }))
    expect(screen.getByText('User input reaches HTML output.')).toBeInTheDocument()
    expect(screen.getByText('return query;')).toBeInTheDocument()
    expect(screen.getByText('Escape the value before rendering it.')).toBeInTheDocument()
  })

  it('opens a mapped finding in the code view when navigation is available', async () => {
    const user = userEvent.setup()
    const onNavigateToFile = vi.fn()
    const issue: CodeIssue = {
      id: 'issue-1',
      ruleId: 'path-traversal',
      category: 'security',
      severity: 'warning',
      title: 'Potential Path Traversal',
      description: 'A request value reaches a file-system path.',
      file: 'src/routes/download.ts',
      line: 17,
      column: 3,
      snippet: 'readFile(req.query.path)',
      cwe: 'CWE-22',
    }
    render(
      <CoverageGrid
        title="Test"
        categories={{ A01: createCategory({ issues: [issue], findingCount: 1 }) }}
        onNavigateToFile={onNavigateToFile}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Broken Access Control/i }))
    await user.click(screen.getByRole('button', { name: /Potential Path Traversal/i }))
    await user.click(screen.getByRole('button', { name: 'Open in Code' }))

    expect(onNavigateToFile).toHaveBeenCalledWith('src/routes/download.ts')
  })

  it('renders empty grid gracefully', () => {
    render(<CoverageGrid title="Empty Test" categories={{}} />)
    expect(screen.getByText('Empty Test')).toBeInTheDocument()
  })
})
