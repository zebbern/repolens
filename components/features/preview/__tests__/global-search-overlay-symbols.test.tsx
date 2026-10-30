// Characterization of the Symbols tab with the REAL extractSymbols: result order,
// totals and coverage messages must not change however extraction is scheduled.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  batchIndexFiles,
  createEmptyIndex,
  createEmptyIndexWithStore,
  type CodeIndex,
  type ContentStore,
} from '@/lib/code/code-index'
import { extractSymbols } from '@/components/features/code/hooks/use-symbol-extraction'

vi.mock('lucide-react', () => {
  const icon = (name: string) => {
    const Comp = (props: { className?: string }) => <span data-icon={name} className={props.className} />
    Comp.displayName = name
    return Comp
  }
  return Object.fromEntries([
    'Search', 'Code2', 'FileText', 'Braces', 'Box', 'Shapes', 'Type', 'List', 'Code',
    'CaseSensitive', 'WholeWord', 'Regex', 'X', 'ChevronRight', 'ChevronDown',
    'Filter', 'FilterX', 'Replace', 'ArrowRight', 'Loader2',
  ].map(name => [name, icon(name)]))
})

vi.mock('@/lib/code/search-worker-client', () => ({
  searchInWorker: vi.fn(async () => []),
  cancelPendingSearches: vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({
      index: i, start: i * 30, end: (i + 1) * 30, size: 30, key: i,
    })),
    getTotalSize: () => count * 30,
    scrollToIndex: vi.fn(),
  })),
}))

import { GlobalSearchOverlay } from '../global-search-overlay'

// ---------------------------------------------------------------------------
// Corpus and reference
// ---------------------------------------------------------------------------

function corpus(): Array<{ path: string; content: string; language?: string }> {
  const files: Array<{ path: string; content: string; language?: string }> = [
    {
      path: 'src/models.ts',
      language: 'typescript',
      content: [
        'export interface User { id: string }',
        'export type Role = "admin" | "user"',
        'export enum Level { Low, High }',
        'export class UserService {',
        '  private cache = new Map()',
        '  async find(id: string) { return this.cache.get(id) }',
        '  save(user: User) {}',
        '}',
        'const internal = 1',
      ].join('\n'),
    },
    {
      path: 'server/app.py',
      language: 'python',
      content: 'class App:\n    def run(self):\n        pass\n\ndef main():\n    pass\n\nVERSION = "1"',
    },
    { path: 'src/empty.ts', language: 'typescript', content: '' },
    { path: 'src/untyped.js', content: 'function legacy() {}\nexport const handler = () => 1' },
  ]
  for (let i = 0; i < 70; i++) {
    files.push({
      path: `src/feature/f${i}.ts`,
      language: 'typescript',
      content: [
        `export function feature${i}() { return ${i} }`,
        i % 3 === 0 ? `export class Widget${i} {\n  render() {}\n}` : `export type Shape${i} = { n: ${i} }`,
        i % 4 === 0 ? `const local${i} = ${i}` : '',
      ].join('\n'),
    })
  }
  return files
}

function inlineIndex(files: ReturnType<typeof corpus>): CodeIndex {
  return batchIndexFiles(createEmptyIndex(), files)
}

function storeIndex(files: ReturnType<typeof corpus>, unavailable: string[] = []): CodeIndex {
  const source = new Map(files.filter(file => !unavailable.includes(file.path)).map(file => [file.path, file.content]))
  const store: ContentStore = {
    bulkReadMode: 'complete',
    get: async path => source.get(path) ?? null,
    getSync: () => null,
    getBatch: async paths => {
      await new Promise(resolve => setTimeout(resolve, 0))
      return new Map(paths.flatMap(path => {
        const value = source.get(path)
        return value === undefined ? [] : [[path, value] as [string, string]]
      }))
    },
    put: () => {},
    putBatch: () => {},
    has: path => source.has(path),
    delete: () => {},
    flush: async () => {},
    clear: async () => {},
    size: source.size,
  }
  return batchIndexFiles(createEmptyIndexWithStore(store), files, { retainContent: false })
}

const DEFAULT_KINDS = new Set(['function', 'class', 'interface', 'type', 'enum', 'variable'])
const KIND_LABELS: Record<string, string> = {
  function: 'fn', class: 'cls', interface: 'ifc', type: 'typ',
  enum: 'enm', variable: 'var', method: 'met', property: 'prp',
}

/** What the tab showed before any scheduling change: files in index order, children after parents. */
function reference(files: ReturnType<typeof corpus>) {
  const all: Array<{ name: string; kind: string; line: number; fileName: string }> = []
  for (const file of files) {
    const fileName = file.path.split('/').pop()!
    for (const symbol of extractSymbols(file.content, file.language)) {
      all.push({ name: symbol.name, kind: symbol.kind, line: symbol.line, fileName })
      for (const child of symbol.children ?? []) {
        all.push({ name: child.name, kind: child.kind, line: child.line, fileName })
      }
    }
  }
  return all
}

function renderOverlay(codeIndex: CodeIndex) {
  const props = { codeIndex, allFiles: [], onSelect: vi.fn(), onClose: vi.fn() }
  return render(<GlobalSearchOverlay {...props} />)
}

