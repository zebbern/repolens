import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIFeatureEmptyState } from '../ai-feature-empty-state'

describe('AIFeatureEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('docs tab', () => {
    it('renders title and description for docs', () => {
      render(<AIFeatureEmptyState tabId="docs" />)

      expect(screen.getByText('AI Documentation Generator')).toBeInTheDocument()
      expect(screen.getByText(/Generate professional documentation/)).toBeInTheDocument()
    })

    it('shows all feature bullet points for docs', () => {
      render(<AIFeatureEmptyState tabId="docs" />)

      expect(screen.getByText(/5 documentation templates/)).toBeInTheDocument()
      expect(screen.getByText(/Real-time streaming generation/)).toBeInTheDocument()
      expect(screen.getByText(/Markdown export and clipboard copy/)).toBeInTheDocument()
      expect(screen.getByText(/History of generated documents/)).toBeInTheDocument()
    })

    it('renders the CTA button', () => {
      render(<AIFeatureEmptyState tabId="docs" />)

      expect(screen.getByRole('button', { name: /set up api key/i })).toBeInTheDocument()
    })
  })

  describe('diagram tab', () => {
    it('renders title and description for diagram', () => {
      render(<AIFeatureEmptyState tabId="diagram" />)

      expect(screen.getByText('AI Diagram Generator')).toBeInTheDocument()
      expect(screen.getByText(/Create architecture diagrams/)).toBeInTheDocument()
    })

    it('shows all feature bullet points for diagram', () => {
      render(<AIFeatureEmptyState tabId="diagram" />)

      expect(screen.getByText(/6 diagram types/)).toBeInTheDocument()
      expect(screen.getByText(/Interactive Mermaid rendering/)).toBeInTheDocument()
      expect(screen.getByText(/Export to SVG and PNG/)).toBeInTheDocument()
      expect(screen.getByText(/Auto-generated from code analysis/)).toBeInTheDocument()
    })
  })

  describe('changelog tab', () => {
    it('renders title and description for changelog', () => {
      render(<AIFeatureEmptyState tabId="changelog" />)

      expect(screen.getByText('AI Changelog Generator')).toBeInTheDocument()
      expect(screen.getByText(/Generate changelogs from Git history/)).toBeInTheDocument()
    })

    it('shows all feature bullet points for changelog', () => {
      render(<AIFeatureEmptyState tabId="changelog" />)

      expect(screen.getByText(/4 presets/)).toBeInTheDocument()
      expect(screen.getByText(/Tag and branch-based/)).toBeInTheDocument()
      expect(screen.getByText(/Quality levels/)).toBeInTheDocument()
      expect(screen.getByText(/History with regenerate and export/)).toBeInTheDocument()
    })
  })

  describe('unknown tab', () => {
    it('returns null for an unknown tabId', () => {
      const { container } = render(<AIFeatureEmptyState tabId="unknown-tab" />)
      expect(container.innerHTML).toBe('')
    })
  })

  describe('CTA interaction', () => {
    it('fires onOpenSettings callback when CTA button is clicked', async () => {
      const user = userEvent.setup()
      const onOpenSettings = vi.fn()
      render(<AIFeatureEmptyState tabId="docs" onOpenSettings={onOpenSettings} />)

      await user.click(screen.getByRole('button', { name: /set up api key/i }))
      expect(onOpenSettings).toHaveBeenCalledOnce()
    })

    it('shows helper text below the CTA button', () => {
      render(<AIFeatureEmptyState tabId="docs" />)

      expect(
        screen.getByText(/Add your OpenAI, Anthropic, or Google API key/)
      ).toBeInTheDocument()
    })
  })
})
