import { analyzeCodebase, analyzeCodebaseAsync } from '../analyzer'
import { batchIndexMetadataOnly, createEmptyIndex, createEmptyIndexWithStore, type CodeIndex } from '../../code-index'
import type { ExtractedType, ExtractedClass } from '../types'
import { LazyContentStore, type ContentStore } from '../../content-store'
import { FetchQueue } from '../../fetch-queue'

// ---------------------------------------------------------------------------
// Mock tree-sitter–based extraction (used by analyzeCodebaseAsync)
// ---------------------------------------------------------------------------

const mockExtractTypesAsync = vi.fn<(content: string, lang: string) => Promise<ExtractedType[]>>()
const mockExtractClassesAsync = vi.fn<(content: string, lang: string) => Promise<ExtractedClass[]>>()

vi.mock('../extract-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../extract-types')>()
  return {
    ...actual,
    extractTypesAsync: (...args: [string, string]) => mockExtractTypesAsync(...args),
    extractClassesAsync: (...args: [string, string]) => mockExtractClassesAsync(...args),
  }
})

// ---------------------------------------------------------------------------
// Helper: build a minimal CodeIndex
// ---------------------------------------------------------------------------

function makeCodeIndex(
  files: Record<string, { content: string; language?: string }>,
): CodeIndex {
  const map = new Map<string, { path: string; name: string; content: string; language?: string; lines: string[]; lineCount: number }>()
  for (const [path, { content, language }] of Object.entries(files)) {
    const lines = content.split('\n')
    map.set(path, {
      path,
      name: path.split('/').pop() ?? path,
      content,
      language,
      lines,
      lineCount: lines.length,
    })
  }
  return { ...createEmptyIndex(), files: map, totalFiles: map.size, totalLines: 0 }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: async extractors return empty (= no Tree-sitter results)
  mockExtractTypesAsync.mockResolvedValue([])
  mockExtractClassesAsync.mockResolvedValue([])
})

// =========================================================================

