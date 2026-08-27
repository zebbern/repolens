import { generateModuleUsageTree } from '@/lib/diagrams/generators/module-usage'
import { createRealisticAnalysis, createMinimalAnalysis, createEmptyAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { FileAnalysis } from '@/lib/code/parser/types'

describe('generateModuleUsageTree', () => {
  it('keeps a large component chart within the source budget and reports omissions', () => {
    const files = new Map<string, FileAnalysis>()
    for (let i = 0; i < 700; i++) {
      const path = `src/components/Component${i}.tsx`
      const next = (i + 1) % 700
      files.set(path, {
        path, language: 'typescript',
        imports: [{ source: `./Component${next}`, resolvedPath: `src/components/Component${next}.tsx`, specifiers: [`Component${next}`], isExternal: false, isDefault: false }],
        exports: [{ name: `Component${i}`, kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [`Component${next}`],
      })
    }
    const analysis = createMinimalAnalysis()
    analysis.files = files

    const result = generateModuleUsageTree(analysis)

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.omittedEdges).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
  })

  it('prioritizes high-degree rendered targets in a large component star', () => {
    const files = new Map<string, FileAnalysis>()
    const target = 'src/components/Shared.tsx'
    files.set(target, {
      path: target, language: 'typescript', imports: [],
      exports: [{ name: 'Shared', kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [],
    })
    for (let i = 0; i < 700; i++) {
      const path = `src/pages/Page${i}.tsx`
      files.set(path, {
        path, language: 'typescript',
        imports: [{ source: '../components/Shared', resolvedPath: target, specifiers: ['Shared'], isExternal: false, isDefault: false }],
        exports: [{ name: `Page${i}`, kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: ['Shared'],
      })
    }
    const analysis = createMinimalAnalysis()
    analysis.files = files

    const result = generateModuleUsageTree(analysis)

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.omittedEdges).toBeGreaterThan(0)
  })

  it('retains both endpoints of useful disjoint component relationships', () => {
    const files = new Map<string, FileAnalysis>()
    for (let i = 0; i < 700; i++) {
      const page = `src/pages/Page${i}.tsx`
      const leaf = `src/components/Leaf${i}.tsx`
      files.set(page, { path: page, language: 'typescript', imports: [{ source: `../components/Leaf${i}`, resolvedPath: leaf, specifiers: [`Leaf${i}`], isExternal: false, isDefault: false }], exports: [{ name: `Page${i}`, kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [`Leaf${i}`] })
      files.set(leaf, { path: leaf, language: 'typescript', imports: [], exports: [{ name: `Leaf${i}`, kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [] })
    }
    const analysis = createMinimalAnalysis()
    analysis.files = files

    const result = generateModuleUsageTree(analysis)

    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.chart).toContain('-->')
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
  })

  it('caps reverse-dependency edges and reports omissions', () => {
    const importers = new Set(Array.from({ length: 600 }, (_, i) => `src/importer-${i}.ts`))
    const analysis = createMinimalAnalysis()
    const files = new Map<string, FileAnalysis>()
    files.set('src/hub.ts', { path: 'src/hub.ts', language: 'typescript', imports: [], exports: [{ name: 'hub', kind: 'function', isDefault: false }], types: [], classes: [], jsxComponents: [] })
    for (const path of importers) {
      files.set(path, { path, language: 'typescript', imports: [], exports: [], types: [], classes: [], jsxComponents: [] })
    }
    analysis.files = files
    analysis.graph.reverseEdges = new Map([['src/hub.ts', importers]])
    analysis.graph.edges = new Map()
    analysis.topology.hubs = ['src/hub.ts']

    const result = generateModuleUsageTree(analysis)

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalEdges).toBeLessThan(500)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.chart).toContain('edges omitted')
  })

  it('resolves duplicate component names through the current file import', () => {
    const analysis: FullAnalysis = {
      files: new Map([
        ['src/pages/Home.tsx', {
          path: 'src/pages/Home.tsx', language: 'typescript',
          imports: [{ source: '../components/Button', resolvedPath: 'src/components/Button.tsx', specifiers: ['Button'], isExternal: false, isDefault: false }],
          exports: [{ name: 'Home', kind: 'component', isDefault: true }], types: [], classes: [], jsxComponents: ['Button'],
        }],
        ['src/components/Button.tsx', {
          path: 'src/components/Button.tsx', language: 'typescript', imports: [],
          exports: [{ name: 'Button', kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [],
        }],
        ['src/other/Button.tsx', {
          path: 'src/other/Button.tsx', language: 'typescript', imports: [],
          exports: [{ name: 'Button', kind: 'component', isDefault: false }], types: [], classes: [], jsxComponents: [],
        }],
      ]),
      graph: { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = generateModuleUsageTree(analysis)

    expect([...result.nodePathMap.values()]).toContain('src/components/Button.tsx')
    expect([...result.nodePathMap.values()]).not.toContain('src/other/Button.tsx')
  })

  it('produces a JSX component tree when jsxComponents exist', () => {
    const result = generateModuleUsageTree(createRealisticAnalysis())

    expect(result.type).toBe('modules')
    expect(result.title).toContain('Component Tree')
    expect(result.chart).toContain('flowchart TD')
    // Should have edges from JSX render relationships
    expect(result.chart).toContain('-->')
    expect(result.stats.totalNodes).toBeGreaterThan(0)
  })

  it('falls back to hub-based tree when no JSX components', () => {
    const analysis = createRealisticAnalysis()
    // Remove all JSX component data
    for (const [, fileAnalysis] of analysis.files) {
      fileAnalysis.jsxComponents = []
      for (const exp of fileAnalysis.exports) {
        if (exp.kind === 'component') exp.kind = 'function'
      }
    }

    const result = generateModuleUsageTree(analysis)

    expect(result.type).toBe('modules')
    // Should show hub usage (src/types.ts is a hub)
    expect(result.chart).toContain('hubStyle')
    expect(result.stats.totalNodes).toBeGreaterThan(0)
  })

  it('shows empty message if no hubs and no JSX components', () => {
    const result = generateModuleUsageTree(createMinimalAnalysis())

    expect(result.type).toBe('modules')
    expect(result.chart).toContain('No module dependency tree to show')
    expect(result.stats.totalNodes).toBe(0)
  })

  it('handles empty analysis', () => {
    const result = generateModuleUsageTree(createEmptyAnalysis())

    expect(result.type).toBe('modules')
    expect(result.stats.totalNodes).toBe(0)
  })
})
