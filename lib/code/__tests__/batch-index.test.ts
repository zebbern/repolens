import { describe, it, expect } from 'vitest'
import { batchIndexFiles, batchIndexMetadataOnly, createEmptyIndex } from '../code-index'

// ---------------------------------------------------------------------------
// batchIndexFiles
// ---------------------------------------------------------------------------

describe('batchIndexFiles', () => {
  it('indexes a batch of files and returns correct totalFiles and totalLines', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      content: `// file ${i}\nexport const x${i} = ${i};\n`,
      language: 'typescript',
    }))

    const result = batchIndexFiles(createEmptyIndex(), files)

    expect(result.totalFiles).toBe(50)
    // Each file has 3 lines ("// file N", "export const xN = N;", "")
    expect(result.totalLines).toBe(150)
  })

  it('returns an empty index when given no files', () => {
    const result = batchIndexFiles(createEmptyIndex(), [])

    expect(result.totalFiles).toBe(0)
    expect(result.totalLines).toBe(0)
  })

  it('indexes files with correct path, name, and content', () => {
    const result = batchIndexFiles(createEmptyIndex(), [
      { path: 'src/utils/helpers.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ])

    const file = result.files.get('src/utils/helpers.ts')
    expect(file).toBeDefined()
    expect(file!.name).toBe('helpers.ts')
    expect(file!.content).toContain('export function add')
    expect(file!.lineCount).toBe(1)
  })

  it('preserves existing files when adding new ones', () => {
    const initial = batchIndexFiles(createEmptyIndex(), [
      { path: 'a.ts', content: 'const a = 1;' },
    ])

    const result = batchIndexFiles(initial, [
      { path: 'b.ts', content: 'const b = 2;' },
    ])

    expect(result.totalFiles).toBe(2)
    expect(result.files.has('a.ts')).toBe(true)
    expect(result.files.has('b.ts')).toBe(true)
  })

  it('overwrites a file when the same path is indexed again', () => {
    const initial = batchIndexFiles(createEmptyIndex(), [
      { path: 'x.ts', content: 'old content' },
    ])

    const result = batchIndexFiles(initial, [
      { path: 'x.ts', content: 'new content' },
    ])

    expect(result.totalFiles).toBe(1)
    expect(result.files.get('x.ts')!.content).toBe('new content')
  })

  it('correctly counts lines across a batch with varying content', () => {
    const result = batchIndexFiles(createEmptyIndex(), [
      { path: 'one-line.ts', content: 'x' },          // 1 line
      { path: 'three-lines.ts', content: 'a\nb\nc' }, // 3 lines
      { path: 'empty.ts', content: '' },               // 1 line (empty string splits to [""])
    ])

    expect(result.totalFiles).toBe(3)
    expect(result.totalLines).toBe(5) // 1 + 3 + 1
  })

  it('stores the language property when provided', () => {
    const result = batchIndexFiles(createEmptyIndex(), [
      { path: 'script.py', content: 'print("hi")', language: 'python' },
    ])

    expect(result.files.get('script.py')!.language).toBe('python')
  })
})

describe('batchIndexMetadataOnly', () => {
  it('restores totalLines from persisted metadata', () => {
    const result = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'a.ts', lineCount: 12 },
      { path: 'b.ts', lineCount: 3 },
    ])

    expect(result.totalLines).toBe(15)
  })
})
