import { generateTreemap } from '@/lib/diagrams/generators/treemap'
import { createMockCodeIndex, createMockFileTree } from '@/lib/diagrams/__fixtures__/mock-analysis'
import { createEmptyIndex, type CodeIndex } from '@/lib/code/code-index'
import type { FileNode } from '@/types/repository'

describe('generateTreemap', () => {
  it('returns a valid TreemapDiagramResult with realistic data', () => {
    const codeIndex = createMockCodeIndex()
    const files = createMockFileTree()
    const result = generateTreemap(codeIndex, files)

    expect(result.type).toBe('treemap')
    expect(result.title).toContain('Treemap')
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(codeIndex.totalFiles)
    expect(result.stats.totalEdges).toBe(0)
  })

  it('builds a nested tree matching the file hierarchy', () => {
    const codeIndex = createMockCodeIndex()
    const files = createMockFileTree()
    const result = generateTreemap(codeIndex, files)

    // Top-level should be the 'src' directory
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('src')
    expect(result.data[0].children).toBeDefined()
    expect(result.data[0].children!.length).toBeGreaterThan(0)
  })

  it('aggregates lines correctly', () => {
    const codeIndex = createMockCodeIndex()
    const files = createMockFileTree()
    const result = generateTreemap(codeIndex, files)

    // src node should aggregate all children's lines
    const srcNode = result.data[0]
    const totalChildLines = srcNode.children!.reduce((sum, c) => sum + c.lines, 0)
    expect(srcNode.lines).toBe(totalChildLines)
  })

  it('skips files with zero lines', () => {
    const emptyCodeIndex: CodeIndex = createEmptyIndex()
    const files: FileNode[] = [
      { name: 'empty.ts', path: 'empty.ts', type: 'file' },
    ]

    const result = generateTreemap(emptyCodeIndex, files)

    // No indexed file data, so the file should be skipped
    expect(result.data).toHaveLength(0)
  })

  it('does not mislabel the largest file as most imported', () => {
    const codeIndex = createMockCodeIndex()
    const files = createMockFileTree()
    const result = generateTreemap(codeIndex, files)

    expect(result.stats.mostImported).toBeUndefined()
  })
})
