import { describe, it, expect } from 'vitest'
import { parsePatch } from '../diff-utils'

describe('parsePatch', () => {
  it('returns empty patch for undefined input', () => {
    const result = parsePatch(undefined)
    expect(result).toEqual({ hunks: [], isBinary: false, isTruncated: false })
  })

  it('returns empty patch for empty string', () => {
    const result = parsePatch('')
    expect(result).toEqual({ hunks: [], isBinary: false, isTruncated: false })
  })

  it('detects binary files', () => {
    const result = parsePatch('Binary file not shown')
    expect(result.isBinary).toBe(true)
    expect(result.hunks).toEqual([])
  })

  it('detects GIT binary patch marker', () => {
    const result = parsePatch('GIT binary patch\nliteral 1234\n...')
    expect(result.isBinary).toBe(true)
  })

  it('parses a standard unified diff with add, remove, and context lines', () => {
    const patch = [
      '@@ -1,4 +1,5 @@',
      ' line1',
      '-line2',
      '+line2-modified',
      '+line2b-new',
      ' line3',
    ].join('\n')

    const result = parsePatch(patch)

    expect(result.isBinary).toBe(false)
    expect(result.hunks).toHaveLength(1)

    const hunk = result.hunks[0]
    expect(hunk.oldStart).toBe(1)
    expect(hunk.oldLines).toBe(4)
    expect(hunk.newStart).toBe(1)
    expect(hunk.newLines).toBe(5)

    const types = hunk.lines.map(l => l.type)
    expect(types).toEqual(['context', 'remove', 'add', 'add', 'context'])

    // Context lines have both old and new line numbers
    expect(hunk.lines[0].oldLineNumber).toBe(1)
    expect(hunk.lines[0].newLineNumber).toBe(1)

    // Remove lines have old but not new
    expect(hunk.lines[1].oldLineNumber).toBe(2)
    expect(hunk.lines[1].newLineNumber).toBeNull()

    // Add lines have new but not old
    expect(hunk.lines[2].oldLineNumber).toBeNull()
    expect(hunk.lines[2].newLineNumber).toBeTypeOf('number')
  })

  it('parses multiple hunks', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' top',
      '-old',
      '+new',
      ' bottom',
      '@@ -10,2 +10,3 @@',
      ' ctx',
      '+added',
      ' end',
    ].join('\n')

    const result = parsePatch(patch)
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].oldStart).toBe(1)
    expect(result.hunks[1].oldStart).toBe(10)
  })

  it('skips "no newline at end of file" markers', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
    ].join('\n')

    const result = parsePatch(patch)
    expect(result.hunks[0].lines).toHaveLength(2)
    expect(result.hunks[0].lines.map(l => l.type)).toEqual(['remove', 'add'])
  })
})