describe('analyzeCodebaseAsync', () => {
  it('does not bulk-fetch an on-demand repository', async () => {
    const fetchFile = vi.fn(async (path: string) => `export const fetched = '${path}'`)
    const store = new LazyContentStore('owner/repo', new FetchQueue({ fetchFn: fetchFile }))
    store.registerPaths(['src/a.ts', 'src/b.ts'])
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/a.ts', language: 'typescript', lineCount: 1 },
      { path: 'src/b.ts', language: 'typescript', lineCount: 1 },
    ])

    await expect(analyzeCodebase(index)).rejects.toThrow('Content unavailable')
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('produces the same dependency graph when source exists only in ContentStore', async () => {
    const contents = {
      'src/app.ts': { content: "import { helper } from './helper'\nexport const app = helper" },
      'src/helper.ts': { content: 'export const helper = true' },
    }
    const inline = makeCodeIndex(contents)
    const stored = makeCodeIndex(contents)
    const source = new Map<string, string>()
    for (const [path, value] of Object.entries(contents)) {
      source.set(path, value.content)
      delete stored.files.get(path)!.content
    }
    stored.contentStore = {
      bulkReadMode: 'complete',
      get: async path => source.get(path) ?? null,
      getSync: () => null,
      getBatch: async paths => new Map(paths.flatMap(path => {
        const value = source.get(path)
        return value === undefined ? [] : [[path, value]]
      })),
      put: () => {},
      putBatch: () => {},
      has: path => source.has(path),
      delete: () => {},
      flush: async () => {},
      clear: async () => {},
      size: source.size,
    } satisfies ContentStore

    const inlineResult = await analyzeCodebaseAsync(inline)
    const storedResult = await analyzeCodebaseAsync(stored)

    expect(storedResult.graph.edges.get('src/app.ts')).toEqual(
      inlineResult.graph.edges.get('src/app.ts'),
    )
    expect(storedResult.files.get('src/app.ts')?.imports).toEqual(
      inlineResult.files.get('src/app.ts')?.imports,
    )
  })

  it('returns a FullAnalysis with files, graph, and topology', async () => {
    const idx = makeCodeIndex({
      'src/main.ts': { content: 'export function main() {}' },
    })

    const result = await analyzeCodebaseAsync(idx)
    expect(result.files).toBeInstanceOf(Map)
    expect(result.graph).toBeDefined()
    expect(result.topology).toBeDefined()
  })

  it('preserves JS/TS analysis — does not call async extractors for JS/TS', async () => {
    const idx = makeCodeIndex({
      'src/index.ts': { content: 'export interface Foo { bar: string }' },
      'src/utils.js': { content: 'export class Helper {}' },
    })

    const result = await analyzeCodebaseAsync(idx)

    // Async extractors should NOT be called for JS/TS files
    expect(mockExtractTypesAsync).not.toHaveBeenCalled()
    expect(mockExtractClassesAsync).not.toHaveBeenCalled()

    // JS/TS types/classes should still be extracted by the sync path
    const tsFile = result.files.get('src/index.ts')
    expect(tsFile).toBeDefined()
    expect(tsFile!.types.length).toBeGreaterThan(0)
    expect(tsFile!.types[0].name).toBe('Foo')
  })

  it('enhances non-JS/TS files with Tree-sitter results when richer', async () => {
    const pythonContent = 'class UserService:\n  name: str\n  def get_user(self): pass'
    const idx = makeCodeIndex({
      'app/service.py': { content: pythonContent },
    })

    // Tree-sitter returns MORE items than the sync regex → triggers replacement
    const treeSitterTypes: ExtractedType[] = [
      { name: 'UserService', kind: 'interface', properties: ['name: str'], exported: true },
    ]
    // Sync regex returns 1 class, so Tree-sitter must return 2+ to win
    const treeSitterClasses: ExtractedClass[] = [
      { name: 'UserService', methods: ['get_user'], properties: ['name'], exported: true },
      { name: 'HelperMixin', methods: ['help'], properties: [], exported: true },
    ]

    mockExtractTypesAsync.mockResolvedValue(treeSitterTypes)
    mockExtractClassesAsync.mockResolvedValue(treeSitterClasses)

    const result = await analyzeCodebaseAsync(idx)
    const pyFile = result.files.get('app/service.py')

    expect(pyFile).toBeDefined()
    // Sync regex returns no types for non-@dataclass Python → Tree-sitter wins (1 > 0)
    expect(pyFile!.types).toEqual(treeSitterTypes)
    // Tree-sitter returns 2 classes vs sync's 1 → Tree-sitter wins
    expect(pyFile!.classes).toHaveLength(2)
    expect(pyFile!.classes[0].name).toBe('UserService')
  })

  it('keeps regex results when Tree-sitter returns fewer items', async () => {
    // Regex extracts 1 class, Tree-sitter returns 0 → keep the regex result
    const pythonContent = 'class MyModel:\n  pass'
    const idx = makeCodeIndex({
      'models.py': { content: pythonContent },
    })

    mockExtractTypesAsync.mockResolvedValue([])
    mockExtractClassesAsync.mockResolvedValue([])

    const result = await analyzeCodebaseAsync(idx)
    const pyFile = result.files.get('models.py')

    // The sync regex path should have extracted the class
    // Tree-sitter returned empty, so the regex results are kept
    expect(pyFile).toBeDefined()
  })

  it('falls back gracefully when async extractors reject', async () => {
    const idx = makeCodeIndex({
      'lib.py': { content: 'class Broken:\n  pass' },
    })

    mockExtractTypesAsync.mockRejectedValue(new Error('WASM init failed'))
    mockExtractClassesAsync.mockRejectedValue(new Error('WASM init failed'))

    // Should propagate the error since Promise.all is used
    await expect(analyzeCodebaseAsync(idx)).rejects.toThrow('WASM init failed')
  })

  it('handles mixed JS/TS + non-JS/TS repos correctly', async () => {
    const idx = makeCodeIndex({
      'src/app.ts': { content: 'export class App {}' },
      'src/service.py': { content: 'class Service:\n  def run(self): pass' },
      'src/handler.go': { content: 'func HandleRequest() {}' },
    })

    const pyTypes: ExtractedType[] = [
      { name: 'Service', kind: 'interface', properties: [], exported: true },
    ]
    // Sync regex finds 1 Python class; Tree-sitter must return 2+ to win
    const pyClasses: ExtractedClass[] = [
      { name: 'Service', methods: ['run'], properties: [], exported: true },
      { name: 'ServiceBase', methods: ['init'], properties: [], exported: true },
    ]

    mockExtractTypesAsync.mockImplementation(async (_content, lang) => {
      if (lang === 'python') return pyTypes
      return []
    })
    mockExtractClassesAsync.mockImplementation(async (_content, lang) => {
      if (lang === 'python') return pyClasses
      return []
    })

    const result = await analyzeCodebaseAsync(idx)

    // JS/TS file should be untouched (async extractors not called for it)
    const tsFile = result.files.get('src/app.ts')
    expect(tsFile!.classes).toHaveLength(1)
    expect(tsFile!.classes[0].name).toBe('App')

    // Python file should have Tree-sitter results (2 > 1)
    const pyFile = result.files.get('src/service.py')
    expect(pyFile!.classes).toHaveLength(2)
    expect(pyFile!.classes[0].name).toBe('Service')

    // Go file had no Tree-sitter classes (returned []), regex also returns []
    const goFile = result.files.get('src/handler.go')
    expect(goFile!.classes).toHaveLength(0)
  })
})
