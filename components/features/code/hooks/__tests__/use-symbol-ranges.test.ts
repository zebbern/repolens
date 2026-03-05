import { describe, it, expect } from 'vitest'
import { computeSymbolRanges } from '../use-symbol-ranges'
import type { ExtractedSymbol } from '../use-symbol-extraction'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSymbol(
  overrides: Partial<ExtractedSymbol> & Pick<ExtractedSymbol, 'name' | 'line'>,
): ExtractedSymbol {
  return {
    kind: 'function',
    isExported: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeSymbolRanges
// ---------------------------------------------------------------------------

describe('computeSymbolRanges', () => {
  // --- empty / degenerate inputs ---

  it('returns empty ranges for an empty symbols array', () => {
    expect(computeSymbolRanges([], 100)).toEqual([])
  })

  it('returns empty ranges when lineCount is 0', () => {
    const symbols = [makeSymbol({ name: 'foo', line: 1 })]
    expect(computeSymbolRanges(symbols, 0)).toEqual([])
  })

  it('returns empty ranges when lineCount is negative', () => {
    const symbols = [makeSymbol({ name: 'foo', line: 1 })]
    expect(computeSymbolRanges(symbols, -5)).toEqual([])
  })

  // --- single symbol ---

  it('returns a range covering to lineCount for a single symbol', () => {
    const symbols = [makeSymbol({ name: 'foo', line: 5 })]
    const result = computeSymbolRanges(symbols, 20)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      startLine: 5,
      endLine: 20,
    })
    expect(result[0].symbol.name).toBe('foo')
  })

  it('handles a single symbol at line 1', () => {
    const symbols = [makeSymbol({ name: 'main', line: 1 })]
    const result = computeSymbolRanges(symbols, 1)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startLine: 1, endLine: 1 })
  })

  // --- multiple symbols ---

  it('computes sequential ranges with no gaps between top-level symbols', () => {
    const symbols = [
      makeSymbol({ name: 'alpha', line: 1 }),
      makeSymbol({ name: 'bravo', line: 10 }),
      makeSymbol({ name: 'charlie', line: 20 }),
    ]
    const result = computeSymbolRanges(symbols, 30)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ startLine: 1, endLine: 9 })
    expect(result[1]).toMatchObject({ startLine: 10, endLine: 19 })
    expect(result[2]).toMatchObject({ startLine: 20, endLine: 30 })
  })

  it('sorts symbols by line even if input is unsorted', () => {
    const symbols = [
      makeSymbol({ name: 'bravo', line: 10 }),
      makeSymbol({ name: 'alpha', line: 1 }),
      makeSymbol({ name: 'charlie', line: 20 }),
    ]
    const result = computeSymbolRanges(symbols, 30)

    expect(result[0].symbol.name).toBe('alpha')
    expect(result[1].symbol.name).toBe('bravo')
    expect(result[2].symbol.name).toBe('charlie')
  })

  it('does not mutate the original symbols array', () => {
    const symbols = [
      makeSymbol({ name: 'bravo', line: 10 }),
      makeSymbol({ name: 'alpha', line: 1 }),
    ]
    const originalOrder = symbols.map((s) => s.name)
    computeSymbolRanges(symbols, 20)
    expect(symbols.map((s) => s.name)).toEqual(originalOrder)
  })

  // --- symbols with children (class members) ---

  it('includes child ranges bounded by parent end line', () => {
    const symbols = [
      makeSymbol({
        name: 'MyClass',
        kind: 'class',
        line: 1,
        children: [
          makeSymbol({ name: 'methodA', kind: 'method', line: 5 }),
          makeSymbol({ name: 'methodB', kind: 'method', line: 15 }),
        ],
      }),
    ]
    const result = computeSymbolRanges(symbols, 30)

    // parent + 2 children = 3 ranges
    expect(result).toHaveLength(3)

    // Parent range
    expect(result[0]).toMatchObject({
      startLine: 1,
      endLine: 30,
      symbol: expect.objectContaining({ name: 'MyClass' }),
    })

    // First child ends at next child's line - 1
    expect(result[1]).toMatchObject({
      startLine: 5,
      endLine: 14,
      symbol: expect.objectContaining({ name: 'methodA' }),
    })

    // Last child extends to parent's end line
    expect(result[2]).toMatchObject({
      startLine: 15,
      endLine: 30,
      symbol: expect.objectContaining({ name: 'methodB' }),
    })
  })

  it('bounds children by the next top-level symbol instead of lineCount', () => {
    const symbols = [
      makeSymbol({
        name: 'ClassA',
        kind: 'class',
        line: 1,
        children: [
          makeSymbol({ name: 'method', kind: 'method', line: 3 }),
        ],
      }),
      makeSymbol({ name: 'freeFunc', line: 20 }),
    ]
    const result = computeSymbolRanges(symbols, 50)

    // ClassA ends at line 19 (next symbol at line 20 minus 1)
    const classRange = result.find((r) => r.symbol.name === 'ClassA')
    expect(classRange).toMatchObject({ startLine: 1, endLine: 19 })

    // Child method also bounded by parent's end line (19)
    const childRange = result.find((r) => r.symbol.name === 'method')
    expect(childRange).toMatchObject({ startLine: 3, endLine: 19 })
  })

  it('sorts children by line even if input children are unsorted', () => {
    const symbols = [
      makeSymbol({
        name: 'MyClass',
        kind: 'class',
        line: 1,
        children: [
          makeSymbol({ name: 'zebra', kind: 'method', line: 20 }),
          makeSymbol({ name: 'alpha', kind: 'method', line: 5 }),
        ],
      }),
    ]
    const result = computeSymbolRanges(symbols, 30)

    const childRanges = result.filter((r) => r.symbol.kind === 'method')
    expect(childRanges[0].symbol.name).toBe('alpha')
    expect(childRanges[1].symbol.name).toBe('zebra')
  })

  // --- symbol at last line ---

  it('handles a symbol at the last line of the file', () => {
    const symbols = [makeSymbol({ name: 'last', line: 50 })]
    const result = computeSymbolRanges(symbols, 50)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startLine: 50, endLine: 50 })
  })

  // --- type export verification ---

  it('preserves symbol metadata (kind, isExported) through ranges', () => {
    const symbols = [
      makeSymbol({
        name: 'MyInterface',
        kind: 'interface',
        line: 1,
        isExported: false,
      }),
    ]
    const result = computeSymbolRanges(symbols, 10)

    expect(result[0].symbol.kind).toBe('interface')
    expect(result[0].symbol.isExported).toBe(false)
  })
})
