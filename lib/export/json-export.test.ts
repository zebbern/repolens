import { describe, it, expect, vi } from 'vitest'
import { buildExportableAnalysis, exportToJson } from './json-export'
import type { GitHubRepo } from '@/types/repository'
import { createEmptyIndex } from '@/lib/code/code-index'
import type { CodeIndex } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { ScanResults } from '@/lib/code/issue-scanner'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    owner: 'test-owner',
    name: 'test-repo',
    fullName: 'test-owner/test-repo',
    description: 'A test repository',
    defaultBranch: 'main',
    stars: 42,
    forks: 5,
    language: 'TypeScript',
    topics: [],
    isPrivate: false,
    url: 'https://github.com/test-owner/test-repo',
    openIssuesCount: 3,
    pushedAt: '2025-01-01T00:00:00Z',
    license: 'MIT',
    ...overrides,
  }
}

function createCodeIndex(overrides: Partial<CodeIndex> = {}): CodeIndex {
  return {
    ...createEmptyIndex(),
    totalFiles: 10,
    totalLines: 500,
    ...overrides,
  }
}

function createAnalysis(overrides: Partial<FullAnalysis> = {}): FullAnalysis {
  return {
    files: new Map([
      [
        'src/index.ts',
        {
          path: 'src/index.ts',
          imports: [
            {
              source: './utils',
              resolvedPath: 'src/utils.ts',
              specifiers: ['helper'],
              isExternal: false,
              isDefault: false,
            },
          ],
          exports: [],
          types: [],
          classes: [],
          jsxComponents: [],
          language: 'typescript',
        },
      ],
    ]),
    graph: {
      edges: new Map([['src/index.ts', new Set(['src/utils.ts'])]]),
      reverseEdges: new Map([['src/utils.ts', new Set(['src/index.ts'])]]),
      circular: [],
      externalDeps: new Map([['react', new Set(['src/App.tsx'])]]),
    },
    topology: {
      entryPoints: ['src/index.ts'],
      hubs: ['src/utils.ts'],
      orphans: [],
      leafNodes: ['src/utils.ts'],
      connectors: [],
      clusters: [['src/index.ts', 'src/utils.ts']],
      depthMap: new Map(),
      maxDepth: 1,
    },
    detectedFramework: 'React',
    primaryLanguage: 'TypeScript',
    ...overrides,
  }
}

function createScanResults(overrides: Partial<ScanResults> = {}): ScanResults {
  return {
    issues: [],
    summary: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      bySecurity: 0,
      byBadPractice: 0,
      byReliability: 0,
    },
    healthGrade: 'A',
    healthScore: 95,
    ruleOverflow: new Map(),
    languagesDetected: ['TypeScript'],
    rulesEvaluated: 30,
    scannedFiles: 10,
    scannedAt: new Date('2025-01-15T12:00:00Z'),
    securityGrade: 'A',
    qualityGrade: 'A',
    issuesPerKloc: 0,
    isPartialScan: false,
    suppressionCount: 0,
    ...overrides,
    diagnostics: overrides.diagnostics ?? { engines: {}, failures: [] },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildExportableAnalysis', () => {
  it('includes correct meta fields', () => {
    const repo = createRepo()
    const index = createCodeIndex({ totalFiles: 20, totalLines: 1500 })

    const result = buildExportableAnalysis(repo, index, null, null)

    expect(result.meta.repoFullName).toBe('test-owner/test-repo')
    expect(result.meta.repoUrl).toBe('https://github.com/test-owner/test-repo')
    expect(result.meta.totalFiles).toBe(20)
    expect(result.meta.totalLines).toBe(1500)
    expect(result.meta.exportedAt).toBeTruthy()
  })

  it('sets analysis and issues to null when not provided', () => {
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), null, null)

    expect(result.analysis).toBeNull()
    expect(result.issues).toBeNull()
  })

  it('serializes Map-based graph edges to plain objects', () => {
    const analysis = createAnalysis()
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), analysis, null)

    expect(result.analysis).not.toBeNull()
    expect(result.analysis!.graph.edges).toEqual({
      'src/index.ts': ['src/utils.ts'],
    })
    expect(result.analysis!.graph.reverseEdges).toEqual({
      'src/utils.ts': ['src/index.ts'],
    })
  })

  it('serializes Set-based external deps to arrays', () => {
    const analysis = createAnalysis()
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), analysis, null)

    expect(result.analysis!.graph.externalDeps).toEqual({
      react: ['src/App.tsx'],
    })
  })

  it('serializes file analysis imports correctly', () => {
    const analysis = createAnalysis()
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), analysis, null)

    const files = result.analysis!.files as Record<string, { imports: unknown[] }>
    expect(files['src/index.ts'].imports).toEqual([
      {
        source: './utils',
        resolvedPath: 'src/utils.ts',
        specifiers: ['helper'],
        isExternal: false,
        isDefault: false,
      },
    ])
  })

  it('preserves topology fields', () => {
    const analysis = createAnalysis()
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), analysis, null)

    expect(result.analysis!.topology).toEqual({
      entryPoints: ['src/index.ts'],
      hubs: ['src/utils.ts'],
      orphans: [],
      leafNodes: ['src/utils.ts'],
      connectors: [],
      clusters: [['src/index.ts', 'src/utils.ts']],
      maxDepth: 1,
    })
  })

  it('serializes scan results with ISO date', () => {
    const scanResults = createScanResults()
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), null, scanResults)

    expect(result.issues).not.toBeNull()
    expect(result.issues!.scannedAt).toBe('2025-01-15T12:00:00.000Z')
    expect(result.issues!.healthGrade).toBe('A')
    expect(result.issues!.healthScore).toBe(95)
    expect(result.issues!.languagesDetected).toEqual(['TypeScript'])
  })

  it('handles analysis with empty Maps', () => {
    const analysis = createAnalysis({
      files: new Map(),
      graph: {
        edges: new Map(),
        reverseEdges: new Map(),
        circular: [],
        externalDeps: new Map(),
      },
    })
    const result = buildExportableAnalysis(createRepo(), createCodeIndex(), analysis, null)

    expect(result.analysis!.files).toEqual({})
    expect(result.analysis!.graph.edges).toEqual({})
    expect(result.analysis!.graph.reverseEdges).toEqual({})
    expect(result.analysis!.graph.externalDeps).toEqual({})
  })
})

describe('exportToJson', () => {
  it('returns valid JSON string', () => {
    const json = exportToJson(createRepo(), createCodeIndex(), null, null)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('produces pretty-printed JSON with 2-space indentation', () => {
    const json = exportToJson(createRepo(), createCodeIndex(), null, null)
    // Pretty-printed JSON will have newlines and indentation
    expect(json).toContain('\n')
    expect(json).toContain('  ')
  })

  it('round-trips analysis data through JSON.parse', () => {
    const analysis = createAnalysis()
    const scanResults = createScanResults()

    const json = exportToJson(createRepo(), createCodeIndex(), analysis, scanResults)
    const parsed = JSON.parse(json)

    expect(parsed.meta.repoFullName).toBe('test-owner/test-repo')
    expect(parsed.analysis.detectedFramework).toBe('React')
    expect(parsed.issues.healthGrade).toBe('A')
  })
})
