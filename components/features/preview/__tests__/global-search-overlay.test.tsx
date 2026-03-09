import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import type { CodeIndex, SearchResult } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'
import type { ExtractedSymbol } from '@/components/features/code/hooks/use-symbol-extraction'

/* ── Hoisted mocks (available to vi.mock factories) ───────────────── */

const { mockSearchIndex, mockBuildSearchRegex, mockExtractSymbols, mockSearchInWorker, mockCancelPendingSearches } = vi.hoisted(() => {
  const mockSearchIndex = vi.fn((): SearchResult[] => [])
  return {
    mockSearchIndex,
    mockBuildSearchRegex: vi.fn((): RegExp | null => null),
    mockExtractSymbols: vi.fn((): ExtractedSymbol[] => []),
    mockSearchInWorker: vi.fn((...args: Parameters<typeof mockSearchIndex>) =>
      Promise.resolve(mockSearchIndex(...args)),
    ),
    mockCancelPendingSearches: vi.fn(),
  }
})

/* ── Mock lucide-react icons as simple spans ──────────────────────── */

vi.mock('lucide-react', () => {
  const icon = (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Comp = (props: any) => <span data-icon={name} className={props.className} />
    Comp.displayName = name
    return Comp
  }
  return {
    Search: icon('Search'),
    Code2: icon('Code2'),
    FileText: icon('FileText'),
    Braces: icon('Braces'),
    Box: icon('Box'),
    Shapes: icon('Shapes'),
    Type: icon('Type'),
    List: icon('List'),
    Code: icon('Code'),
    CaseSensitive: icon('CaseSensitive'),
    WholeWord: icon('WholeWord'),
    Regex: icon('Regex'),
    X: icon('X'),
    ChevronRight: icon('ChevronRight'),
    ChevronDown: icon('ChevronDown'),
    Filter: icon('Filter'),
    FilterX: icon('FilterX'),
  }
})

/* ── Mock code-index ──────────────────────────────────────────────── */

vi.mock('@/lib/code/code-index', () => ({
  buildSearchRegex: mockBuildSearchRegex,
}))

/* ── Mock search worker client ────────────────────────────────────── */

vi.mock('@/lib/code/search-worker-client', () => ({
  searchInWorker: mockSearchInWorker,
  cancelPendingSearches: mockCancelPendingSearches,
}))

/* ── Mock extractSymbols ──────────────────────────────────────────── */

vi.mock('@/components/features/code/hooks/use-symbol-extraction', () => ({
  extractSymbols: mockExtractSymbols,
}))

/* ── Mock @tanstack/react-virtual — jsdom has no scroll container dimensions ── */

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 30,
        end: (i + 1) * 30,
        size: 30,
        key: i,
      })),
    getTotalSize: () => count * 30,
    scrollToIndex: vi.fn(),
  })),
}))

/* ── Helpers ──────────────────────────────────────────────────────── */

import { GlobalSearchOverlay } from '../global-search-overlay'

function createCodeIndex(
  files: Array<{ path: string; content: string; language?: string }> = [],
): CodeIndex {
  const map = new Map<string, {
    path: string; name: string; content: string
    language?: string; lines: string[]; lineCount: number
  }>()
  for (const f of files) {
    const lines = f.content.split('\n')
    map.set(f.path, {
      path: f.path,
      name: f.path.split('/').pop() || f.path,
      content: f.content,
      language: f.language,
      lines,
      lineCount: lines.length,
    })
  }
  const contentStore = new InMemoryContentStore()
  const meta = new Map<string, { path: string; name: string; language?: string; lineCount: number }>()
  for (const f of files) {
    contentStore.put(f.path, f.content)
    meta.set(f.path, { path: f.path, name: f.path.split('/').pop() || f.path, language: f.language, lineCount: f.content.split('\n').length })
  }
  return { files: map, totalFiles: map.size, totalLines: 0, isIndexing: false, meta, contentStore }
}

const defaultFiles = [
  { path: 'src/utils.ts', name: 'utils.ts', lineCount: 42 },
  { path: 'src/index.ts', name: 'index.ts', lineCount: 10 },
  { path: 'src/components/Header.tsx', name: 'Header.tsx', lineCount: 80 },
]

function renderOverlay(
  props: Partial<React.ComponentProps<typeof GlobalSearchOverlay>> = {},
) {
  const defaultProps: React.ComponentProps<typeof GlobalSearchOverlay> = {
    codeIndex: createCodeIndex(),
    allFiles: defaultFiles,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ...props,
  }
  return { ...render(<GlobalSearchOverlay {...defaultProps} />), props: defaultProps }
}

