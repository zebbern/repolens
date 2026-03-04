import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks — hoisted before module resolution
// ---------------------------------------------------------------------------

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue({ diagramType: 'flowchart', config: {} }),
    render: vi.fn().mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg">mock diagram</svg>',
      diagramType: 'flowchart',
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
import { parseMermaidError } from '@/components/features/diagrams/mermaid-diagram'

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish mock implementation after vi.restoreAllMocks() in setup.ts
    vi.mocked(mermaid.parse).mockResolvedValue({ diagramType: 'flowchart', config: {} } as never)
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg data-testid="mermaid-svg">mock diagram</svg>',
      diagramType: 'flowchart',
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

    it('shows parsed error detail message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(mermaid.render).mockRejectedValueOnce(
        new Error('Parse error on line 3: unexpected token'),
      )

      render(<MarkdownRenderer content={'```mermaid\nbad\n```'} />)

      await waitFor(() => {
        expect(screen.getByText('Failed to render diagram')).toBeInTheDocument()
      })
      // The parsed message is displayed below the heading
      expect(screen.getByText(/unexpected token/i)).toBeInTheDocument()
    })

    it('renders a "Show raw code" toggle button on error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(mermaid.render).mockRejectedValueOnce(
        new Error('Syntax error'),
      )

      render(<MarkdownRenderer content={'```mermaid\nbad\n```'} />)

      await waitFor(() => {
        expect(screen.getByText('Failed to render diagram')).toBeInTheDocument()
      })
      expect(screen.getByLabelText('Show raw code')).toBeInTheDocument()
    })

    it('clicking "Show raw code" reveals the raw mermaid source', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(mermaid.render).mockRejectedValueOnce(
        new Error('Syntax error'),
      )

      render(<MarkdownRenderer content={'```mermaid\ngraph TD\n  A-->B\n```'} />)

      await waitFor(() => {
        expect(screen.getByText('Failed to render diagram')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('Show raw code'))

      await waitFor(() => {
        expect(screen.getByText('Raw mermaid source')).toBeInTheDocument()
      })
      expect(screen.getByLabelText('Hide raw code')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Code block header bar
  // -------------------------------------------------------------------------

  describe('code block header bar', () => {
    it('renders a header bar containing the language name', async () => {
      render(<MarkdownRenderer content={'```typescript\nconst x = 1\n```'} />)

      await waitFor(() => {
        expect(screen.getByText('typescript')).toBeInTheDocument()
      })
    })

    it('renders "text" as default language when none is specified', async () => {
      render(<MarkdownRenderer content={'```\nhello world\n```'} />)

      // Fenced code blocks without a language should render as a CodeBlock
      // with "text" as the default language label in the header.
      await waitFor(() => {
        const textLabels = screen.queryAllByText('text')
        expect(textLabels.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('renders the copy button with aria-label="Copy code" in the header', async () => {
      render(<MarkdownRenderer content={'```javascript\nconst y = 2\n```'} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Copy code')).toBeInTheDocument()
      })
    })

    it('copy button and header are always present (not hover-dependent)', async () => {
      render(<MarkdownRenderer content={'```python\nprint("hi")\n```'} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Copy code')).toBeInTheDocument()
      })
      // Header elements should be in the DOM without any hover simulation
      expect(screen.getByText('python')).toBeInTheDocument()
      expect(screen.getByLabelText('Toggle word wrap')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Word wrap toggle
  // -------------------------------------------------------------------------

  describe('word wrap toggle', () => {
    it('renders a word wrap toggle button with correct aria attributes', async () => {
      render(<MarkdownRenderer content={'```typescript\nconst x = 1\n```'} />)

      await waitFor(() => {
        const btn = screen.getByLabelText('Toggle word wrap')
        expect(btn).toBeInTheDocument()
        expect(btn).toHaveAttribute('aria-pressed', 'false')
      })
    })

    it('clicking the toggle changes aria-pressed state', async () => {
      render(<MarkdownRenderer content={'```typescript\nconst x = 1\n```'} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Toggle word wrap')).toBeInTheDocument()
      })

      const btn = screen.getByLabelText('Toggle word wrap')
      expect(btn).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })
  })

  // -------------------------------------------------------------------------
  // Line numbers
  // -------------------------------------------------------------------------

  describe('line numbers', () => {
    it('renders line numbers for code blocks with ≥5 lines', async () => {
      const fiveLineCode = '```typescript\nline1\nline2\nline3\nline4\nline5\n```'
      render(<MarkdownRenderer content={fiveLineCode} />)

      await waitFor(() => {
        expect(screen.getByText('typescript')).toBeInTheDocument()
      })

      // Line numbers container should be rendered with aria-hidden
      const lineNumbersContainer = document.querySelector('[aria-hidden="true"]')
      expect(lineNumbersContainer).toBeInTheDocument()
      // Should contain numbers 1 through 5
      expect(lineNumbersContainer?.textContent).toContain('1')
      expect(lineNumbersContainer?.textContent).toContain('5')
    })

    it('does NOT render line numbers for code blocks with <5 lines', async () => {
      const threeLineCode = '```typescript\nline1\nline2\nline3\n```'
      render(<MarkdownRenderer content={threeLineCode} />)

      await waitFor(() => {
        expect(screen.getByText('typescript')).toBeInTheDocument()
      })

      // No aria-hidden line numbers container should exist
      const lineNumbersContainer = document.querySelector('[aria-hidden="true"]')
      expect(lineNumbersContainer).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // parseMermaidError (pure function)
  // -------------------------------------------------------------------------

  describe('parseMermaidError', () => {
    it('extracts line number from "line N" pattern', () => {
      const result = parseMermaidError('Parse error on line 5: unexpected token')
      expect(result.line).toBe(5)
      expect(result.raw).toBe('Parse error on line 5: unexpected token')
    })

    it('extracts character from "character N" pattern', () => {
      const result = parseMermaidError('Error at character 12')
      expect(result.character).toBe(12)
    })

    it('extracts column from "col N" pattern', () => {
      const result = parseMermaidError('Syntax error col 7')
      expect(result.character).toBe(7)
    })

    it('extracts column from "column N" pattern', () => {
      const result = parseMermaidError('Error at column 15')
      expect(result.character).toBe(15)
    })

    it('extracts both line and character', () => {
      const result = parseMermaidError('Parse error on line 3, character 10')
      expect(result.line).toBe(3)
      expect(result.character).toBe(10)
    })

    it('strips "Error:" prefix from message', () => {
      const result = parseMermaidError('Error: Something went wrong')
      expect(result.message).toBe('Something went wrong')
    })

    it('truncates messages longer than 200 characters', () => {
      const longMessage = 'A'.repeat(250)
      const result = parseMermaidError(longMessage)
      expect(result.message.length).toBe(200)
      expect(result.message.endsWith('...')).toBe(true)
    })

    it('replaces newlines with spaces', () => {
      const result = parseMermaidError('Error:\nline 1\nline 2')
      expect(result.message).not.toContain('\n')
    })

    it('returns raw unchanged', () => {
      const input = 'Error: Something on line 5'
      const result = parseMermaidError(input)
      expect(result.raw).toBe(input)
    })
  })
})
