import { generateEntryPoints } from '@/lib/diagrams/generators/entry-points'
import { createRealisticAnalysis, createEmptyAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'
import type { CodeIndex } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'
import type { FileNode } from '@/types/repository'
import type { FullAnalysis } from '@/lib/code/import-parser'

function createNextJsAnalysis() {
  const analysis = createRealisticAnalysis()
  analysis.detectedFramework = 'Next.js'
  return analysis
}

function createNextJsFiles(): FileNode[] {
  return [
    {
      name: 'app',
      path: 'app',
      type: 'directory',
      children: [
        { name: 'page.tsx', path: 'app/page.tsx', type: 'file' },
        { name: 'layout.tsx', path: 'app/layout.tsx', type: 'file' },
        {
          name: 'about',
          path: 'app/about',
          type: 'directory',
          children: [
            { name: 'page.tsx', path: 'app/about/page.tsx', type: 'file' },
          ],
        },
        {
          name: 'api',
          path: 'app/api',
          type: 'directory',
          children: [
            {
              name: 'hello',
              path: 'app/api/hello',
              type: 'directory',
              children: [
                { name: 'route.ts', path: 'app/api/hello/route.ts', type: 'file' },
              ],
            },
          ],
        },
      ],
    },
  ]
}

function createNuxtVueFiles(): FileNode[] {
  return [{
    name: 'pages', path: 'pages', type: 'directory',
    children: [
      { name: 'index.vue', path: 'pages/index.vue', type: 'file' },
      {
        name: 'users', path: 'pages/users', type: 'directory',
        children: [{ name: '[id].vue', path: 'pages/users/[id].vue', type: 'file' }],
      },
      {
        name: 'pages', path: 'app/pages', type: 'directory',
        children: [
          { name: 'index.vue', path: 'app/pages/index.vue', type: 'file' },
          { name: 'about.vue', path: 'app/pages/about.vue', type: 'file' },
        ],
      },
    ],
  }]
}

function createManyNextPages(count: number): FileNode[] {
  return [{
    name: 'pages', path: 'pages', type: 'directory',
    children: Array.from({ length: count }, (_, i) => ({ name: `page-${i}.tsx`, path: `pages/page-${i}.tsx`, type: 'file' as const })),
  }]
}

function createMinimalCodeIndex(): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
    isIndexing: false,
    meta: new Map(),
    contentStore: new InMemoryContentStore(),
  }
}