/* ── Tests ─────────────────────────────────────────────────────────── */

describe('GlobalSearchOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    // jsdom doesn't implement IntersectionObserver
    globalThis.IntersectionObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_cb: any, _opts?: any) {}
    } as unknown as typeof IntersectionObserver
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /* ── Rendering & structure ────────────────────────────────────── */

  describe('rendering', () => {
    it('renders three tab buttons', () => {
      renderOverlay()
      expect(screen.getByText('Find Files')).toBeInTheDocument()
      expect(screen.getByText('Code Search')).toBeInTheDocument()
      expect(screen.getByText('Symbols')).toBeInTheDocument()
    })

    it('shows Files placeholder by default', () => {
      renderOverlay()
      expect(
        screen.getByPlaceholderText('Search files by name or path...'),
      ).toBeInTheDocument()
    })

    it('renders ESC hint', () => {
      renderOverlay()
      expect(screen.getByText('ESC')).toBeInTheDocument()
    })

    it('shows file count hint when query is empty', () => {
      renderOverlay()
      expect(screen.getByText(/Type to search across 3 files/)).toBeInTheDocument()
    })

    it('auto-focuses the input', () => {
      renderOverlay()
      expect(
        screen.getByPlaceholderText('Search files by name or path...'),
      ).toHaveFocus()
    })
  })

  /* ── Tab switching ────────────────────────────────────────────── */

  describe('tab switching', () => {
    it('switches to Code Search tab', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.click(screen.getByText('Code Search'))
      expect(
        screen.getByPlaceholderText('Search in file contents...'),
      ).toBeInTheDocument()
    })

    it('switches to Symbols tab', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.click(screen.getByText('Symbols'))
      expect(
        screen.getByPlaceholderText('Search for symbols...'),
      ).toBeInTheDocument()
    })

    it('shows code toggles only on Code tab', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      expect(screen.queryByTitle('Match Case')).not.toBeInTheDocument()

      await user.click(screen.getByText('Code Search'))
      expect(screen.getByTitle('Match Case')).toBeInTheDocument()
      expect(screen.getByTitle('Whole Word')).toBeInTheDocument()
      expect(screen.getByTitle('Use Regex')).toBeInTheDocument()
      expect(screen.getByTitle('Excluding generated files')).toBeInTheDocument()
    })

    it('shows symbol kind filters only on Symbols tab', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      expect(screen.queryByTitle(/Hide function/)).not.toBeInTheDocument()

      await user.click(screen.getByText('Symbols'))
      expect(screen.getByTitle('Hide functions')).toBeInTheDocument()
    })
  })

  /* ── Files tab ────────────────────────────────────────────────── */

  describe('files tab', () => {
    it('filters files by name', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'utils',
      )

      expect(screen.getByText('utils.ts')).toBeInTheDocument()
      expect(screen.queryByText('Header.tsx')).not.toBeInTheDocument()
    })

    it('filters files by path', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'components',
      )

      expect(screen.getByText('Header.tsx')).toBeInTheDocument()
      expect(screen.queryByText('utils.ts')).not.toBeInTheDocument()
    })

    it('is case-insensitive', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'HEADER',
      )

      expect(screen.getByText('Header.tsx')).toBeInTheDocument()
    })

    it('shows "No files found" for unmatched query', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'zzzzz',
      )

      expect(screen.getByText('No files found')).toBeInTheDocument()
    })

    it('calls onSelect with path on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'utils',
      )
      await user.click(screen.getByText('utils.ts'))

      expect(props.onSelect).toHaveBeenCalledWith('src/utils.ts')
    })

    it('shows result count footer', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'ts',
      )

      expect(screen.getByText(/file.*found/i)).toBeInTheDocument()
    })
  })

  /* ── Close behavior ───────────────────────────────────────────── */

  describe('close behavior', () => {
    it('calls onClose on Escape', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()

      await user.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalled()
    })

    it('calls onClose on backdrop click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props, container } = renderOverlay()

      await user.click(container.firstChild as HTMLElement)
      expect(props.onClose).toHaveBeenCalled()
    })

    it('does not close on inner click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()

      await user.click(
        screen.getByPlaceholderText('Search files by name or path...'),
      )
      expect(props.onClose).not.toHaveBeenCalled()
    })
  })

  /* ── Clear query ──────────────────────────────────────────────── */

  describe('clear query', () => {
    it('shows clear button only when query is non-empty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'),
        'test',
      )
      expect(screen.getByLabelText('Clear search')).toBeInTheDocument()
    })

    it('clears query on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      const input = screen.getByPlaceholderText('Search files by name or path...')
      await user.type(input, 'test')
      await user.click(screen.getByLabelText('Clear search'))

      expect(input).toHaveValue('')
    })
  })

  /* ── Code tab ─────────────────────────────────────────────────── */

  describe('code tab', () => {
    it('debounces search (300ms)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'),
        'hello',
      )

      // Not yet called with full query before debounce
      expect(mockSearchInWorker).not.toHaveBeenCalledWith(
        expect.anything(), 'hello', expect.anything(),
      )

      await act(async () => { vi.advanceTimersByTime(300) })

      expect(mockSearchInWorker).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.objectContaining({ caseSensitive: false, regex: false, wholeWord: false }),
      )
    })

    it('displays code results with line numbers', async () => {
      const results: SearchResult[] = [{
        file: 'src/app.ts', language: 'typescript',
        matches: [
          { line: 10, content: 'console.log("hello")', column: 12, length: 5 },
          { line: 20, content: 'const hello = "world"', column: 6, length: 5 },
        ],
      }]
      mockSearchIndex.mockReturnValue(results)

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'hello',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('src/app.ts')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('20')).toBeInTheDocument()
    })

    it('shows "No matches found" for empty results', async () => {
      mockSearchIndex.mockReturnValue([])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'zzz',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('No matches found')).toBeInTheDocument()
    })

    it('shows empty-state hint when query is empty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))

      expect(screen.getByText('Search across all file contents')).toBeInTheDocument()
    })

    it('calls onSelect with file and line on click', async () => {
      mockSearchIndex.mockReturnValue([{
        file: 'src/app.ts', language: 'typescript',
        matches: [{ line: 15, content: 'const x = 1', column: 0, length: 5 }],
      }])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'const',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      await user.click(screen.getByText('15'))

      expect(props.onSelect).toHaveBeenCalledWith('src/app.ts', 15)
    })

    it('toggles case-sensitive and passes to searchInWorker', async () => {
      mockSearchIndex.mockReturnValue([])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))

      const toggle = screen.getByTitle('Match Case')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'test',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(mockSearchInWorker).toHaveBeenCalledWith(
        expect.anything(), 'test',
        expect.objectContaining({ caseSensitive: true }),
      )
    })

    it('toggles whole-word option', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))

      const toggle = screen.getByTitle('Whole Word')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })

    it('toggles regex option', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))

      const toggle = screen.getByTitle('Use Regex')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows match & file counts in footer', async () => {
      mockSearchIndex.mockReturnValue([
        { file: 'src/a.ts', language: 'typescript', matches: [
          { line: 1, content: 'hello', column: 0, length: 5 },
          { line: 5, content: 'hello again', column: 0, length: 5 },
        ]},
        { file: 'src/b.ts', language: 'typescript', matches: [
          { line: 3, content: 'hello world', column: 0, length: 5 },
        ]},
      ])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'hello',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText(/3 matches in 2 files/)).toBeInTheDocument()
    })

    it('excludes generated files by default', async () => {
      mockSearchIndex.mockReturnValue([
        { file: 'src/app.ts', language: 'typescript', matches: [
          { line: 1, content: 'const x = 1', column: 0, length: 5 },
        ]},
        { file: 'pnpm-lock.yaml', language: 'yaml', matches: [
          { line: 100, content: 'integrity: sha512-abc', column: 0, length: 5 },
        ]},
        { file: 'dist/bundle.js', language: 'javascript', matches: [
          { line: 1, content: 'var x=1', column: 0, length: 5 },
        ]},
      ])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'x',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('src/app.ts')).toBeInTheDocument()
      expect(screen.queryByText('pnpm-lock.yaml')).not.toBeInTheDocument()
      expect(screen.queryByText('dist/bundle.js')).not.toBeInTheDocument()
    })

    it('includes generated files when toggle is off', async () => {
      mockSearchIndex.mockReturnValue([
        { file: 'src/app.ts', language: 'typescript', matches: [
          { line: 1, content: 'const x = 1', column: 0, length: 5 },
        ]},
        { file: 'pnpm-lock.yaml', language: 'yaml', matches: [
          { line: 100, content: 'integrity: sha512-abc', column: 0, length: 5 },
        ]},
      ])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))

      // Toggle off the exclude filter
      await user.click(screen.getByTitle('Excluding generated files'))

      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'x',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('src/app.ts')).toBeInTheDocument()
      expect(screen.getByText('pnpm-lock.yaml')).toBeInTheDocument()
    })
  })

  /* ── Symbols tab ──────────────────────────────────────────────── */

  describe('symbols tab', () => {
    const indexWithFiles = createCodeIndex([
      { path: 'src/utils.ts', content: 'export function foo() {}\nexport class Bar {}', language: 'typescript' },
    ])

    const symbols: ExtractedSymbol[] = [
      { name: 'foo', kind: 'function', line: 1, isExported: true },
      { name: 'Bar', kind: 'class', line: 2, isExported: true },
      { name: 'IUser', kind: 'interface', line: 3, isExported: true },
      { name: 'myVar', kind: 'variable', line: 4, isExported: false },
    ]

    beforeEach(() => {
      mockExtractSymbols.mockReturnValue(symbols)
    })

    it('shows indexed symbol count when query is empty and all kinds disabled', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))

      // Disable all filterable kinds so results become empty
      await user.click(screen.getByTitle('Hide functions'))
      await user.click(screen.getByTitle('Hide classs'))
      await user.click(screen.getByTitle('Hide interfaces'))
      await user.click(screen.getByTitle('Hide types'))
      await user.click(screen.getByTitle('Hide enums'))
      await user.click(screen.getByTitle('Hide variables'))

      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText(/symbols indexed — type to search/)).toBeInTheDocument()
    })

    it('filters symbols by name', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))
      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'foo',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('foo')).toBeInTheDocument()
      expect(screen.queryByText('Bar')).not.toBeInTheDocument()
    })

    it('shows "No matching symbols" when none match', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))
      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'nonexistent',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('No matching symbols')).toBeInTheDocument()
    })

    it('calls onSelect with filePath and line on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))
      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'foo',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      await user.click(screen.getByText('foo'))
      expect(props.onSelect).toHaveBeenCalledWith('src/utils.ts', 1)
    })

    it('filters out kinds when toggled off', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))

      // Disable 'function' kind
      await user.click(screen.getByTitle('Hide functions'))

      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'foo',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.queryByText('foo')).not.toBeInTheDocument()
    })

    it('re-enables kind toggle', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))

      await user.click(screen.getByTitle('Hide functions'))
      await user.click(screen.getByTitle('Show functions'))

      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'foo',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText('foo')).toBeInTheDocument()
    })

    it('shows kind badge', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({ codeIndex: indexWithFiles })
      await user.click(screen.getByText('Symbols'))
      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'foo',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      // 'fn' appears both as filter button label and as the result badge
      const fnElements = screen.getAllByText('fn')
      expect(fnElements.length).toBeGreaterThanOrEqual(2)
    })
  })

  /* ── Keyboard navigation ──────────────────────────────────────── */

  describe('keyboard navigation', () => {
    const getIndexedButtons = () =>
      screen.getAllByRole('option')

    it('ArrowDown / ArrowUp move selection', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'), 'ts',
      )

      // Flush any pending timers/effects
      await act(async () => { vi.runAllTimers() })

      expect(getIndexedButtons().length).toBeGreaterThanOrEqual(2)
      expect(getIndexedButtons()[0]).toHaveClass('bg-foreground/10')

      await user.keyboard('{ArrowDown}')
      expect(getIndexedButtons()[1]).toHaveClass('bg-foreground/10')

      await user.keyboard('{ArrowUp}')
      expect(getIndexedButtons()[0]).toHaveClass('bg-foreground/10')
    })

    it('clamps at boundaries', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay({
        allFiles: [{ path: 'only.ts', name: 'only.ts', lineCount: 1 }],
      })

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'), 'only',
      )

      await user.keyboard('{ArrowDown}')
      expect(getIndexedButtons()[0]).toHaveClass('bg-foreground/10')

      await user.keyboard('{ArrowUp}')
      expect(getIndexedButtons()[0]).toHaveClass('bg-foreground/10')
    })

    it('Enter selects highlighted file', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'), 'utils',
      )
      await user.keyboard('{Enter}')

      expect(props.onSelect).toHaveBeenCalledWith('src/utils.ts')
    })

    it('Enter selects highlighted code result', async () => {
      mockSearchIndex.mockReturnValue([{
        file: 'src/main.ts', language: 'typescript',
        matches: [{ line: 42, content: 'const x = 1', column: 0, length: 5 }],
      }])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'const',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      await user.keyboard('{Enter}')
      expect(props.onSelect).toHaveBeenCalledWith('src/main.ts', 42)
    })

    it('Enter selects highlighted symbol result', async () => {
      mockExtractSymbols.mockReturnValue([
        { name: 'myFunc', kind: 'function', line: 7, isExported: true },
      ])
      const codeIndex = createCodeIndex([
        { path: 'src/mod.ts', content: 'export function myFunc() {}', language: 'typescript' },
      ])
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { props } = renderOverlay({ codeIndex })
      await user.click(screen.getByText('Symbols'))
      await user.type(
        screen.getByPlaceholderText('Search for symbols...'), 'myFunc',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      await user.keyboard('{Enter}')
      expect(props.onSelect).toHaveBeenCalledWith('src/mod.ts', 7)
    })

    it('resets selection index when query changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      const input = screen.getByPlaceholderText('Search files by name or path...')
      await user.type(input, 'ts')
      await user.keyboard('{ArrowDown}')

      // Change query — resets to 0
      await user.clear(input)
      await user.type(input, 'utils')

      expect(getIndexedButtons()[0]).toHaveClass('bg-foreground/10')
    })
  })

  /* ── Ctrl+key tab switching ───────────────────────────────────── */

  describe('ctrl+key tab switching', () => {
    it('Ctrl+1 switches to Files', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.click(screen.getByText('Code Search'))
      await user.keyboard('{Control>}1{/Control}')

      expect(
        screen.getByPlaceholderText('Search files by name or path...'),
      ).toBeInTheDocument()
    })

    it('Ctrl+2 switches to Code Search', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.keyboard('{Control>}2{/Control}')

      expect(
        screen.getByPlaceholderText('Search in file contents...'),
      ).toBeInTheDocument()
    })

    it('Ctrl+3 switches to Symbols', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.keyboard('{Control>}3{/Control}')

      expect(
        screen.getByPlaceholderText('Search for symbols...'),
      ).toBeInTheDocument()
    })
  })

  /* ── ARIA attributes ──────────────────────────────────────────── */

  describe('ARIA attributes', () => {
    it('input has role combobox with aria-controls and aria-expanded', () => {
      renderOverlay()
      const input = screen.getByRole('combobox')
      expect(input).toHaveAttribute('aria-controls', 'search-results')
      expect(input).toHaveAttribute('aria-expanded', 'false')
    })

    it('aria-expanded becomes true when results exist', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      const input = screen.getByRole('combobox')

      await user.type(input, 'utils')
      expect(input).toHaveAttribute('aria-expanded', 'true')
    })

    it('aria-activedescendant updates on ArrowDown', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      const input = screen.getByRole('combobox')

      await user.type(input, 'ts')
      await act(async () => { vi.runAllTimers() })
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0')

      await user.keyboard('{ArrowDown}')
      expect(input).toHaveAttribute('aria-activedescendant', 'search-result-1')
    })

    it('options have aria-selected', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'), 'ts',
      )

      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(options[1]).toHaveAttribute('aria-selected', 'false')
    })
  })

  /* ── Tab key (not intercepted) ─────────────────────────────────── */

  describe('Tab key behavior', () => {
    it('does not intercept Tab for tab cycling — Tab moves focus naturally', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      // Tab should NOT switch to the Code tab — it stays on Files
      await user.tab()
      expect(
        screen.getByPlaceholderText('Search files by name or path...'),
      ).toBeInTheDocument()
    })
  })

  /* ── Edge cases ───────────────────────────────────────────────── */

  describe('edge cases', () => {
    it('ArrowDown with empty results does not set selectedIndex to -1', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()

      // No query typed — no results
      await user.keyboard('{ArrowDown}')

      // Type a query that matches, verify selection starts at 0
      await user.type(
        screen.getByPlaceholderText('Search files by name or path...'), 'ts',
      )
      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
    })

    it('shows all matches in stats when many results exist', async () => {
      // Create enough matches to previously exceed the cap
      const matches = Array.from({ length: 60 }, (_, i) => ({
        line: i + 1, content: `match ${i}`, column: 0, length: 5,
      }))
      mockSearchIndex.mockReturnValue([
        { file: 'src/a.ts', language: 'typescript', matches },
        { file: 'src/b.ts', language: 'typescript', matches },
      ])

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderOverlay()
      await user.click(screen.getByText('Code Search'))
      await user.type(
        screen.getByPlaceholderText('Search in file contents...'), 'match',
      )
      await act(async () => { vi.advanceTimersByTime(300) })

      expect(screen.getByText(/120 matches in 2 files/)).toBeInTheDocument()
    })
  })
})