function optionTexts() {
  return screen.queryAllByRole('option').map(option => option.textContent)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Symbols tab characterization (real extractSymbols)', () => {
  it.each([
    ['inline', inlineIndex],
    ['IDB-like store', storeIndex],
  ] as const)('lists symbols in index order for an %s index', async (_label, build) => {
    const files = corpus()
    const expected = reference(files)
      .filter(symbol => DEFAULT_KINDS.has(symbol.kind))
      .map(symbol => `${symbol.name}${KIND_LABELS[symbol.kind]}${symbol.fileName}:${symbol.line}`)
    renderOverlay(build(files))

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts()).toHaveLength(expected.length), { timeout: 5000 })

    expect(optionTexts()).toEqual(expected)
    expect(optionTexts()).toMatchSnapshot()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('counts nested children in the indexed total', async () => {
    const files = corpus()
    const total = reference(files).length
    renderOverlay(inlineIndex(files))

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts().length).toBeGreaterThan(0), { timeout: 5000 })
    for (const title of ['Hide functions', 'Hide classs', 'Hide interfaces', 'Hide types', 'Hide enums', 'Hide variables']) {
      await userEvent.click(screen.getByTitle(title))
    }

    expect(screen.getByText(`${total} symbols indexed — type to search`)).toBeInTheDocument()
    expect(total).toMatchInlineSnapshot(`175`)
  })

  it('reports unavailable source and still lists the available symbols', async () => {
    const files = corpus()
    const unavailable = ['src/models.ts', 'src/feature/f69.ts']
    const expected = reference(files.filter(file => !unavailable.includes(file.path)))
      .filter(symbol => DEFAULT_KINDS.has(symbol.kind))
    renderOverlay(storeIndex(files, unavailable))

    await userEvent.click(screen.getByText('Symbols'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      `Source unavailable for 2 of ${files.length} files.`,
    ), { timeout: 5000 })
    await waitFor(() => expect(optionTexts()).toHaveLength(expected.length))
  })

  it('reuses the extracted symbols when the tab is reopened on the same index', async () => {
    const files = corpus()
    const index = storeIndex(files)
    const getBatch = vi.spyOn(index.contentStore, 'getBatch')
    renderOverlay(index)

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts().length).toBeGreaterThan(0), { timeout: 5000 })
    const reads = getBatch.mock.calls.length
    const listed = optionTexts()
    expect(reads).toBeGreaterThan(0)

    await userEvent.click(screen.getByText('Find Files'))
    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts()).toEqual(listed))
    expect(getBatch).toHaveBeenCalledTimes(reads)
  })

  it('does not cache a partial symbol list', async () => {
    const files = corpus()
    const index = storeIndex(files, ['src/models.ts'])
    const getBatch = vi.spyOn(index.contentStore, 'getBatch')
    renderOverlay(index)

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Source unavailable for 1 of'), { timeout: 5000 })
    const reads = getBatch.mock.calls.length

    await userEvent.click(screen.getByText('Find Files'))
    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(getBatch.mock.calls.length).toBeGreaterThan(reads), { timeout: 5000 })
  })

  it('re-extracts when the code index identity changes', async () => {
    const files = corpus()
    const { rerender } = renderOverlay(inlineIndex(files))
    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts()).toContain('UserServiceclsmodels.ts:4'), { timeout: 5000 })

    const edited = files.map(file => file.path === 'src/models.ts'
      ? { ...file, content: 'export class AccountService {}' }
      : file)
    rerender(<GlobalSearchOverlay codeIndex={inlineIndex(edited)} allFiles={[]} onSelect={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(optionTexts()).toContain('AccountServiceclsmodels.ts:1'), { timeout: 5000 })
    expect(optionTexts()).not.toContain('UserServiceclsmodels.ts:4')
  })

  it('never caches symbols from a resident-only store, which can drop source it served', async () => {
    const files = corpus()
    const index = storeIndex(files)
    Object.defineProperty(index.contentStore, 'bulkReadMode', { value: 'resident-only' })
    const getBatch = vi.spyOn(index.contentStore, 'getBatch')
    renderOverlay(index)

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(optionTexts().length).toBeGreaterThan(0), { timeout: 5000 })
    const reads = getBatch.mock.calls.length

    await userEvent.click(screen.getByText('Find Files'))
    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(getBatch.mock.calls.length).toBeGreaterThan(reads), { timeout: 5000 })
  })

  it('stops extracting when the user leaves the Symbols tab mid-run', async () => {
    const files = corpus() // 74 files: two content batches
    const index = storeIndex(files)
    const realGetBatch = index.contentStore.getBatch.bind(index.contentStore)
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve })
    const getBatch = vi.spyOn(index.contentStore, 'getBatch').mockImplementation(async paths => {
      if (getBatch.mock.calls.length === 1) await firstHeld
      return realGetBatch(paths)
    })
    renderOverlay(index)

    await userEvent.click(screen.getByText('Symbols'))
    await waitFor(() => expect(getBatch).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByText('Find Files'))
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(getBatch).toHaveBeenCalledTimes(1)
  })
})
