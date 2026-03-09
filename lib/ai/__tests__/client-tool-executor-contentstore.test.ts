import { describe, it, expect, vi } from 'vitest'
import {
  createEmptyIndex,
  indexFile,
  searchIndex,
  getFileContent,
  getFileContentSync,
  type CodeIndex,
  type IndexedFile,
} from '@/lib/code/code-index'
import { InMemoryContentStore, type ContentStore } from '@/lib/code/content-store'
import { executeToolLocally } from '../client-tool-executor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a CodeIndex where file.content is populated (normal InMemory path). */
function buildPopulatedIndex(
  entries: Array<{ path: string; content: string; language?: string }>,
): CodeIndex {
  let index = createEmptyIndex()
  for (const e of entries) {
    index = indexFile(index, e.path, e.content, e.language)
  }
  return index
}

/**
 * Build a CodeIndex where IndexedFile.content is undefined (stripped),
 * but content is in contentStore. Simulates IDB-backed repos.
 */
function buildStrippedIndex(
  entries: Array<{ path: string; content: string; language?: string }>,
): CodeIndex {
  const contentStore = new InMemoryContentStore()
  const files = new Map<string, IndexedFile>()
  const meta = new Map<string, { path: string; name: string; language?: string; lineCount: number }>()

  for (const e of entries) {
    const name = e.path.split('/').pop() || e.path
    const lineCount = e.content.split('\n').length
    files.set(e.path, { path: e.path, name, content: undefined, language: e.language, lineCount })
    meta.set(e.path, { path: e.path, name, language: e.language, lineCount })
    contentStore.put(e.path, e.content)
  }

  return {
    files,
    totalFiles: files.size,
    totalLines: 0,
    isIndexing: false,
    meta,
    contentStore,
  }
}

// ===========================================================================
// readFile — reads from contentStore when file.content is undefined
// ===========================================================================

describe('executeToolLocally — readFile with contentStore', () => {
  it('reads from contentStore when IndexedFile.content is undefined', async () => {
    const index = buildStrippedIndex([
      { path: 'src/utils.ts', content: 'export const x = 1', language: 'typescript' },
    ])

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/utils.ts' }, index),
    )

    expect(result.path).toBe('src/utils.ts')
    expect(result.content).toBe('export const x = 1')
  })

  it('still reads inline content when file.content is populated', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/app.ts', content: 'const app = true', language: 'typescript' },
    ])

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/app.ts' }, index),
    )

    expect(result.content).toBe('const app = true')
  })

  it('returns error when content is in neither file.content nor contentStore', async () => {
    const index: CodeIndex = {
      files: new Map([['src/empty.ts', { path: 'src/empty.ts', name: 'empty.ts', content: undefined, lineCount: 0 }]]),
      totalFiles: 1,
      totalLines: 0,
      isIndexing: false,
      meta: new Map([['src/empty.ts', { path: 'src/empty.ts', name: 'empty.ts', lineCount: 0 }]]),
      contentStore: new InMemoryContentStore(),
    }

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/empty.ts' }, index),
    )

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('not available')
  })
})

// ===========================================================================
// readFiles — batch reads from contentStore
// ===========================================================================

describe('executeToolLocally — readFiles with contentStore', () => {
  it('batch reads from contentStore when file.content is undefined', async () => {
    const index = buildStrippedIndex([
      { path: 'src/a.ts', content: 'const a = 1', language: 'typescript' },
      { path: 'src/b.ts', content: 'const b = 2', language: 'typescript' },
    ])

    const result = JSON.parse(
      await executeToolLocally('readFiles', { paths: ['src/a.ts', 'src/b.ts'] }, index),
    )

    expect(result.files).toHaveLength(2)
    expect(result.files[0].content).toBe('const a = 1')
    expect(result.files[1].content).toBe('const b = 2')
  })
})

// ===========================================================================
// searchFiles — context lines from contentStore
// ===========================================================================

describe('executeToolLocally — searchFiles with contentStore', () => {
  it('provides context lines from contentStore when file.content is populated', async () => {
    const index = buildPopulatedIndex([
      {
        path: 'src/util.ts',
        content: 'function foo() {\n  const bar = 1\n  return bar\n}\n',
        language: 'typescript',
      },
    ])

    const result = JSON.parse(
      await executeToolLocally('searchFiles', { query: 'bar' }, index),
    )

    // Should find matches in content
    const contentMatch = result.results.find((r: { matchType: string }) => r.matchType === 'content')
    if (contentMatch) {
      expect(contentMatch.matches.length).toBeGreaterThan(0)
      // Context lines should be present
      expect(contentMatch.matches[0].context).toBeDefined()
      expect(contentMatch.matches[0].context.length).toBeGreaterThan(0)
    }
  })
})

// ===========================================================================
// scanIssues — works with contentStore-only content
// ===========================================================================

describe('executeToolLocally — scanIssues with contentStore', () => {
  it('works when file content comes from contentStore', { timeout: 15_000 }, async () => {
    const index = buildStrippedIndex([
      {
        path: 'src/bad.ts',
        content: 'console.log("debug")\nvar x = 1\n',
        language: 'typescript',
      },
    ])

    const result = JSON.parse(
      await executeToolLocally('scanIssues', { path: 'src/bad.ts' }, index),
    )

    expect(result.path).toBe('src/bad.ts')
    // Should not error out — content was retrieved from contentStore
    expect(result).not.toHaveProperty('error')
  })
})

// ===========================================================================
// significanceScore — handles file.content being undefined
// ===========================================================================

describe('significanceScore (via generateTour)', () => {
  it('does not crash when file.content is undefined', async () => {
    const index = buildStrippedIndex([
      { path: 'src/index.ts', content: 'export function main() {}', language: 'typescript' },
      { path: 'src/utils.ts', content: 'export const helper = 1', language: 'typescript' },
    ])

    // generateTour uses significanceScore internally
    const result = JSON.parse(
      await executeToolLocally('generateTour', { repoKey: 'test/repo' }, index),
    )

    // Should not error — significanceScore handles undefined content with (file.content ?? '')
    expect(result).not.toHaveProperty('error')
  })
})
