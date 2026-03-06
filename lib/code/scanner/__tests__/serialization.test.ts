import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import {
  serializeCodeIndex,
  deserializeCodeIndex,
  serializeScanResults,
  deserializeScanResults,
  serializeFullAnalysis,
  deserializeFullAnalysis,
} from '../serialization'
import type { ScanResults } from '../types'
import type { FullAnalysis } from '../../parser/types'

function buildTestIndex() {
  let index = createEmptyIndex()
  index = indexFile(index, 'src/app.ts', 'const x = 1;\nexport default x;\n', 'typescript')
  index = indexFile(index, 'src/utils.ts', 'export function add(a: number, b: number) { return a + b; }', 'typescript')
  return index
}

function buildScanResults(): ScanResults {
  return {
    issues: [
      {
        id: 'issue-1',
        ruleId: 'no-eval',
        category: 'security',
        severity: 'critical',
        title: 'Use of eval',
        description: 'eval is dangerous',
        file: 'src/app.ts',
        line: 1,
        column: 0,
        snippet: 'eval(x)',
      },
    ],
    summary: {
      total: 1,
      critical: 1,
      warning: 0,
      info: 0,
      bySecurity: 1,
      byBadPractice: 0,
      byReliability: 0,
    },
    healthGrade: 'D',
    healthScore: 40,
    ruleOverflow: new Map([['no-eval', 5], ['no-console', 12]]),
    languagesDetected: ['typescript'],
    rulesEvaluated: 268,
    scannedFiles: 2,
    scannedAt: new Date('2025-06-15T12:00:00Z'),
    securityGrade: 'D',
    qualityGrade: 'A',
    issuesPerKloc: 3.5,
  }
}

function buildFullAnalysis(): FullAnalysis {
  return {
    files: new Map([
      ['src/app.ts', { imports: ['./utils'], exports: ['default'], symbols: [], lines: 2, language: 'typescript' }],
      ['src/utils.ts', { imports: [], exports: ['add'], symbols: ['add'], lines: 1, language: 'typescript' }],
    ]),
    graph: {
      edges: new Map([['src/app.ts', new Set(['src/utils.ts'])]]),
      reverseEdges: new Map([['src/utils.ts', new Set(['src/app.ts'])]]),
      circular: [],
      externalDeps: new Map([['src/app.ts', new Set(['react'])]]),
    },
    topology: {
      entryPoints: ['src/app.ts'],
      hubs: [],
      orphans: [],
      leafNodes: ['src/utils.ts'],
      connectors: [],
      clusters: [['src/app.ts', 'src/utils.ts']],
      depthMap: new Map([['src/app.ts', 0], ['src/utils.ts', 1]]),
      maxDepth: 1,
    },
    detectedFramework: 'react',
    primaryLanguage: 'typescript',
  }
}

describe('serializeCodeIndex / deserializeCodeIndex', () => {
  it('round-trips a CodeIndex preserving Map contents', () => {
    const original = buildTestIndex()
    const serialized = serializeCodeIndex(original)
    const restored = deserializeCodeIndex(serialized)

    expect(restored.files).toBeInstanceOf(Map)
    expect(restored.files.size).toBe(original.files.size)
    expect(restored.totalFiles).toBe(original.totalFiles)
    expect(restored.totalLines).toBe(original.totalLines)
    expect(restored.isIndexing).toBe(original.isIndexing)

    for (const [path, file] of original.files) {
      const restoredFile = restored.files.get(path)
      expect(restoredFile).toBeDefined()
      expect(restoredFile!.content).toBe(file.content)
      expect(restoredFile!.language).toBe(file.language)
      expect(restoredFile!.lineCount).toBe(file.lineCount)
    }
  })

  it('round-trips an empty CodeIndex', () => {
    const original = createEmptyIndex()
    const serialized = serializeCodeIndex(original)
    const restored = deserializeCodeIndex(serialized)

    expect(restored.files.size).toBe(0)
    expect(restored.totalFiles).toBe(0)
    expect(restored.totalLines).toBe(0)
  })
})

