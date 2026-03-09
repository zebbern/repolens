import { describe, it, expect } from 'vitest'
import {
  searchIndexPartial,
  searchMore,
  createEmptyIndex,
  batchIndexFiles,
  batchIndexMetadataOnly,
  InMemoryContentStore,
} from '../code-index'
import type { CodeIndexMeta } from '../content-store'

// ---------------------------------------------------------------------------
// searchIndexPartial
// ---------------------------------------------------------------------------

describe('searchIndexPartial', () => {
  it('returns results and empty unsearchedPaths for fully indexed repos', () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'src/auth.ts', content: 'export function handleAuth() {}', language: 'typescript' },
      { path: 'src/utils.ts', content: 'export function formatDate() {}', language: 'typescript' },
    ])

    const { results, unsearchedPaths } = searchIndexPartial(index, 'handleAuth')

    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('src/auth.ts')
    expect(unsearchedPaths).toHaveLength(0)
  })

  it('counts empty-content files as unsearched', () => {
    let index = batchIndexFiles(createEmptyIndex(), [
      { path: 'src/loaded.ts', content: 'const loaded = true', language: 'typescript' },
    ])
    index = batchIndexMetadataOnly(index, [
      { path: 'src/lazy1.ts', language: 'typescript' },
      { path: 'src/lazy2.ts', language: 'typescript' },
      { path: 'src/lazy3.ts', language: 'typescript' },
    ])

    const { results, unsearchedPaths } = searchIndexPartial(index, 'loaded')

    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('src/loaded.ts')
    expect(unsearchedPaths).toHaveLength(3)
    expect(unsearchedPaths).toContain('src/lazy1.ts')
    expect(unsearchedPaths).toContain('src/lazy2.ts')
    expect(unsearchedPaths).toContain('src/lazy3.ts')
  })

  it('returns empty results and no unsearched for empty query', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts' },
    ])

    const { results, unsearchedPaths } = searchIndexPartial(index, '   ')

    expect(results).toHaveLength(0)
    expect(unsearchedPaths).toHaveLength(0)
  })

  it('sorts results by match count descending', () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'few.ts', content: 'hello world' },
      { path: 'many.ts', content: 'hello hello hello' },
    ])

    const { results } = searchIndexPartial(index, 'hello')

    expect(results[0].file).toBe('many.ts')
    expect(results[1].file).toBe('few.ts')
  })

  it('respects caseSensitive option', () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'a.ts', content: 'Hello World' },
    ])

    const sensitive = searchIndexPartial(index, 'hello', { caseSensitive: true })
    const insensitive = searchIndexPartial(index, 'hello', { caseSensitive: false })

    expect(sensitive.results).toHaveLength(0)
    expect(insensitive.results).toHaveLength(1)
  })

  it('all metadata-only index gives all unsearched, no results', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts' },
      { path: 'b.ts' },
      { path: 'c.ts' },
    ])

    const { results, unsearchedPaths } = searchIndexPartial(index, 'anything')

    expect(results).toHaveLength(0)
    expect(unsearchedPaths).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// searchMore
// ---------------------------------------------------------------------------

describe('searchMore', () => {
  it('searches content available in the content store', async () => {
    const store = new InMemoryContentStore()
    store.put('src/auth.ts', 'export function handleAuth() { return true }')
    store.put('src/utils.ts', 'export function formatDate() {}')

    const meta = new Map<string, CodeIndexMeta>([
      ['src/auth.ts', { path: 'src/auth.ts', name: 'auth.ts', language: 'typescript', lineCount: 1 }],
      ['src/utils.ts', { path: 'src/utils.ts', name: 'utils.ts', language: 'typescript', lineCount: 1 }],
    ])

    const { results, searchedPaths, remainingPaths } = await searchMore(
      store,
      ['src/auth.ts', 'src/utils.ts'],
      'handleAuth',
      {},
      meta,
    )

    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('src/auth.ts')
    expect(results[0].language).toBe('typescript')
    expect(searchedPaths).toContain('src/auth.ts')
    expect(searchedPaths).toContain('src/utils.ts')
    expect(remainingPaths).toHaveLength(0)
  })

  it('returns paths without content as remaining', async () => {
    const store = new InMemoryContentStore()
    store.put('src/loaded.ts', 'const x = 1')
    // src/missing.ts intentionally not in store

    const { searchedPaths, remainingPaths } = await searchMore(
      store,
      ['src/loaded.ts', 'src/missing.ts'],
      'anything',
    )

    expect(searchedPaths).toContain('src/loaded.ts')
    expect(remainingPaths).toContain('src/missing.ts')
  })

  it('respects batchSize and reports not-attempted as remaining', async () => {
    const store = new InMemoryContentStore()
    for (let i = 0; i < 5; i++) {
      store.put(`f${i}.ts`, `content ${i}`)
    }

    const paths = Array.from({ length: 5 }, (_, i) => `f${i}.ts`)
    const { searchedPaths, remainingPaths } = await searchMore(
      store,
      paths,
      'content',
      {},
      undefined,
      3, // batchSize
    )

    expect(searchedPaths).toHaveLength(3)
    expect(remainingPaths).toHaveLength(2)
    expect(remainingPaths).toContain('f3.ts')
    expect(remainingPaths).toContain('f4.ts')
  })

  it('returns empty results for empty query', async () => {
    const store = new InMemoryContentStore()
    store.put('a.ts', 'hello')

    const { results, remainingPaths } = await searchMore(store, ['a.ts'], '  ')

    expect(results).toHaveLength(0)
    expect(remainingPaths).toEqual(['a.ts'])
  })

  it('treats empty-string content as unsearched', async () => {
    const store = new InMemoryContentStore()
    store.put('empty.ts', '')

    const { searchedPaths, remainingPaths } = await searchMore(
      store,
      ['empty.ts'],
      'anything',
    )

    expect(searchedPaths).toHaveLength(0)
    expect(remainingPaths).toContain('empty.ts')
  })

  it('respects search options', async () => {
    const store = new InMemoryContentStore()
    store.put('a.ts', 'Hello World')

    const sensitive = await searchMore(store, ['a.ts'], 'hello', { caseSensitive: true })
    const insensitive = await searchMore(store, ['a.ts'], 'hello', { caseSensitive: false })

    expect(sensitive.results).toHaveLength(0)
    expect(insensitive.results).toHaveLength(1)
  })

  it('provides correct match positions', async () => {
    const store = new InMemoryContentStore()
    store.put('code.ts', 'line1\nfoo bar baz\nline3')

    const { results } = await searchMore(store, ['code.ts'], 'bar')

    expect(results).toHaveLength(1)
    expect(results[0].matches).toHaveLength(1)
    expect(results[0].matches[0].line).toBe(2)
    expect(results[0].matches[0].column).toBe(4)
    expect(results[0].matches[0].length).toBe(3)
  })
})
