import { describe, it, expect } from 'vitest'
import {
  createEmptyIndex,
  indexFile,
  batchIndexFiles,
  batchIndexMetadataOnly,
  InMemoryContentStore,
  LazyContentStore,
  type CodeIndex,
} from '../code-index'
import { FetchQueue } from '../fetch-queue'

// ---------------------------------------------------------------------------
// batchIndexMetadataOnly
// ---------------------------------------------------------------------------

describe('batchIndexMetadataOnly', () => {
  it('populates meta Map with correct entries', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'src/app.ts', language: 'typescript', lineCount: 100 },
      { path: 'src/utils.py', language: 'python', lineCount: 50 },
    ])

    expect(index.meta!.size).toBe(2)
    expect(index.meta!.has('src/app.ts')).toBe(true)
    expect(index.meta!.has('src/utils.py')).toBe(true)
  })

  it('metadata entries have correct path, name, language, lineCount fields', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'src/components/button.tsx', language: 'typescriptreact', lineCount: 42 },
    ])

    const meta = index.meta!.get('src/components/button.tsx')
    expect(meta).toBeDefined()
    expect(meta!.path).toBe('src/components/button.tsx')
    expect(meta!.name).toBe('button.tsx')
    expect(meta!.language).toBe('typescriptreact')
    expect(meta!.lineCount).toBe(42)
  })

  it('files Map has empty content strings', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts', language: 'typescript', lineCount: 10 },
      { path: 'b.ts', language: 'typescript', lineCount: 20 },
    ])

    expect(index.files.size).toBe(2)
    expect(index.files.get('a.ts')!.content).toBe('')
    expect(index.files.get('b.ts')!.content).toBe('')
  })

  it('totalFiles equals the meta size', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts' },
      { path: 'b.ts' },
      { path: 'c.ts' },
    ])

    expect(index.totalFiles).toBe(3)
    expect(index.totalFiles).toBe(index.meta!.size)
  })

  it('totalLines is 0 (content not loaded)', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts', lineCount: 100 },
      { path: 'b.ts', lineCount: 200 },
    ])

    expect(index.totalLines).toBe(0)
  })

  it('contentStore is preserved from input index', () => {
    const store = new InMemoryContentStore()
    let index = createEmptyIndex()
    index = { ...index, contentStore: store }

    const result = batchIndexMetadataOnly(index, [
      { path: 'a.ts', language: 'typescript' },
    ])

    expect(result.contentStore).toBe(store)
  })

  it('lineCount defaults to 0 when not provided', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'no-linecount.ts' },
    ])

    const meta = index.meta!.get('no-linecount.ts')
    expect(meta!.lineCount).toBe(0)

    const file = index.files.get('no-linecount.ts')
    expect(file!.lineCount).toBe(0)
  })

  it('language is preserved correctly including undefined', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'typed.ts', language: 'typescript' },
      { path: 'untyped.txt' },
    ])

    expect(index.meta!.get('typed.ts')!.language).toBe('typescript')
    expect(index.meta!.get('untyped.txt')!.language).toBeUndefined()
  })

  it('name is extracted from the last path segment', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'deep/nested/folder/component.tsx' },
      { path: 'root-file.js' },
    ])

    expect(index.meta!.get('deep/nested/folder/component.tsx')!.name).toBe('component.tsx')
    expect(index.meta!.get('root-file.js')!.name).toBe('root-file.js')
  })

  it('works incrementally — preserves existing files from a prior index', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'existing.ts', 'const x = 1', 'typescript')

    const result = batchIndexMetadataOnly(index, [
      { path: 'new-lazy.ts', language: 'typescript' },
    ])

    // Existing file preserved
    expect(result.files.has('existing.ts')).toBe(true)
    expect(result.files.get('existing.ts')!.content).toBe('const x = 1')

    // New lazy file added
    expect(result.files.has('new-lazy.ts')).toBe(true)
    expect(result.files.get('new-lazy.ts')!.content).toBe('')

    expect(result.totalFiles).toBe(2)
    expect(result.meta!.size).toBe(2)
  })

  it('overwrites existing metadata for the same path', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'file.ts', language: 'typescript', lineCount: 10 },
    ])

    const updated = batchIndexMetadataOnly(index, [
      { path: 'file.ts', language: 'javascript', lineCount: 20 },
    ])

    expect(updated.meta!.get('file.ts')!.language).toBe('javascript')
    expect(updated.meta!.get('file.ts')!.lineCount).toBe(20)
    expect(updated.totalFiles).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Integration: batchIndexMetadataOnly + content loading
// ---------------------------------------------------------------------------

describe('batchIndexMetadataOnly integration', () => {
  it('metadata-only index files are searchable as empty (no false matches)', () => {
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'secret.ts', language: 'typescript', lineCount: 100 },
    ])

    const file = index.files.get('secret.ts')!
    // Empty content means no search matches
    expect(file.content).toBe('')
    expect((file.content ?? '').includes('secret')).toBe(false)
  })

  it('mixed content + metadata-only index tracks correctly', () => {
    let index = batchIndexFiles(createEmptyIndex(), [
      { path: 'loaded.ts', content: 'const x = 1', language: 'typescript' },
    ])
    index = batchIndexMetadataOnly(index, [
      { path: 'lazy.ts', language: 'typescript', lineCount: 50 },
    ])

    expect(index.files.get('loaded.ts')!.content).toBe('const x = 1')
    expect(index.files.get('lazy.ts')!.content).toBe('')
    expect(index.totalFiles).toBe(2)
    expect(index.meta!.size).toBe(2)
  })
})
