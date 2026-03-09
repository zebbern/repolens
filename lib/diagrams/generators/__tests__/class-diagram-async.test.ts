import { generateDiagramAsync, generateDiagram } from '../index'
import type { CodeIndex } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'
import type { FileNode } from '@/types/repository'
import type { FullAnalysis, ExtractedType, ExtractedClass } from '@/lib/code/parser/types'
import { analyzeCodebase } from '@/lib/code/import-parser'

// ---------------------------------------------------------------------------
// Mock analyzeCodebaseAsync (used by generateDiagramAsync for class diagrams)
// and analyzeCodebase (used by generateDiagram sync path)
// ---------------------------------------------------------------------------

const mockAnalyzeCodebaseAsync = vi.fn<(idx: CodeIndex) => Promise<FullAnalysis>>()

vi.mock('@/lib/code/parser/analyzer', () => ({
  analyzeCodebaseAsync: (...args: [CodeIndex]) => mockAnalyzeCodebaseAsync(...args),
}))

vi.mock('@/lib/code/import-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/code/import-parser')>()
  return {
    ...actual,
    analyzeCodebase: vi.fn((idx: CodeIndex) => {
      // Return a minimal FullAnalysis for sync path
      return {
        files: new Map(
          Array.from(idx.files.entries()).map(([p, f]) => [
            p,
            { path: p, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript' },
          ]),
        ),
        graph: { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() },
        topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
        detectedFramework: null,
        primaryLanguage: 'typescript',
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCodeIndex(
  files: Record<string, string>,
): CodeIndex {
  const map = new Map<string, { path: string; name: string; content: string; lines: string[]; lineCount: number }>()
  for (const [path, content] of Object.entries(files)) {
    const lines = content.split('\n')
    map.set(path, { path, name: path.split('/').pop() ?? path, content, lines, lineCount: lines.length })
  }
  return { files: map, totalFiles: map.size, totalLines: 0, isIndexing: false, meta: new Map(), contentStore: new InMemoryContentStore() }
}

function makeFullAnalysis(overrides?: Partial<FullAnalysis>): FullAnalysis {
  return {
    files: new Map(),
    graph: { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() },
    topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
    detectedFramework: null,
    primaryLanguage: 'typescript',
    ...overrides,
  }
}

function makeFileNode(path: string): FileNode {
  return { path, name: path.split('/').pop() ?? path, type: 'file' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// =========================================================================

describe('generateDiagramAsync', () => {
  it('delegates non-class diagram types to the sync path', async () => {
    const idx = makeCodeIndex({ 'src/app.ts': 'export function main() {}' })
    const files = [makeFileNode('src/app.ts')]

    const syncResult = await generateDiagram('topology', idx, files)
    const asyncResult = await generateDiagramAsync('topology', idx, files)

    // Both should produce the same output
    expect(asyncResult.type).toBe(syncResult.type)
    expect(asyncResult.title).toBe(syncResult.title)
    // analyzeCodebaseAsync should NOT be called for non-class diagrams
    expect(mockAnalyzeCodebaseAsync).not.toHaveBeenCalled()
  })

  it('delegates imports diagram to sync path', async () => {
    const idx = makeCodeIndex({ 'src/a.ts': 'import { b } from "./b"', 'src/b.ts': 'export const b = 1' })
    const files = [makeFileNode('src/a.ts'), makeFileNode('src/b.ts')]

    const result = await generateDiagramAsync('imports', idx, files)
    expect(result.type).toBe('imports')
    expect(mockAnalyzeCodebaseAsync).not.toHaveBeenCalled()
  })

  it('uses analyzeCodebaseAsync for class diagrams', async () => {
    const idx = makeCodeIndex({
      'src/service.py': 'class Service:\n  def run(self): pass',
    })
    const files = [makeFileNode('src/service.py')]

    const pyClasses: ExtractedClass[] = [
      { name: 'Service', methods: ['run'], properties: [], exported: true },
    ]
    const pyTypes: ExtractedType[] = [
      { name: 'Service', kind: 'interface', properties: ['run(): void'], exported: true },
    ]

    const enhancedAnalysis = makeFullAnalysis({
      files: new Map([
        ['src/service.py', {
          path: 'src/service.py',
          imports: [],
          exports: [],
          types: pyTypes,
          classes: pyClasses,
          jsxComponents: [],
          language: 'python',
        }],
      ]),
    })

    mockAnalyzeCodebaseAsync.mockResolvedValue(enhancedAnalysis)

    const result = await generateDiagramAsync('classes', idx, files)

    expect(mockAnalyzeCodebaseAsync).toHaveBeenCalledWith(idx)
    expect(result.type).toBe('classes')
    // The class diagram should contain the Python class
    if ('chart' in result) {
      expect(result.chart).toContain('Service')
    }
  })

  it('returns a valid class diagram even with empty analysis', async () => {
    const idx = makeCodeIndex({ 'readme.md': '# Hello' })
    const files = [makeFileNode('readme.md')]

    mockAnalyzeCodebaseAsync.mockResolvedValue(makeFullAnalysis())

    const result = await generateDiagramAsync('classes', idx, files)
    expect(result.type).toBe('classes')
    // Should not throw, should return a valid result with some chart content
    if ('chart' in result) {
      expect(typeof result.chart).toBe('string')
    }
  })

  it('propagates errors from analyzeCodebaseAsync', async () => {
    const idx = makeCodeIndex({ 'app.py': 'class Broken: pass' })
    const files = [makeFileNode('app.py')]

    mockAnalyzeCodebaseAsync.mockRejectedValue(new Error('Tree-sitter init failed'))

    await expect(generateDiagramAsync('classes', idx, files)).rejects.toThrow('Tree-sitter init failed')
  })

  it('handles entrypoints diagram via sync path', async () => {
    const idx = makeCodeIndex({ 'src/index.ts': 'console.log("hi")' })
    const files = [makeFileNode('src/index.ts')]

    const result = await generateDiagramAsync('entrypoints', idx, files)
    expect(result.type).toBe('entrypoints')
    expect(mockAnalyzeCodebaseAsync).not.toHaveBeenCalled()
  })

  it('handles modules diagram via sync path', async () => {
    const idx = makeCodeIndex({ 'src/mod.ts': 'export const x = 1' })
    const files = [makeFileNode('src/mod.ts')]

    const result = await generateDiagramAsync('modules', idx, files)
    expect(result.type).toBe('modules')
    expect(mockAnalyzeCodebaseAsync).not.toHaveBeenCalled()
  })
})
