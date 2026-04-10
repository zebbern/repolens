// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isFileIndexable, INDEXABLE_EXTENSIONS } from '../zipball'

// ---------------------------------------------------------------------------
// isFileIndexable
// ---------------------------------------------------------------------------

describe('isFileIndexable', () => {
  it('accepts a .ts file under the size limit', () => {
    expect(isFileIndexable('index.ts', 1000)).toBe(true)
  })

  it('accepts a full path with an indexable extension', () => {
    expect(isFileIndexable('src/utils/helpers.py', 200)).toBe(true)
  })

  it('rejects a binary file extension', () => {
    expect(isFileIndexable('image.png', 100)).toBe(false)
  })

  it('rejects a file exceeding 500KB', () => {
    expect(isFileIndexable('huge.ts', 500_001)).toBe(false)
  })

  it('accepts a file exactly at the 500KB boundary', () => {
    expect(isFileIndexable('boundary.ts', 500_000)).toBe(true)
  })

  it('rejects a file with no extension', () => {
    expect(isFileIndexable('Makefile', 100)).toBe(false)
  })

  it.each([
    'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java',
    'json', 'yaml', 'yml', 'md', 'css', 'html', 'sql',
  ])('accepts .%s extension', (ext) => {
    expect(isFileIndexable(`file.${ext}`, 100)).toBe(true)
  })

  it.each([
    'png', 'jpg', 'gif', 'svg', 'woff', 'ttf', 'exe', 'dll', 'so',
  ])('rejects .%s extension', (ext) => {
    expect(isFileIndexable(`file.${ext}`, 100)).toBe(false)
  })
})
