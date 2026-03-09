import { generateDiagram } from '@/lib/diagrams/generators/index'
import { createRealisticAnalysis, createMockCodeIndex, createMockFileTree } from '@/lib/diagrams/__fixtures__/mock-analysis'
import type { CodeIndex } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'

describe('generateDiagram dispatcher', () => {
  const analysis = createRealisticAnalysis()
  const codeIndex = createMockCodeIndex()
  const files = createMockFileTree()

  it('routes "topology" to generateTopologyDiagram', async () => {
    const result = await generateDiagram('topology', codeIndex, files, analysis)
    expect(result.type).toBe('topology')
    expect('chart' in result).toBe(true)
  })

  it('routes "imports" to generateImportGraph', async () => {
    const result = await generateDiagram('imports', codeIndex, files, analysis)
    expect(result.type).toBe('imports')
    expect('chart' in result).toBe(true)
  })

  it('routes "classes" to generateClassDiagram', async () => {
    const result = await generateDiagram('classes', codeIndex, files, analysis)
    expect(result.type).toBe('classes')
  })

  it('routes "entrypoints" to generateEntryPoints', async () => {
    const result = await generateDiagram('entrypoints', codeIndex, files, analysis)
    expect(result.type).toBe('entrypoints')
  })

  it('routes "modules" to generateModuleUsageTree', async () => {
    const result = await generateDiagram('modules', codeIndex, files, analysis)
    expect(result.type).toBe('modules')
  })

  it('routes "treemap" to generateTreemap', async () => {
    const result = await generateDiagram('treemap', codeIndex, files, analysis)
    expect(result.type).toBe('treemap')
    expect('data' in result).toBe(true)
  })

  it('routes "externals" to generateExternalDeps', async () => {
    const result = await generateDiagram('externals', codeIndex, files, analysis)
    expect(result.type).toBe('externals')
  })

  it('routes "focus" to generateFocusDiagram with focusTarget', async () => {
    const result = await generateDiagram('focus', codeIndex, files, analysis, 'src/app.tsx', 1)
    expect(result.type).toBe('focus')
    expect('chart' in result).toBe(true)
  })

  it('defaults to topology for unrecognized type', async () => {
    const result = await generateDiagram('unknown' as any, codeIndex, files, analysis)
    expect(result.type).toBe('topology')
  })

  it('creates analysis from codeIndex if analysis is not provided', async () => {
    // This tests the fallback path that calls analyzeCodebase.
    // With an empty code index, it should still return without crashing.
    const emptyIndex: CodeIndex = {
      files: new Map(),
      totalFiles: 0,
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: new InMemoryContentStore(),
    }
    const result = await generateDiagram('topology', emptyIndex, [])
    expect(result.type).toBe('topology')
  })

  it('routes "focus" with default empty target when focusTarget is omitted', async () => {
    const result = await generateDiagram('focus', codeIndex, files, analysis)
    expect(result.type).toBe('focus')
    // Should not crash even without focusTarget/focusHops
  })

  it('routes all diagram types without crashing on empty analysis', async () => {
    const emptyIndex: CodeIndex = {
      files: new Map(),
      totalFiles: 0,
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: new InMemoryContentStore(),
    }
    const types: Array<'topology' | 'imports' | 'classes' | 'entrypoints' | 'modules' | 'treemap' | 'externals'> = [
      'topology', 'imports', 'classes', 'entrypoints', 'modules', 'treemap', 'externals',
    ]
    for (const type of types) {
      const result = await generateDiagram(type, emptyIndex, [])
      expect(result.type).toBe(type)
    }
  })
})
