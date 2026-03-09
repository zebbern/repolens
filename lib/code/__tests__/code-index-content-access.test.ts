import { describe, it, expect, vi } from 'vitest'
import {
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
  getFileContent,
  getFileContentSync,
  getFileLinesAsync,
  getFileLines,
  searchIndex,
  type CodeIndex,
  type IndexedFile,
} from '../code-index'
import { InMemoryContentStore, type ContentStore } from '../content-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a CodeIndex with files in the `files` Map and content in contentStore. */
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
 * but content lives in the contentStore. Simulates IDB-backed repos.
 */
function buildStrippedIndex(
  entries: Array<{ path: string; content: string; language?: string }>,
  store?: ContentStore,
): CodeIndex {
  const contentStore = store ?? new InMemoryContentStore()
  const files = new Map<string, IndexedFile>()
  const meta = new Map<string, { path: string; name: string; language?: string; lineCount: number }>()

  for (const e of entries) {
    const name = e.path.split('/').pop() || e.path
    const lineCount = e.content.split('\n').length
    // content is intentionally undefined — simulates stripped files
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

/** Create a mock ContentStore that behaves like an IDB store (getSync returns null). */
function createMockIDBStore(entries: Map<string, string>): ContentStore {
  const paths = new Set(entries.keys())
  return {
    get: vi.fn(async (path: string) => entries.get(path) ?? null),
    getSync: vi.fn((_path: string) => null), // IDB always returns null for sync
    getBatch: vi.fn(async (paths: string[]) => {
      const result = new Map<string, string>()
      for (const p of paths) {
        const c = entries.get(p)
        if (c !== undefined) result.set(p, c)
      }
      return result
    }),
    put: vi.fn((path: string, content: string) => { entries.set(path, content); paths.add(path) }),
    putBatch: vi.fn((batch: Array<{ path: string; content: string }>) => {
      for (const { path, content } of batch) { entries.set(path, content); paths.add(path) }
    }),
    has: vi.fn((path: string) => paths.has(path)),
    delete: vi.fn((path: string) => { entries.delete(path); paths.delete(path) }),
    get size() { return paths.size },
  }
}

// ===========================================================================
// getFileContent (async)
// ===========================================================================

describe('getFileContent', () => {
  it('returns content from files Map when content is populated (InMemory fast path)', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/app.ts', content: 'const app = true' },
    ])

    const result = await getFileContent(index, 'src/app.ts')
    expect(result).toBe('const app = true')
  })

  it('returns content from contentStore.get() when IndexedFile.content is undefined', async () => {
    const index = buildStrippedIndex([
      { path: 'src/utils.ts', content: 'export const x = 1' },
    ])

    const result = await getFileContent(index, 'src/utils.ts')
    expect(result).toBe('export const x = 1')
  })

  it('returns null for non-existent paths', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/exists.ts', content: 'hello' },
    ])

    const result = await getFileContent(index, 'src/does-not-exist.ts')
    expect(result).toBeNull()
  })

  it('prefers file.content over contentStore when both are available', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/a.ts', content: 'inline-content' },
    ])
    // Overwrite contentStore with different value
    index.contentStore.put('src/a.ts', 'store-content')

    const result = await getFileContent(index, 'src/a.ts')
    expect(result).toBe('inline-content')
  })

  it('falls back to contentStore when file.content is empty string', async () => {
    const store = new InMemoryContentStore()
    store.put('src/a.ts', 'from-store')

    const files = new Map<string, IndexedFile>()
    files.set('src/a.ts', { path: 'src/a.ts', name: 'a.ts', content: '', lineCount: 1 })

    const index: CodeIndex = {
      files,
      totalFiles: 1,
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: store,
    }

    // Empty string is falsy, so it falls through to contentStore
    const result = await getFileContent(index, 'src/a.ts')
    expect(result).toBe('from-store')
  })

  it('works with mock IDB store (async path)', async () => {
    const mockStore = createMockIDBStore(new Map([['src/a.ts', 'idb-content']]))
    const index = buildStrippedIndex(
      [{ path: 'src/a.ts', content: 'idb-content' }],
      mockStore,
    )

    const result = await getFileContent(index, 'src/a.ts')
    expect(result).toBe('idb-content')
    expect(mockStore.get).toHaveBeenCalledWith('src/a.ts')
  })
})

// ===========================================================================
// getFileContentSync
// ===========================================================================