describe('serializeScanResults / deserializeScanResults', () => {
  it('round-trips ScanResults preserving ruleOverflow Map and scannedAt Date', () => {
    const original = buildScanResults()
    const serialized = serializeScanResults(original)
    const restored = deserializeScanResults(serialized)

    expect(restored.ruleOverflow).toBeInstanceOf(Map)
    expect(restored.ruleOverflow.size).toBe(original.ruleOverflow.size)
    expect(restored.ruleOverflow.get('no-eval')).toBe(5)
    expect(restored.ruleOverflow.get('no-console')).toBe(12)

    expect(restored.scannedAt).toBeInstanceOf(Date)
    expect(restored.scannedAt.toISOString()).toBe(original.scannedAt.toISOString())

    expect(restored.issues).toEqual(original.issues)
    expect(restored.summary).toEqual(original.summary)
    expect(restored.healthGrade).toBe(original.healthGrade)
    expect(restored.healthScore).toBe(original.healthScore)
    expect(restored.scannedFiles).toBe(original.scannedFiles)
    expect(restored.rulesEvaluated).toBe(original.rulesEvaluated)
    expect(restored.languagesDetected).toEqual(original.languagesDetected)
  })

  it('serialized ruleOverflow is an array of tuples', () => {
    const original = buildScanResults()
    const serialized = serializeScanResults(original)

    expect(Array.isArray(serialized.ruleOverflow)).toBe(true)
    expect(serialized.ruleOverflow).toContainEqual(['no-eval', 5])
  })

  it('serialized scannedAt is an ISO string', () => {
    const original = buildScanResults()
    const serialized = serializeScanResults(original)

    expect(typeof serialized.scannedAt).toBe('string')
    expect(serialized.scannedAt).toBe('2025-06-15T12:00:00.000Z')
  })
})

describe('serializeFullAnalysis / deserializeFullAnalysis', () => {
  it('round-trips FullAnalysis preserving Map<string, Set<string>> edges', () => {
    const original = buildFullAnalysis()
    const serialized = serializeFullAnalysis(original)
    const restored = deserializeFullAnalysis(serialized)

    // graph.edges
    expect(restored.graph.edges).toBeInstanceOf(Map)
    expect(restored.graph.edges.get('src/app.ts')).toBeInstanceOf(Set)
    expect(restored.graph.edges.get('src/app.ts')!.has('src/utils.ts')).toBe(true)

    // graph.reverseEdges
    expect(restored.graph.reverseEdges).toBeInstanceOf(Map)
    expect(restored.graph.reverseEdges.get('src/utils.ts')!.has('src/app.ts')).toBe(true)

    // graph.externalDeps
    expect(restored.graph.externalDeps).toBeInstanceOf(Map)
    expect(restored.graph.externalDeps.get('src/app.ts')!.has('react')).toBe(true)

    // graph.circular
    expect(restored.graph.circular).toEqual(original.graph.circular)

    // topology.depthMap
    expect(restored.topology.depthMap).toBeInstanceOf(Map)
    expect(restored.topology.depthMap.get('src/app.ts')).toBe(0)
    expect(restored.topology.depthMap.get('src/utils.ts')).toBe(1)
    expect(restored.topology.maxDepth).toBe(1)

    // files
    expect(restored.files).toBeInstanceOf(Map)
    expect(restored.files.size).toBe(2)

    // Scalar fields
    expect(restored.detectedFramework).toBe('react')
    expect(restored.primaryLanguage).toBe('typescript')
  })

  it('preserves topology arrays', () => {
    const original = buildFullAnalysis()
    const restored = deserializeFullAnalysis(serializeFullAnalysis(original))

    expect(restored.topology.entryPoints).toEqual(['src/app.ts'])
    expect(restored.topology.leafNodes).toEqual(['src/utils.ts'])
    expect(restored.topology.clusters).toEqual([['src/app.ts', 'src/utils.ts']])
  })
})
