import { describe, it, expect } from 'vitest'
import {
  buildSearchRegex,
  searchIndexPartial,
  searchIndexAsync,
  searchMore,
  createEmptyIndex,
  batchIndexFiles,
  batchIndexMetadataOnly,
  createEmptyIndexWithStore,
  InMemoryContentStore,
} from '../code-index'
import type { CodeIndexMeta } from '../content-store'
import { LazyContentStore } from '../content-store'
import { FetchQueue } from '../fetch-queue'
import { vi } from 'vitest'

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

describe('bounded async search', () => {
  it('applies a finite per-file match limit by default', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'many.ts', content: 'needle '.repeat(101) },
    ])

    const result = await searchIndexAsync(index, 'needle')

    expect(result.flatMap(file => file.matches)).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it('skips oversized lines before executing literal search', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [{
      path: 'generated.min.js',
      content: `needle${'x'.repeat(200_000)}`,
    }])

    const result = await searchIndexAsync(index, 'needle')

    expect(result.results).toEqual([])
    expect(result.truncated).toBe(true)
  })

  it('applies a finite global limit and reports files skipped after reaching it', async () => {
    const index = batchIndexFiles(createEmptyIndex(), Array.from({ length: 11 }, (_, index) => ({
      path: `f${index}.ts`,
      content: 'needle '.repeat(100),
    })))

    const result = await searchIndexAsync(index, 'needle')

    expect(result.flatMap(file => file.matches)).toHaveLength(1_000)
    expect(result.unsearchedPaths).toEqual(['f10.ts'])
    expect(result.truncated).toBe(true)
  })

  it('applies compact include rules before the global match limit', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      ...Array.from({ length: 10 }, (_, fileIndex) => ({
        path: `generated-${fileIndex}.js`,
        content: 'needle '.repeat(100),
      })),
      { path: 'src/allowed.ts', content: 'needle' },
    ])

    const result = await searchIndexAsync(index, 'needle', {
      pathFilter: {
        includes: [{ kind: 'suffix', value: '.ts' }],
      },
    })

    expect(result.map(file => file.file)).toEqual(['src/allowed.ts'])
    expect(result.flatMap(file => file.matches)).toHaveLength(1)
    expect(result.unsearchedPaths).toEqual([])
    expect(result.unavailablePaths).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('preserves extension, directory, and substring include-filter semantics', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'vendor/excluded.js', content: 'needle' },
      { path: 'lib/value.ts', content: 'needle' },
      { path: 'src/value.js', content: 'needle' },
      { path: 'config/settings.json', content: 'needle' },
    ])

    const result = await searchIndexAsync(index, 'needle', {
      pathFilter: {
        includes: [
          { kind: 'suffix', value: '.ts' },
          { kind: 'prefix', value: 'src/' },
          { kind: 'contains', value: 'config' },
        ],
      },
    })

    expect(result.map(file => file.file)).toEqual([
      'lib/value.ts',
      'src/value.js',
      'config/settings.json',
    ])
    expect(result.unsearchedPaths).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('yields between batches so an asynchronous cancellation can stop the search', async () => {
    const index = batchIndexFiles(createEmptyIndex(), Array.from({ length: 51 }, (_, index) => ({
      path: `f${index}.ts`,
      content: 'no match here',
    })))
    const controller = new AbortController()

    const pending = searchIndexAsync(index, 'needle', { signal: controller.signal })
    setTimeout(() => controller.abort(), 0)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('yields within one large file so cancellation does not wait for the full file scan', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [{
      path: 'large.ts',
      content: Array.from({ length: 500 }, (_, line) => `const value${line} = ${line}`).join('\n'),
    }])
    const controller = new AbortController()

    const pending = searchIndexAsync(index, 'needle', { signal: controller.signal })
    setTimeout(() => controller.abort(), 0)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns resident results and reports non-resident paths without bulk hydration', async () => {
    const fetchFile = vi.fn(async (path: string) => `needle in ${path}`)
    const store = new LazyContentStore('owner/repo', new FetchQueue({ fetchFn: fetchFile }))
    store.registerPaths(['src/resident.ts', 'src/not-resident.ts'])
    store.put('src/resident.ts', 'needle here')
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/resident.ts', language: 'typescript', lineCount: 1 },
      { path: 'src/not-resident.ts', language: 'typescript', lineCount: 1 },
    ])

    const result = await searchIndexAsync(index, 'needle', { maxMatches: 10 })

    expect(result.results).toHaveLength(1)
    expect(result.unsearchedPaths).toEqual(['src/not-resident.ts'])
    expect(result.unavailablePaths).toEqual(['src/not-resident.ts'])
    expect(result.truncated).toBe(false)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('enforces a global match bound and reports truncation', async () => {
    const index = batchIndexFiles(createEmptyIndex(), [
      { path: 'a.ts', content: 'needle needle' },
      { path: 'b.ts', content: 'needle' },
    ])

    const result = await searchIndexAsync(index, 'needle', { maxMatches: 2 })

    expect(result.results!.flatMap(file => file.matches)).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('falls back to literal matching for nested quantified regular expressions', () => {
    const pattern = buildSearchRegex('(a+)+$', { regex: true })

    expect(pattern?.test('prefix (a+)+$ suffix')).toBe(true)
    pattern!.lastIndex = 0
    expect(pattern?.test('aaaaaaaaaaaaaaaa')).toBe(false)
  })

  it('falls back to literal matching for repeated groups with overlapping alternatives', () => {
    const pattern = buildSearchRegex('^(a|aa)+$', { regex: true })

    expect(pattern?.test('^(a|aa)+$')).toBe(true)
  })

  it('falls back to literal matching for ambiguous chains of unbounded quantifiers', () => {
    const pattern = buildSearchRegex('^a*a*a*a*b$', { regex: true })

    expect(pattern?.test('^a*a*a*a*b$')).toBe(true)
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

  it('counts a genuine empty file as searched', async () => {
    const store = new InMemoryContentStore()
    store.put('empty.ts', '')

    const { searchedPaths, remainingPaths } = await searchMore(
      store,
      ['empty.ts'],
      'anything',
    )

    expect(searchedPaths).toEqual(['empty.ts'])
    expect(remainingPaths).toHaveLength(0)
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