describe('getFileContentSync', () => {
  it('returns content from files Map when present', () => {
    const index = buildPopulatedIndex([
      { path: 'src/app.ts', content: 'const app = true' },
    ])

    const result = getFileContentSync(index, 'src/app.ts')
    expect(result).toBe('const app = true')
  })

  it('returns content from contentStore.getSync() for InMemory store', () => {
    const index = buildStrippedIndex([
      { path: 'lib/helpers.ts', content: 'export function help() {}' },
    ])

    const result = getFileContentSync(index, 'lib/helpers.ts')
    expect(result).toBe('export function help() {}')
  })

  it('returns null for IDB store (getSync returns null for IDB)', () => {
    const mockStore = createMockIDBStore(new Map([['src/a.ts', 'content-in-idb']]))
    const index = buildStrippedIndex(
      [{ path: 'src/a.ts', content: 'content-in-idb' }],
      mockStore,
    )

    const result = getFileContentSync(index, 'src/a.ts')
    expect(result).toBeNull()
    expect(mockStore.getSync).toHaveBeenCalledWith('src/a.ts')
  })

  it('returns null for non-existent paths', () => {
    const index = buildPopulatedIndex([])
    const result = getFileContentSync(index, 'nope.ts')
    expect(result).toBeNull()
  })
})

// ===========================================================================
// getFileLinesAsync
// ===========================================================================

describe('getFileLinesAsync', () => {
  it('returns split lines for existing file with inline content', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/multi.ts', content: 'line1\nline2\nline3' },
    ])

    const lines = await getFileLinesAsync(index, 'src/multi.ts')
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  it('returns split lines when content is only in contentStore', async () => {
    const index = buildStrippedIndex([
      { path: 'src/stripped.ts', content: 'a\nb\nc\nd' },
    ])

    const lines = await getFileLinesAsync(index, 'src/stripped.ts')
    expect(lines).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns null for non-existent path', async () => {
    const index = buildPopulatedIndex([])
    const lines = await getFileLinesAsync(index, 'ghost.ts')
    expect(lines).toBeNull()
  })

  it('returns single-element array for single-line file', async () => {
    const index = buildStrippedIndex([
      { path: 'one-liner.ts', content: 'export default 42' },
    ])

    const lines = await getFileLinesAsync(index, 'one-liner.ts')
    expect(lines).toEqual(['export default 42'])
  })
})

// ===========================================================================
// IndexedFile with content: undefined
// ===========================================================================

describe('IndexedFile with content: undefined', () => {
  it('can be created and stored in a CodeIndex', () => {
    const file: IndexedFile = {
      path: 'src/stripped.ts',
      name: 'stripped.ts',
      content: undefined,
      language: 'typescript',
      lineCount: 10,
    }

    const index = createEmptyIndex()
    index.files.set(file.path, file)

    expect(index.files.get('src/stripped.ts')).toBeDefined()
    expect(index.files.get('src/stripped.ts')!.content).toBeUndefined()
  })
})

// ===========================================================================
// contentStore is always present on CodeIndex
// ===========================================================================

describe('contentStore on CodeIndex', () => {
  it('createEmptyIndex() provides an InMemoryContentStore', () => {
    const index = createEmptyIndex()
    expect(index.contentStore).toBeDefined()
    expect(index.contentStore).toBeInstanceOf(InMemoryContentStore)
  })

  it('createEmptyIndexWithStore() uses the provided store', () => {
    const store = new InMemoryContentStore(new Map([['a.ts', 'hello']]))
    const index = createEmptyIndexWithStore(store)
    expect(index.contentStore).toBe(store)
  })

  it('indexFile preserves contentStore across updates', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'a.ts', 'content-a')
    index = indexFile(index, 'b.ts', 'content-b')

    expect(index.contentStore).toBeDefined()
    expect(index.contentStore.has('a.ts')).toBe(true)
    expect(index.contentStore.has('b.ts')).toBe(true)
  })
})

// ===========================================================================
// searchIndex skips files with undefined/empty content
// ===========================================================================

describe('searchIndex with content stripping', () => {
  it('skips files where content is undefined', () => {
    const index = createEmptyIndex()
    // Manually add a file with undefined content
    index.files.set('src/stripped.ts', {
      path: 'src/stripped.ts',
      name: 'stripped.ts',
      content: undefined,
      language: 'typescript',
      lineCount: 5,
    })
    // Add a file with content
    const withContent = indexFile(index, 'src/has-content.ts', 'const searchable = true')

    const results = searchIndex(withContent, 'searchable')
    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('src/has-content.ts')
  })

  it('skips files where content is empty string', () => {
    const index = createEmptyIndex()
    index.files.set('src/empty.ts', {
      path: 'src/empty.ts',
      name: 'empty.ts',
      content: '',
      language: 'typescript',
      lineCount: 0,
    })

    const results = searchIndex(index, 'anything')
    expect(results).toHaveLength(0)
  })

  it('finds matches in files with populated content', () => {
    const index = buildPopulatedIndex([
      { path: 'a.ts', content: 'export const hello = "world"' },
      { path: 'b.ts', content: 'no match here' },
    ])

    const results = searchIndex(index, 'hello')
    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('a.ts')
  })
})

