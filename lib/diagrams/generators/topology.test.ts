import { generateTopologyDiagram } from '@/lib/diagrams/generators/topology'
import { createRealisticAnalysis, createMinimalAnalysis, createEmptyAnalysis, createLargeAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'

describe('generateTopologyDiagram', () => {
  it('budgets file-level source while keeping rendered edges and omission stats exact', () => {
    const analysis = createEmptyAnalysis()
    const paths = Array.from({ length: 80 }, (_, index) => (
      `src/features/feature-${index.toString().padStart(2, '0')}-${'descriptive-segment-'.repeat(6)}/implementation-${index.toString().padStart(2, '0')}.ts`
    ))
    analysis.files = new Map(paths.map(path => [path, {
      path,
      imports: [],
      exports: [],
      types: [],
      classes: [],
      jsxComponents: [],
      language: 'typescript',
    }]))
    analysis.graph.edges = new Map(paths.map((path, index) => [
      path,
      new Set(Array.from({ length: 7 }, (_, offset) => paths[(index + offset + 1) % paths.length])),
    ]))
    analysis.graph.reverseEdges = new Map(paths.map((path, index) => [
      path,
      new Set(Array.from({ length: 7 }, (_, offset) => paths[(index - offset - 1 + paths.length) % paths.length])),
    ]))
    analysis.topology.entryPoints = [paths[0]]
    analysis.topology.clusters = [paths]

    const result = generateTopologyDiagram(analysis)
    const originalEdgeCount = [...analysis.graph.edges.values()].reduce((sum, dependencies) => sum + dependencies.size, 0)
    const renderedEdgeLines = result.chart.split('\n').filter(line => line.includes(' --> '))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.stats.omittedNodes).toBe(paths.length - result.stats.totalNodes)
    expect(result.stats.totalEdges).toBe(renderedEdgeLines.length)
    expect(result.stats.totalEdges + (result.stats.omittedEdges ?? 0)).toBe(originalEdgeCount)
    expect(result.chart).toContain('nodes and')
    expect(result.chart).toContain('edges omitted')
    expect(generateTopologyDiagram(analysis)).toEqual(result)

    for (const line of renderedEdgeLines) {
      const match = /^\s+(\S+)\s+-->\s+(\S+)$/.exec(line)
      expect(match).not.toBeNull()
      expect(result.nodePathMap.has(match![1])).toBe(true)
      expect(result.nodePathMap.has(match![2])).toBe(true)
    }
  })

  it('retains complete file edge pairs when long identifiers force node omissions', () => {
    const analysis = createEmptyAnalysis()
    const pairs = Array.from({ length: 40 }, (_, index) => ({
      source: `src/a${index.toString().padStart(2, '0')}${'-'.repeat(230)}.ts`,
      target: `src/z${index.toString().padStart(2, '0')}${'-'.repeat(230)}.ts`,
    }))
    const paths = pairs.flatMap(({ source, target }) => [source, target])
    analysis.files = new Map(paths.map(path => [path, {
      path,
      imports: [],
      exports: [],
      types: [],
      classes: [],
      jsxComponents: [],
      language: 'typescript',
    }]))
    analysis.graph.edges = new Map(pairs.map(({ source, target }) => [source, new Set([target])]))

    const result = generateTopologyDiagram(analysis)
    const renderedEdgeLines = result.chart.split('\n').filter(line => line.includes(' --> '))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes + (result.stats.omittedNodes ?? 0)).toBe(80)
    expect(result.stats.totalEdges).toBe(renderedEdgeLines.length)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges + (result.stats.omittedEdges ?? 0)).toBe(40)
    expect(generateTopologyDiagram(analysis)).toEqual(result)
    for (const line of renderedEdgeLines) {
      const match = /^\s+(\S+)\s+-->\s+(\S+)$/.exec(line)
      expect(match).not.toBeNull()
      expect(result.nodePathMap.has(match![1])).toBe(true)
      expect(result.nodePathMap.has(match![2])).toBe(true)
    }
  })

  it('caps directory-level edges below Mermaid limits and reports omissions', () => {
    const analysis = createLargeAnalysis(1)
    const files = new Map(analysis.files)
    const edges = new Map<string, Set<string>>()
    for (let i = 0; i < 600; i++) {
      const from = `dir-${i}/from.ts`
      const to = `dir-${i + 1}/to.ts`
      files.set(from, { path: from, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript' })
      files.set(to, { path: to, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript' })
      edges.set(from, new Set([to]))
    }
    analysis.files = files
    analysis.graph.edges = edges

    const result = generateTopologyDiagram(analysis)

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalEdges).toBeLessThan(500)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.chart).toContain('edges omitted')
  })

  it('retains a shared directory hub and adjacent entry relationships under budget', () => {
    const analysis = createEmptyAnalysis()
    const hubPath = 'shared/hub.ts'
    const entryPaths = Array.from({ length: 600 }, (_, index) => `entry-${index.toString().padStart(3, '0')}/index.ts`)
    const paths = [...entryPaths, hubPath]
    analysis.files = new Map(paths.map(path => [path, {
      path,
      imports: [],
      exports: [],
      types: [],
      classes: [],
      jsxComponents: [],
      language: 'typescript',
    }]))
    analysis.graph.edges = new Map(entryPaths.map(path => [path, new Set([hubPath])]))
    analysis.graph.reverseEdges = new Map([[hubPath, new Set(entryPaths)]])
    analysis.topology.entryPoints = entryPaths
    analysis.topology.hubs = [hubPath]
    analysis.topology.clusters = [paths]

    const result = generateTopologyDiagram(analysis)
    const renderedEdgeLines = result.chart.split('\n').filter(line => line.includes(' -->|'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect([...result.nodePathMap.values()]).toContain('shared')
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.stats.totalNodes + (result.stats.omittedNodes ?? 0)).toBe(601)
    expect(result.stats.totalEdges).toBe(renderedEdgeLines.length)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges + (result.stats.omittedEdges ?? 0)).toBe(600)
    expect(generateTopologyDiagram(analysis)).toEqual(result)

    for (const line of renderedEdgeLines) {
      const match = /^\s+(\S+)\s+-->\|"\d+"\|\s+(\S+)$/.exec(line)
      expect(match).not.toBeNull()
      expect(result.nodePathMap.has(match![1])).toBe(true)
      expect(result.nodePathMap.has(match![2])).toBe(true)
    }
  })

  it('retains complete directory edge pairs when disjoint relationships exceed the source budget', () => {
    const analysis = createEmptyAnalysis()
    const pairs = Array.from({ length: 400 }, (_, index) => {
      const suffix = `${index.toString().padStart(3, '0')}-${'descriptive-segment-'.repeat(3)}`
      return {
        source: `a-source-${suffix}/index.ts`,
        target: `z-target-${suffix}/index.ts`,
      }
    })
    const paths = pairs.flatMap(({ source, target }) => [source, target])
    analysis.files = new Map(paths.map(path => [path, {
      path,
      imports: [],
      exports: [],
      types: [],
      classes: [],
      jsxComponents: [],
      language: 'typescript',
    }]))
    analysis.graph.edges = new Map(pairs.map(({ source, target }) => [source, new Set([target])]))

    const result = generateTopologyDiagram(analysis)
    const renderedEdgeLines = result.chart.split('\n').filter(line => line.includes(' -->|'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes + (result.stats.omittedNodes ?? 0)).toBe(800)
    expect(result.stats.totalEdges).toBe(renderedEdgeLines.length)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges + (result.stats.omittedEdges ?? 0)).toBe(400)
    expect(generateTopologyDiagram(analysis)).toEqual(result)

    for (const line of renderedEdgeLines) {
      const match = /^\s+(\S+)\s+-->\|"1"\|\s+(\S+)$/.exec(line)
      expect(match).not.toBeNull()
      expect(result.nodePathMap.has(match![1])).toBe(true)
      expect(result.nodePathMap.has(match![2])).toBe(true)
    }
  })

  it('returns a valid MermaidDiagramResult for minimal input', () => {
    const result = generateTopologyDiagram(createMinimalAnalysis())

    expect(result.type).toBe('topology')
    expect(result.title).toContain('Architecture')
    expect(result.chart).toContain('flowchart TD')
    expect(result.stats.totalNodes).toBe(1)
    expect(result.nodePathMap.size).toBeGreaterThanOrEqual(1)
  })

  it('produces nodes and edges for a realistic analysis', () => {
    const result = generateTopologyDiagram(createRealisticAnalysis())

    expect(result.chart).toContain('flowchart TD')
    // Should reference file nodes
    expect(result.chart).toContain('entryStyle')
    expect(result.chart).toContain('hubStyle')
    expect(result.chart).toContain('orphanStyle')
    // Should have edges
    expect(result.chart).toContain('-->')
    // Circular dep should be displayed as dotted
    expect(result.chart).toContain('circular')
    expect(result.stats.totalNodes).toBe(8)
  })

  it('groups nodes into cluster subgraphs', () => {
    const result = generateTopologyDiagram(createRealisticAnalysis())

    // Both clusters have 2+ files, so they should be rendered as subgraphs
    expect(result.chart).toContain('subgraph cluster_0')
    expect(result.chart).toContain('subgraph cluster_1')
  })

  it('handles empty analysis without crashing', () => {
    const result = generateTopologyDiagram(createEmptyAnalysis())

    expect(result.type).toBe('topology')
    expect(result.stats.totalNodes).toBe(0)
  })

  it('populates nodePathMap for all rendered nodes', () => {
    const result = generateTopologyDiagram(createRealisticAnalysis())

    for (const path of result.nodePathMap.values()) {
      expect(path).toBeTruthy()
    }
  })

  it('collapses to directory-level view for large projects (>80 files)', () => {
    const result = generateTopologyDiagram(createLargeAnalysis(100))

    expect(result.type).toBe('topology')
    // Should reference directories, not individual files
    expect(result.chart).toContain('files)')
    // Should aggregate edges between directories
    expect(result.chart).toContain('-->')
    // Should have role-based classDefs
    expect(result.chart).toContain('classDef entryStyle')
    expect(result.chart).toContain('classDef hubStyle')
    // Node count should be number of unique directories, not 100
    expect(result.stats.totalNodes).toBeLessThan(100)
  })
})
