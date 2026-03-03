import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks — hoisted before module resolution
// ---------------------------------------------------------------------------

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg">mock diagram</svg>',
    }),
  },
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}))

// Use plain functions (not vi.fn) so vi.restoreAllMocks() in setup.ts
// afterEach does not strip their implementations from the cached highlighter.
vi.mock('shiki', () => ({
  createHighlighter: () =>
    Promise.resolve({
      codeToHtml: () =>
        '<pre class="shiki github-dark"><code>highlighted</code></pre>',
      loadLanguage: () => Promise.resolve(undefined),
    }),
}))

import mermaid from 'mermaid'
import { MarkdownRenderer } from './markdown-renderer'

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish mock implementation after vi.restoreAllMocks() in setup.ts
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg">mock diagram</svg>',
    })
  })

  // -------------------------------------------------------------------------
  // Mermaid code blocks
  // -------------------------------------------------------------------------

  describe('mermaid code blocks', () => {
    const MERMAID_CONTENT = '```mermaid\ngraph TD\n  A-->B\n```'

    it('renders MermaidDiagram container for mermaid fenced blocks', async () => {
      render(<MarkdownRenderer content={MERMAID_CONTENT} />)

      await waitFor(() => {
        expect(document.querySelector('.mermaid-container')).toBeInTheDocument()
      })
    })

    it('calls mermaid.render for mermaid blocks', async () => {
      render(<MarkdownRenderer content={MERMAID_CONTENT} />)

      await waitFor(() => {
        expect(mermaid.render).toHaveBeenCalled()
      })
    })

    it('does not apply Shiki highlighting to mermaid blocks', async () => {
      render(<MarkdownRenderer content={MERMAID_CONTENT} />)

      await waitFor(() => {
        expect(document.querySelector('.mermaid-container')).toBeInTheDocument()
      })

      expect(document.querySelector('.shiki')).not.toBeInTheDocument()
    })

    it('displays a "mermaid" label badge', async () => {
      render(<MarkdownRenderer content={MERMAID_CONTENT} />)

      await waitFor(() => {
        expect(screen.getByText('mermaid')).toBeInTheDocument()
      })
    })

    it('displays a download SVG button', async () => {
      render(<MarkdownRenderer content={MERMAID_CONTENT} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Download SVG')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Non-mermaid code blocks
  // -------------------------------------------------------------------------

  describe('non-mermaid code blocks', () => {
    it('renders CodeBlock with Shiki for typescript', async () => {
      render(<MarkdownRenderer content={'```typescript\nconst x = 1\n```'} />)

      await waitFor(() => {
        expect(document.querySelector('.shiki')).toBeInTheDocument()
      })

      expect(mermaid.render).not.toHaveBeenCalled()
    })

    it('displays the language label for code blocks', async () => {
      render(<MarkdownRenderer content={'```javascript\nconst y = 2\n```'} />)

      await waitFor(() => {
        expect(screen.getByText('javascript')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Inline code
  // -------------------------------------------------------------------------

  describe('inline code', () => {
    it('renders inline `mermaid` text as <code> without triggering MermaidDiagram', () => {
      render(<MarkdownRenderer content="Use `mermaid` for diagrams" />)

      const codeEl = screen.getByText('mermaid')
      expect(codeEl.tagName).toBe('CODE')
      expect(document.querySelector('.mermaid-container')).not.toBeInTheDocument()
      expect(mermaid.render).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Mermaid error handling
  // -------------------------------------------------------------------------

  describe('mermaid error handling', () => {
    it('shows error message when mermaid.render throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(mermaid.render).mockRejectedValueOnce(
        new Error('Syntax error'),
      )

      render(<MarkdownRenderer content={'```mermaid\ninvalid diagram\n```'} />)

      await waitFor(() => {
        expect(
          screen.getByText('Failed to render diagram'),
        ).toBeInTheDocument()
      })
    })
  })
})
