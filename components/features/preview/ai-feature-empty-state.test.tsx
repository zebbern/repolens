import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIFeatureEmptyState } from './ai-feature-empty-state'

describe('AIFeatureEmptyState', () => {
  const defaultProps = { tabId: 'diagram', onOpenSettings: vi.fn() }

  it('renders without crashing for the diagram tab', () => {
    render(<AIFeatureEmptyState {...defaultProps} />)
    expect(screen.getByText('AI Diagram Generator')).toBeInTheDocument()
  })

  it('returns null for unknown tabId', () => {
    const { container } = render(
      <AIFeatureEmptyState tabId="unknown" onOpenSettings={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Marketing copy accuracy (Improvement #1)
  // ---------------------------------------------------------------------------

  describe('diagram marketing copy', () => {
    it('mentions "6 diagram types" in the feature list', () => {
      render(<AIFeatureEmptyState {...defaultProps} />)
      const featureItems = screen.getAllByRole('listitem')
      const diagramTypesItem = featureItems.find((item) =>
        item.textContent?.includes('6 diagram types'),
      )
      expect(diagramTypesItem).toBeTruthy()
    })

    it('does NOT mention "sequence" in the feature list', () => {
      render(<AIFeatureEmptyState {...defaultProps} />)
      const featureItems = screen.getAllByRole('listitem')
      const hasSequence = featureItems.some((item) =>
        item.textContent?.toLowerCase().includes('sequence'),
      )
      expect(hasSequence).toBe(false)
    })

    it('does NOT mention "ERD" in the feature list', () => {
      render(<AIFeatureEmptyState {...defaultProps} />)
      const featureItems = screen.getAllByRole('listitem')
      const hasERD = featureItems.some((item) =>
        item.textContent?.includes('ERD'),
      )
      expect(hasERD).toBe(false)
    })

    it('mentions accurate diagram type names (architecture, treemap, entry points)', () => {
      render(<AIFeatureEmptyState {...defaultProps} />)
      const allText = screen.getAllByRole('listitem').map((li) => li.textContent).join(' ')
      expect(allText).toContain('architecture')
      expect(allText).toContain('treemap')
      expect(allText).toContain('entry points')
    })

    it('does not mention unsupported diagram types in the description', () => {
      render(<AIFeatureEmptyState {...defaultProps} />)
      const description = screen.getByText(/Create architecture diagrams/)
      expect(description.textContent).not.toContain('sequence')
      expect(description.textContent).not.toContain('ERD')
      expect(description.textContent).not.toContain('entity-relationship')
    })
  })

  // ---------------------------------------------------------------------------
  // Red lock icon (Improvement #5)
  // ---------------------------------------------------------------------------

  describe('lock icon color', () => {
    it('renders a lock icon with text-destructive class', () => {
      const { container } = render(<AIFeatureEmptyState {...defaultProps} />)
      // The lock icon is rendered inside a small circle positioned at bottom-right
      const lockContainer = container.querySelector('.bg-muted')!
      expect(lockContainer).toBeInTheDocument()
      const lockSvg = lockContainer.querySelector('svg')
      expect(lockSvg).toBeInTheDocument()
      expect(lockSvg).toHaveClass('text-destructive')
    })
  })

  // ---------------------------------------------------------------------------
  // Other tabs render correctly
  // ---------------------------------------------------------------------------

  describe('other tabs', () => {
    it('renders docs tab info', () => {
      render(<AIFeatureEmptyState tabId="docs" onOpenSettings={vi.fn()} />)
      expect(screen.getByText('AI Documentation Generator')).toBeInTheDocument()
    })

    it('renders changelog tab info', () => {
      render(<AIFeatureEmptyState tabId="changelog" onOpenSettings={vi.fn()} />)
      expect(screen.getByText('AI Changelog Generator')).toBeInTheDocument()
    })
  })
})
