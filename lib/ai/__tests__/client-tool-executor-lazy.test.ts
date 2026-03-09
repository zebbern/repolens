import { describe, it, expect, vi } from 'vitest'
import { createEmptyIndex, batchIndexMetadataOnly, indexFile } from '@/lib/code/code-index'
import { executeToolLocally, type ToolExecutorOptions } from '../client-tool-executor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an index with one real file and two metadata-only files. */
function buildLazyIndex() {
  let index = createEmptyIndex()
  index = indexFile(
    index,
    'src/loaded.ts',
    'export const loaded = true\nexport function hello() { return "hi" }',
    'typescript',
  )
  index = batchIndexMetadataOnly(index, [
    { path: 'src/lazy-a.ts', language: 'typescript', lineCount: 10 },
    { path: 'src/lazy-b.ts', language: 'typescript', lineCount: 20 },
  ])
  return index
}

/** Creates a fetchFileContent callback that returns controlled content. */
function createMockFetchContent(contentMap: Record<string, string>) {
  return vi.fn(async (paths: string[]) => {
    const result = new Map<string, string>()
    for (const p of paths) {
      if (contentMap[p]) result.set(p, contentMap[p])
    }
    return result
  })
}

// ===========================================================================
// readFile — on-demand fetch via fetchFileContent
// ===========================================================================

describe('executeToolLocally — readFile with fetchFileContent', () => {
  it('fetches content on-demand when file is in index but has no content', async () => {
    const index = buildLazyIndex()
    const fetchFn = createMockFetchContent({
      'src/lazy-a.ts': 'export const lazyA = 42',
    })

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/lazy-a.ts' }, index, undefined, {
        fetchFileContent: fetchFn,
      }),
    )

    expect(result.path).toBe('src/lazy-a.ts')
    expect(result.content).toBe('export const lazyA = 42')
    expect(fetchFn).toHaveBeenCalledWith(['src/lazy-a.ts'])
  })

  it('returns error when fetchFileContent returns null for path', async () => {
    const index = buildLazyIndex()
    const fetchFn = createMockFetchContent({}) // returns empty map

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/lazy-a.ts' }, index, undefined, {
        fetchFileContent: fetchFn,
      }),
    )

    expect(result).toHaveProperty('error')
    expect(result.error).toContain('not available')
  })

  it('does not call fetchFileContent when file content is already loaded', async () => {
    const index = buildLazyIndex()
    const fetchFn = createMockFetchContent({})

    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/loaded.ts' }, index, undefined, {
        fetchFileContent: fetchFn,
      }),
    )

    expect(result.content).toContain('export const loaded')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('works without fetchFileContent option (backward compat)', async () => {
    const index = buildLazyIndex()

    // File with content — works as usual
    const result = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/loaded.ts' }, index),
    )
    expect(result.content).toContain('export const loaded')

    // File without content — returns error about content not available
    const lazyResult = JSON.parse(
      await executeToolLocally('readFile', { path: 'src/lazy-a.ts' }, index),
    )
    expect(lazyResult).toHaveProperty('error')
  })
})

// ===========================================================================
// readFiles — batch on-demand fetch
// ===========================================================================

describe('executeToolLocally — readFiles with fetchFileContent', () => {
  it('batch-fetches missing content for multiple lazy files', async () => {
    const index = buildLazyIndex()
    const fetchFn = createMockFetchContent({
      'src/lazy-a.ts': 'const a = 1',
      'src/lazy-b.ts': 'const b = 2',
    })

    const result = JSON.parse(
      await executeToolLocally(
        'readFiles',
        { paths: ['src/loaded.ts', 'src/lazy-a.ts', 'src/lazy-b.ts'] },
        index,
        undefined,
        { fetchFileContent: fetchFn },
      ),
    )

    expect(result.files).toHaveLength(3)
    expect(result.files[0].content).toContain('export const loaded')
    expect(result.files[1].content).toBe('const a = 1')
    expect(result.files[2].content).toBe('const b = 2')
    // Should batch-fetch only the missing files
    expect(fetchFn).toHaveBeenCalledWith(['src/lazy-a.ts', 'src/lazy-b.ts'])
  })
})

// ===========================================================================
// searchFiles — unchanged for fully loaded repos
// ===========================================================================

describe('executeToolLocally — searchFiles unchanged behavior', () => {
  it('returns results for fully loaded repos without unsearchedFiles', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const greeting = "hello world"', 'typescript')

    const result = JSON.parse(
      await executeToolLocally('searchFiles', { query: 'hello' }, index),
    )

    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.unsearchedFiles).toBeUndefined()
  })
})

// ===========================================================================
// executeToolLocally returns a Promise (async)
// ===========================================================================

describe('executeToolLocally — async contract', () => {
  it('returns a Promise', () => {
    const index = buildLazyIndex()
    const result = executeToolLocally('readFile', { path: 'src/loaded.ts' }, index)
    expect(result).toBeInstanceOf(Promise)
  })

  it('resolves to a string', async () => {
    const index = buildLazyIndex()
    const result = await executeToolLocally('readFile', { path: 'src/loaded.ts' }, index)
    expect(typeof result).toBe('string')
  })
})
