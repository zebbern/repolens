import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExtractedSymbol } from '../hooks/use-symbol-extraction'
import type { SymbolRange, InlineActionType } from '../types'

// ---------------------------------------------------------------------------
// We mock nothing — InlineActionBar is a simple presentational component
// that only uses Radix primitives (TooltipProvider, Tooltip) and lucide icons.
// ---------------------------------------------------------------------------

import { InlineActionBar } from '../inline-action-bar'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSymbol(
  overrides: Partial<ExtractedSymbol> & Pick<ExtractedSymbol, 'name' | 'line'>,
): ExtractedSymbol {
  return { kind: 'function', isExported: true, ...overrides }
}

function makeSymbolRange(): SymbolRange {
  return {
    symbol: makeSymbol({ name: 'myFunc', line: 1 }),
    startLine: 1,
    endLine: 10,
  }
}

const ACTION_LABELS = ['Explain', 'Suggest Refactor', 'Find Usages', 'Show Complexity']
const ACTION_TYPES: InlineActionType[] = ['explain', 'refactor', 'find-usages', 'complexity']

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineActionBar', () => {
  it('renders all 4 action buttons when visible', () => {
    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={true}
        hasApiKey={true}
      />,
    )

    for (const label of ACTION_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('does not render anything when isVisible is false', () => {
    const { container } = render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={false}
        hasApiKey={true}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('has role="toolbar" with an accessible label', () => {
    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={true}
        hasApiKey={true}
      />,
    )

    expect(screen.getByRole('toolbar', { name: /code actions/i })).toBeInTheDocument()
  })

  it.each(
    ACTION_TYPES.map((type, i) => ({ type, label: ACTION_LABELS[i] })),
  )('calls onAction("$type") when $label button is clicked', async ({ type, label }) => {
    const user = userEvent.setup()
    const onAction = vi.fn()

    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={onAction}
        isVisible={true}
        hasApiKey={true}
      />,
    )

    await user.click(screen.getByRole('button', { name: label }))
    expect(onAction).toHaveBeenCalledWith(type)
  })

  it('disables AI-dependent buttons when hasApiKey is false', () => {
    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={true}
        hasApiKey={false}
      />,
    )

    // AI-dependent buttons: Explain, Suggest Refactor, Show Complexity
    expect(screen.getByRole('button', { name: 'Explain' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Suggest Refactor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show Complexity' })).toBeDisabled()
  })

  it('keeps Find Usages enabled even without API key', () => {
    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={true}
        hasApiKey={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Find Usages' })).not.toBeDisabled()
  })

  it('all buttons have accessible aria-label attributes', () => {
    render(
      <InlineActionBar
        symbolRange={makeSymbolRange()}
        onAction={vi.fn()}
        isVisible={true}
        hasApiKey={true}
      />,
    )

    const buttons = screen.getAllByRole('button')
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-label')
    }
  })
})
