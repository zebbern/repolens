import { generateEntryPoints } from '@/lib/diagrams/generators/entry-points'
import { createRealisticAnalysis, createEmptyAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'
import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'
import type { FileNode } from '@/types/repository'

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
  })
})
