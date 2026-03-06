import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from '../fuzzy-match'

describe('fuzzyMatch', () => {
  it('returns null for empty query', () => {
    expect(fuzzyMatch('', 'src/utils.ts')).toBeNull()
  })

  it('returns null when not all characters are present', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('abz', 'abc')).toBeNull()
  })

  it('returns indices for each matched character', () => {
    const result = fuzzyMatch('abc', 'a_b_c')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0, 2, 4])
  })

  it('is case-insensitive', () => {
    const result = fuzzyMatch('ABC', 'abcdef')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([0, 1, 2])
  })

  it('gives case-exact match a bonus', () => {
    const lower = fuzzyMatch('a', 'A')
    const exact = fuzzyMatch('a', 'a')
    expect(lower).not.toBeNull()
    expect(exact).not.toBeNull()
    expect(exact!.score).toBeGreaterThan(lower!.score)
  })

  it('scores consecutive matches higher than distant matches', () => {
    const consecutive = fuzzyMatch('abc', 'abcdef')
    const distant = fuzzyMatch('abc', 'a___b___c')
    expect(consecutive).not.toBeNull()
    expect(distant).not.toBeNull()
    expect(consecutive!.score).toBeGreaterThan(distant!.score)
  })

  it('gives start-of-word bonus after path separators', () => {
    const withSep = fuzzyMatch('u', 'src/utils.ts')
    const noSep = fuzzyMatch('u', 'srcxutils.ts')
    expect(withSep).not.toBeNull()
    expect(noSep).not.toBeNull()
    // After `/`, `u` gets a start-of-word bonus
    expect(withSep!.score).toBeGreaterThan(noSep!.score)
  })

  it('gives start-of-word bonus after dot and dash separators', () => {
    // 'my-test': 't' at index 3 is after '-' (separator) → gets bonus
    const dashResult = fuzzyMatch('t', 'my-test')
    // 'mytxest': 't' at index 2 is NOT after a separator → no bonus
    const noSep = fuzzyMatch('t', 'mytxest')
    expect(dashResult).not.toBeNull()
    expect(noSep).not.toBeNull()
    expect(dashResult!.score).toBeGreaterThan(noSep!.score)
  })

  it('gives start-of-word bonus for first character (index 0)', () => {
    const atStart = fuzzyMatch('s', 'src/utils.ts')
    expect(atStart).not.toBeNull()
    // index 0 gets the start-of-word bonus (+5) plus case match (+1) plus base (1)
    expect(atStart!.score).toBeGreaterThanOrEqual(6)
  })

  it('penalizes longer paths', () => {
    const short = fuzzyMatch('a', 'a.ts')
    const long = fuzzyMatch('a', 'a-very-long-path-name-that-goes-on-and-on.ts')
    expect(short).not.toBeNull()
    expect(long).not.toBeNull()
    expect(short!.score).toBeGreaterThan(long!.score)
  })

  it('matches multi-char query across path: sut → src/utils.ts', () => {
    const result = fuzzyMatch('sut', 'src/utils.ts')
    expect(result).not.toBeNull()
    expect(result!.indices.length).toBe(3)
    // 's' at index 0, 'u' at index 4 (after /), 't' at index 9 (after .)
  })

  it('returns correct indices for exact substring', () => {
    const result = fuzzyMatch('test', 'my-test-file.ts')
    expect(result).not.toBeNull()
    expect(result!.indices).toEqual([3, 4, 5, 6])
  })
})
