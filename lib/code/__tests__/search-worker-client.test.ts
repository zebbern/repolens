import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'

// In jsdom, `Worker` is undefined, so searchInWorker falls back to searchIndex.
describe('searchInWorker', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('falls back to searchIndex when Workers are unavailable', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const hello = "world";\nconsole.log(hello);\n', 'typescript')

    const results = await searchInWorker(index, 'hello')

    expect(results.length).toBe(1)
    expect(results[0].file).toBe('src/app.ts')
    expect(results[0].matches.length).toBe(2)
  })

  it('returns empty array for no matches', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1;', 'typescript')

    const results = await searchInWorker(index, 'nonexistent')

    expect(results).toEqual([])
  })

  it('returns SearchResult[] with correct structure', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    let index = createEmptyIndex()
    index = indexFile(index, 'src/utils.ts', 'export function add(a, b) { return a + b; }', 'typescript')

    const results = await searchInWorker(index, 'add')

    expect(results.length).toBe(1)
    expect(results[0]).toHaveProperty('file')
    expect(results[0]).toHaveProperty('matches')
    expect(results[0].matches[0]).toHaveProperty('line')
    expect(results[0].matches[0]).toHaveProperty('content')
    expect(results[0].matches[0]).toHaveProperty('column')
    expect(results[0].matches[0]).toHaveProperty('length')
  })

  it('respects caseSensitive option', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'Hello hello HELLO', 'typescript')

    const caseSensitive = await searchInWorker(index, 'Hello', { caseSensitive: true })
    const caseInsensitive = await searchInWorker(index, 'Hello', { caseSensitive: false })

    // Case sensitive should find only "Hello" (1 match)
    expect(caseSensitive[0].matches.length).toBe(1)
    // Case insensitive finds all 3
    expect(caseInsensitive[0].matches.length).toBe(3)
  })

  it('handles empty CodeIndex', async () => {
    const { searchInWorker } = await import('../search-worker-client')
    const emptyIndex = createEmptyIndex()

    const results = await searchInWorker(emptyIndex, 'anything')

    expect(results).toEqual([])
  })
})

describe('cancelPendingSearches', () => {
  it('clears pending map without throwing', async () => {
    const { cancelPendingSearches } = await import('../search-worker-client')

    // Should not throw even when there are no pending searches
    expect(() => cancelPendingSearches()).not.toThrow()
  })
})
