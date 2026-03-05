import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InlineActionResult } from '../types'

// Mock the MarkdownRenderer to avoid pulling in react-markdown + plugins
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content, className }: { content: string; className?: string }) => (
    <div data-testid="markdown-renderer" className={className}>
      {content}
    </div>
  ),
}))

import { InlineActionPanel } from '../inline-action-panel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<InlineActionResult> = {}): InlineActionResult {
  return {
    type: 'explain',
    symbolName: 'myFunction',
    content: 'This function does something useful.',
    isStreaming: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineActionPanel', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <InlineActionPanel result={makeResult()} onClose={vi.fn()} isOpen={false} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders when isOpen is true and result is provided', () => {
    render(
      <InlineActionPanel result={makeResult()} onClose={vi.fn()} isOpen={true} />,
    )
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('displays symbol name in header', () => {
    render(
      <InlineActionPanel
        result={makeResult({ symbolName: 'calculateTotal' })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.getByText('calculateTotal')).toBeInTheDocument()
  })

  it('displays the action type label as a badge', () => {
    render(
      <InlineActionPanel
        result={makeResult({ type: 'refactor' })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.getByText('Refactor Suggestions')).toBeInTheDocument()
  })

  it.each([
    { type: 'explain' as const, label: 'Explanation' },
    { type: 'refactor' as const, label: 'Refactor Suggestions' },
    { type: 'find-usages' as const, label: 'Usages' },
    { type: 'complexity' as const, label: 'Complexity Analysis' },
  ])('shows "$label" badge for action type "$type"', ({ type, label }) => {
    render(
      <InlineActionPanel
        result={makeResult({ type })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders markdown content via MarkdownRenderer', () => {
    render(
      <InlineActionPanel
        result={makeResult({ content: '# Hello World' })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    const md = screen.getByTestId('markdown-renderer')
    expect(md).toHaveTextContent('# Hello World')
  })

  it('shows streaming indicator when isStreaming is true', () => {
    render(
      <InlineActionPanel
        result={makeResult({ isStreaming: true, content: 'partial...' })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.getByText('Analyzing...')).toBeInTheDocument()
  })

  it('does not show streaming indicator when isStreaming is false', () => {
    render(
      <InlineActionPanel
        result={makeResult({ isStreaming: false })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.queryByText('Analyzing...')).not.toBeInTheDocument()
  })

  it('shows error message when result has an error', () => {
    render(
      <InlineActionPanel
        result={makeResult({ error: 'Something went wrong', content: '' })}
        onClose={vi.fn()}
        isOpen={true}
      />,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <InlineActionPanel result={makeResult()} onClose={onClose} isOpen={true} />,
    )

    await user.click(screen.getByRole('button', { name: /close panel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows empty state when result is null and isOpen is true', () => {
    render(
      <InlineActionPanel result={null} onClose={vi.fn()} isOpen={true} />,
    )
    expect(screen.getByText(/select a symbol action/i)).toBeInTheDocument()
  })

  it('has accessible aria-label on the panel', () => {
    render(
      <InlineActionPanel result={makeResult()} onClose={vi.fn()} isOpen={true} />,
    )
    expect(
      screen.getByRole('complementary', { name: /code analysis results/i }),
    ).toBeInTheDocument()
  })
})