// ===========================================================================
// getFileLines (sync backward compat)
// ===========================================================================

describe('getFileLines (sync backward compat)', () => {
  it('works for files with populated content', () => {
    const file: IndexedFile = {
      path: 'src/file.ts',
      name: 'file.ts',
      content: 'line1\nline2\nline3',
      lineCount: 3,
    }

    const lines = getFileLines(file)
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  it('returns [""] for files with undefined content', () => {
    const file: IndexedFile = {
      path: 'src/stripped.ts',
      name: 'stripped.ts',
      content: undefined,
      lineCount: 0,
    }

    const lines = getFileLines(file)
    expect(lines).toEqual([''])
  })
})

// ===========================================================================
// Integration / tier tests
// ===========================================================================

describe('integration: InMemory tier (content populated)', () => {
  it('all sync paths work — no regressions', () => {
    const index = buildPopulatedIndex([
      { path: 'src/a.ts', content: 'const a = 1' },
      { path: 'src/b.ts', content: 'const b = 2\nconst c = 3' },
    ])

    // getFileContentSync works
    expect(getFileContentSync(index, 'src/a.ts')).toBe('const a = 1')
    expect(getFileContentSync(index, 'src/b.ts')).toBe('const b = 2\nconst c = 3')

    // getFileLines works
    const fileA = index.files.get('src/a.ts')!
    expect(getFileLines(fileA)).toEqual(['const a = 1'])

    // searchIndex works
    const results = searchIndex(index, 'const')
    expect(results.length).toBeGreaterThanOrEqual(1)

    // contentStore also has the data
    expect(index.contentStore.getSync('src/a.ts')).toBe('const a = 1')
  })
})

describe('integration: mock IDB tier (content stripped)', () => {
  it('async paths fetch from store correctly', async () => {
    const storeData = new Map([
      ['src/a.ts', 'const a = 1'],
      ['src/b.ts', 'const b = 2\nconst c = 3'],
    ])
    const mockStore = createMockIDBStore(storeData)
    const index = buildStrippedIndex(
      [
        { path: 'src/a.ts', content: 'const a = 1' },
        { path: 'src/b.ts', content: 'const b = 2\nconst c = 3' },
      ],
      mockStore,
    )

    // getFileContent (async) works
    expect(await getFileContent(index, 'src/a.ts')).toBe('const a = 1')
    expect(await getFileContent(index, 'src/b.ts')).toBe('const b = 2\nconst c = 3')

    // getFileLinesAsync works
    expect(await getFileLinesAsync(index, 'src/b.ts')).toEqual(['const b = 2', 'const c = 3'])

    // getFileContentSync returns null (IDB has no sync path)
    expect(getFileContentSync(index, 'src/a.ts')).toBeNull()

    // searchIndex skips stripped files (content undefined)
    const results = searchIndex(index, 'const')
    expect(results).toHaveLength(0)
  })

  it('returns null for paths not in the store', async () => {
    const mockStore = createMockIDBStore(new Map())
    const index: CodeIndex = {
      files: new Map(),
      totalFiles: 0,
      totalLines: 0,
      isIndexing: false,
      meta: new Map(),
      contentStore: mockStore,
    }

    expect(await getFileContent(index, 'nonexistent.ts')).toBeNull()
    expect(await getFileLinesAsync(index, 'nonexistent.ts')).toBeNull()
  })
})

describe('integration: content stripping transition', () => {
  it('after stripping content, contentStore still serves it', async () => {
    // Start with populated content
    const index = buildPopulatedIndex([
      { path: 'src/app.ts', content: 'const app = true' },
    ])

    // Verify inline content works
    expect(await getFileContent(index, 'src/app.ts')).toBe('const app = true')
    expect(getFileContentSync(index, 'src/app.ts')).toBe('const app = true')

    // Simulate stripping: set file.content to undefined
    const file = index.files.get('src/app.ts')!
    const strippedFile: IndexedFile = { ...file, content: undefined }
    index.files.set('src/app.ts', strippedFile)

    // contentStore still has the data
    expect(await getFileContent(index, 'src/app.ts')).toBe('const app = true')
    expect(getFileContentSync(index, 'src/app.ts')).toBe('const app = true')

    // searchIndex now skips this file (content is undefined)
    const results = searchIndex(index, 'app')
    expect(results).toHaveLength(0)
  })
})
