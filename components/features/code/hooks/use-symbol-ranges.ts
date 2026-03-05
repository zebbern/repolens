import { useMemo } from 'react'
import type { ExtractedSymbol } from './use-symbol-extraction'
import type { SymbolRange } from '../types'

/**
 * Compute line ranges for each symbol based on symbol order and total line count.
 *
 * For top-level symbols, the end line is the line before the next top-level symbol starts,
 * or the total line count for the last symbol.
 *
 * For class children (methods/properties), the end line is the line before the next
 * sibling starts, or the parent's end line for the last child.
 */
export function computeSymbolRanges(
  symbols: ExtractedSymbol[],
  lineCount: number,
): SymbolRange[] {
  if (symbols.length === 0 || lineCount <= 0) return []

  const ranges: SymbolRange[] = []

  // Sort top-level symbols by line number
  const sorted = [...symbols].sort((a, b) => a.line - b.line)

  for (let i = 0; i < sorted.length; i++) {
    const symbol = sorted[i]
    const nextSymbol = sorted[i + 1]
    const parentEndLine = nextSymbol ? nextSymbol.line - 1 : lineCount

    ranges.push({
      symbol,
      startLine: symbol.line,
      endLine: parentEndLine,
    })

    // Process children (class methods, properties)
    if (symbol.children && symbol.children.length > 0) {
      const sortedChildren = [...symbol.children].sort((a, b) => a.line - b.line)

      for (let j = 0; j < sortedChildren.length; j++) {
        const child = sortedChildren[j]
        const nextChild = sortedChildren[j + 1]
        const childEndLine = nextChild ? nextChild.line - 1 : parentEndLine

        ranges.push({
          symbol: child,
          startLine: child.line,
          endLine: childEndLine,
        })
      }
    }
  }

  return ranges
}

/**
 * React hook that computes symbol line ranges from extracted symbols.
 * Memoized on the symbols array reference and lineCount.
 */
export function useSymbolRanges(
  symbols: ExtractedSymbol[],
  lineCount: number,
): SymbolRange[] {
  return useMemo(
    () => computeSymbolRanges(symbols, lineCount),
    [symbols, lineCount],
  )
}
