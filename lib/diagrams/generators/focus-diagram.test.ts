import { generateFocusDiagram } from '@/lib/diagrams/generators/focus-diagram'
import { createRealisticAnalysis, createEmptyAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'
import { sanitizeId } from '@/lib/diagrams/helpers'
import type { FullAnalysis } from '@/lib/code/import-parser'

describe('generateFocusDiagram', () => {
  it('caps rendered edges below Mermaid limits and reports omissions', () => {
    const edges = new Map<string, Set<string>>([['src/target.ts', new Set(Array.from({ length: 600 }, (_, i) => `src/dep-${i}.ts`))]])
    const reverseEdges = new Map<string, Set<string>>()
    edges.get('src/target.ts')!.forEach(path => reverseEdges.set(path, new Set(['src/target.ts'])))
    const analysis: FullAnalysis = {
      files: new Map(), graph: { edges, reverseEdges, circular: [], externalDeps: new Map() },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = generateFocusDiagram(analysis, 'src/target.ts', 1)

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalEdges).toBeLessThan(500)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.chart).toContain('edges omitted')
  })

  it('keeps the focal file connected when dense context exceeds the edge budget', () => {
    const target = 'zzz/target.ts'
    const directDependency = 'aaa/direct.ts'
    const contextPaths = Array.from({ length: 24 }, (_, index) => `aaa/context-${index.toString().padStart(2, '0')}.ts`)
    const edges = new Map<string, Set<string>>([
      [target, new Set([directDependency])],
      [directDependency, new Set(contextPaths)],
      ...contextPaths.map(path => [path, new Set(contextPaths.filter(candidate => candidate !== path))] as const),
    ])
    const reverseEdges = new Map<string, Set<string>>()
    for (const [from, dependencies] of edges) {
      for (const to of dependencies) {
        const importers = reverseEdges.get(to) ?? new Set<string>()
        importers.add(from)
        reverseEdges.set(to, importers)
      }
    }
    const analysis: FullAnalysis = {
      files: new Map(), graph: { edges, reverseEdges, circular: [], externalDeps: new Map() },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = generateFocusDiagram(analysis, target, 2)
    const repeated = generateFocusDiagram(analysis, target, 2)
    const renderedEdges = [...result.chart.matchAll(/^  (\S+) --> (\S+)$/gm)]

    expect(result.chart).toContain(`  ${sanitizeId(target)} --> ${sanitizeId(directDependency)}`)
    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats).toMatchObject({ totalNodes: 26, totalEdges: 499, omittedNodes: 0, omittedEdges: 78 })
    expect(renderedEdges).toHaveLength(499)
    for (const [, from, to] of renderedEdges) {
      expect(result.nodePathMap.has(from)).toBe(true)
      expect(result.nodePathMap.has(to)).toBe(true)
    }
    expect(repeated.chart).toBe(result.chart)
    expect(repeated.stats).toEqual(result.stats)
  })

  it('keeps direct dependencies styled as dependencies in two-hop mode', () => {
    const analysis: FullAnalysis = {
      files: new Map(),
      graph: {
        edges: new Map([
          ['src/target.ts', new Set(['src/dep.ts'])],
          ['src/dep.ts', new Set(['src/dep-deeper.ts'])],
        ]),
        reverseEdges: new Map([
          ['src/target.ts', new Set(['src/importer.ts'])],
          ['src/importer.ts', new Set(['src/importer-higher.ts'])],
        ]),
        circular: [], externalDeps: new Map(),
      },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = generateFocusDiagram(analysis, 'src/target.ts', 2)

    expect(result.chart).toContain(`${sanitizeId('src/dep.ts')}["dep.ts"]:::depStyle`)
    expect(result.chart).toContain(`${sanitizeId('src/importer.ts')}["importer.ts"]:::importerStyle`)
  })

  it('retains undirected peers from both sides of the first hop', () => {
    const analysis: FullAnalysis = {
      files: new Map(),
      graph: {
        edges: new Map([
          ['src/target.ts', new Set(['src/dep.ts'])],
          ['src/importer.ts', new Set(['src/target.ts', 'src/importer-dep.ts'])],
        ]),
        reverseEdges: new Map([
          ['src/target.ts', new Set(['src/importer.ts'])],
          ['src/dep.ts', new Set(['src/target.ts', 'src/dep-peer.ts'])],
        ]),
        circular: [], externalDeps: new Map(),
      },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }
    const result = generateFocusDiagram(analysis, 'src/target.ts', 2)

    expect([...result.nodePathMap.values()]).toContain('src/dep-peer.ts')
    expect([...result.nodePathMap.values()]).toContain('src/importer-dep.ts')
  })

  it('shows immediate neighbors with 1-hop focus', () => {
    const analysis = createRealisticAnalysis()
    const result = generateFocusDiagram(analysis, 'src/app.tsx', 1)

    expect(result.type).toBe('focus')
    expect(result.title).toContain('app.tsx')
    expect(result.title).toContain('1-hop')
    expect(result.chart).toContain('flowchart LR')
    expect(result.chart).toContain('targetStyle')
    // Should include direct deps (Button.tsx, helpers.ts) and importers (index.ts)
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(4)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
  })

  it('expands neighborhood with 2-hop focus', () => {
    const analysis = createRealisticAnalysis()
    const result1 = generateFocusDiagram(analysis, 'src/app.tsx', 1)
    const result2 = generateFocusDiagram(analysis, 'src/app.tsx', 2)

    // 2-hop should include more nodes than 1-hop
    expect(result2.stats.totalNodes).toBeGreaterThanOrEqual(result1.stats.totalNodes)
    expect(result2.title).toContain('2-hop')
  })

  it('shows isolated message for a file with no connections', () => {
    const analysis = createRealisticAnalysis()
    const result = generateFocusDiagram(analysis, 'src/orphan.ts', 1)

    expect(result.chart).toContain('No connections found')
    expect(result.stats.totalNodes).toBe(1)
  })

  it('handles a file not in the graph', () => {
    const analysis = createRealisticAnalysis()
    const result = generateFocusDiagram(analysis, 'nonexistent/file.ts', 1)

    expect(result.type).toBe('focus')
    expect(result.chart).toContain('No connections found')
    expect(result.stats.totalNodes).toBe(1)
  })

  it('populates nodePathMap for all neighborhood nodes', () => {
    const analysis = createRealisticAnalysis()
    const result = generateFocusDiagram(analysis, 'src/types.ts', 1)

    // src/types.ts is a hub, imported by multiple files
    expect(result.nodePathMap.size).toBeGreaterThan(1)
    for (const path of result.nodePathMap.values()) {
      expect(path).toBeTruthy()
    }
  })

  it('handles completely empty analysis without crashing', () => {
    const analysis = createEmptyAnalysis()
    const result = generateFocusDiagram(analysis, 'any-file.ts', 1)

    expect(result.type).toBe('focus')
    expect(result.chart).toContain('No connections found')
    expect(result.stats.totalNodes).toBe(1)
  })

  it('handles empty string as focusTarget', () => {
    const analysis = createRealisticAnalysis()
    const result = generateFocusDiagram(analysis, '', 1)

    expect(result.type).toBe('focus')
    // Empty target should not crash
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(1)
  })
})