describe('generateEntryPoints', () => {
  it('bounds a large Next route chart and reports omitted nodes and edges', async () => {
    const analysis = createNextJsAnalysis()
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), createManyNextPages(600))
    const arrows = result.chart.split('\n').filter(line => line.includes('-->'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.stats.totalEdges).toBe(arrows.length)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.omittedEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges).toBeLessThan(500)
  })

  it('bounds a large generic entry-point chart without dangling omitted edges', async () => {
    const entries = Array.from({ length: 600 }, (_, i) => `src/routes/route-${i}.ts`)
    const files = new Map(entries.map(path => [path, {
      path, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript',
    }]))
    const analysis: FullAnalysis = {
      files,
      graph: {
        edges: new Map(entries.map((path, i) => [path, new Set([`src/deps/dep-${i}.ts`])])),
        reverseEdges: new Map(), circular: [], externalDeps: new Map(),
      },
      topology: { entryPoints: entries, hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 1 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), [])
    const arrows = result.chart.split('\n').filter(line => line.includes('-->'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes).toBe(result.nodePathMap.size)
    expect(result.stats.totalEdges).toBe(arrows.length)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.omittedEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges).toBeLessThan(500)
  })

  it('uses generic fallback for an analysis with entry points', async () => {
    const analysis = createRealisticAnalysis()
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), [])

    expect(result.type).toBe('entrypoints')
    expect(result.title).toContain('Entry Points')
    // src/index.ts is the entry point
    expect(result.chart).toContain('entryStyle')
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(1)
  })

  it('detects Next.js routes when framework is Next.js', async () => {
    const analysis = createNextJsAnalysis()
    const files = createNextJsFiles()
    const codeIndex = createMinimalCodeIndex()

    const result = await generateEntryPoints(analysis, codeIndex, files)

    expect(result.type).toBe('entrypoints')
    expect(result.title).toContain('Route')
    expect(result.chart).toContain('pageStyle')
    // Should have detected root page
    expect(result.chart).toContain('/')
    expect(result.stats.totalEdges).toBeGreaterThan(0)
  })

  it('does not treat partial app or pages directory names as Next.js routes', async () => {
    const analysis = createNextJsAnalysis()
    const files: FileNode[] = [
      { name: 'page.tsx', path: 'src/myapp/foo/page.tsx', type: 'file' },
      { name: 'report.tsx', path: 'src/mypages/report.tsx', type: 'file' },
    ]

    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), files)

    expect(result.title).toMatch(/^Entry Points/)
    expect([...result.nodePathMap.values()]).not.toContain('src/myapp/foo/page.tsx')
    expect([...result.nodePathMap.values()]).not.toContain('src/mypages/report.tsx')
  })

  it('shows empty message when no entry points exist', async () => {
    const analysis = createEmptyAnalysis()
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), [])

    expect(result.type).toBe('entrypoints')
    expect(result.chart).toContain('No entry points detected')
    expect(result.stats.totalNodes).toBe(0)
  })

  it('includes first-level dependencies of generic entry points', async () => {
    const analysis = createRealisticAnalysis()
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), [])

    // src/index.ts has dep on src/app.tsx
    expect(result.chart).toContain('-->')
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(2)
  })

  it('detects Express routes when framework is Express', async () => {
    const analysis = createRealisticAnalysis()
    analysis.detectedFramework = 'Express'
    
    // Add route content to the code index
    const codeIndex = createMinimalCodeIndex()
    const routeContent = 'app.get("/api/users", handler)\napp.post("/api/login", loginHandler)\n'
    codeIndex.files.set('src/services/api.ts', {
      path: 'src/services/api.ts',
      name: 'api.ts',
      content: routeContent,
      language: 'typescript',
      lineCount: routeContent.split('\n').length,
    })

    const result = await generateEntryPoints(analysis, codeIndex, [])

    expect(result.type).toBe('entrypoints')
    expect(result.title).toContain('Express')
    expect(result.chart).toContain('GET')
    expect(result.chart).toContain('/api/users')
    expect(result.stats.totalEdges).toBe(2)
  })

  it('keeps structured route ids distinct when path/file text collides', async () => {
    const analysis = createRealisticAnalysis()
    analysis.detectedFramework = 'Express'
    const codeIndex = createMinimalCodeIndex()
    const first = 'src/c.ts'
    const second = 'src/b_c.ts'
    const firstContent = 'app.get("/a_b", handler)'
    const secondContent = 'app.get("/a", handler)'
    for (const [path, content] of [[first, firstContent], [second, secondContent]] as const) {
      analysis.files.set(path, { path, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript' })
      codeIndex.files.set(path, { path, name: path.split('/').pop()!, content, language: 'typescript', lineCount: 1 })
    }

    const result = await generateEntryPoints(analysis, codeIndex, [])

    expect([...result.nodePathMap.values()]).toEqual(expect.arrayContaining([first, second]))
    expect(result.nodePathMap.size).toBeGreaterThanOrEqual(2)
  })

  it('deduplicates repeated route registrations by rendered node id', async () => {
    const analysis = createRealisticAnalysis()
    analysis.detectedFramework = 'Express'
    const codeIndex = createMinimalCodeIndex()
    const path = 'src/server.ts'
    const content = 'app.get("/same", first)\napp.get("/same", second)'
    analysis.files.set(path, { path, imports: [], exports: [], types: [], classes: [], jsxComponents: [], language: 'typescript' })
    codeIndex.files.set(path, { path, name: 'server.ts', content, language: 'typescript', lineCount: 2 })

    const result = await generateEntryPoints(analysis, codeIndex, [])

    expect(result.chart.match(/\["GET \/same"\]/g)).toHaveLength(1)
    expect(result.stats).toMatchObject({ totalNodes: 2, totalEdges: 1, omittedNodes: 0, omittedEdges: 0 })
    expect([...result.nodePathMap.values()]).toEqual([path])
  })

  it('detects Nuxt Vue pages', async () => {
    const analysis = createNextJsAnalysis()
    analysis.detectedFramework = 'Nuxt'
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), createNuxtVueFiles())

    expect(result.title).toContain('Route')
    expect(result.chart).toContain('["/"]')
    expect(result.chart).toContain('["/about"]')
    expect(result.chart).toContain('["/users/[id]"]')
    expect(result.chart).not.toContain('/index.vue')
    expect([...result.nodePathMap.values()]).toEqual(expect.arrayContaining(['pages/index.vue', 'app/pages/index.vue']))
    expect(result.stats.totalNodes).toBeGreaterThan(0)
  })

  it('counts edges in the generic fallback chart', async () => {
    const analysis = createRealisticAnalysis()
    const result = await generateEntryPoints(analysis, createMinimalCodeIndex(), [])
    const renderedEdges = result.chart.split('\n').filter(line => line.includes('-->'))

    expect(result.stats.totalEdges).toBe(renderedEdges.length)
  })
})
