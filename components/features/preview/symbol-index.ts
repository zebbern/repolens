// Symbol extraction for the search overlay's Symbols tab, kept out of the
// component module so editing it does not force a Fast Refresh full reload.

import type { CodeIndex } from "@/lib/code/code-index"
import { resolveFileContentBatches } from "@/lib/code/code-index"
import { throwIfAborted, yieldToEventLoop } from "@/lib/code/yield"
import { extractSymbols, type ExtractedSymbol } from "@/components/features/code/hooks/use-symbol-extraction"

export interface SymbolResult {
  symbol: ExtractedSymbol
  filePath: string
  fileName: string
}

export interface SymbolIndex {
  symbols: SymbolResult[]
  /** Indexed files whose source could not be resolved. */
  missingPaths: number
  totalPaths: number
  residentOnly: boolean
}

// Complete symbol lists per code index. Edits and renames publish a new CodeIndex,
// so identity is the invalidation key. Partial or on-demand results are not cached:
// source can still be filled into the same index in place.
const symbolIndexCache = new WeakMap<CodeIndex, SymbolResult[]>()

/** Extract every file's symbols in index order, one bounded batch per task. */
export async function loadSymbolIndex(codeIndex: CodeIndex, signal?: AbortSignal): Promise<SymbolIndex> {
  const paths = Array.from(codeIndex.files.keys())
  const cached = symbolIndexCache.get(codeIndex)
  if (cached) return { symbols: cached, missingPaths: 0, totalPaths: paths.length, residentOnly: false }

  const symbols: SymbolResult[] = []
  let missingPaths = 0
  for await (const batch of resolveFileContentBatches(codeIndex, paths, { signal })) {
    missingPaths += batch.missingPaths.length
    for (const path of batch.paths) {
      const file = codeIndex.files.get(path)
      const content = batch.contents.get(path)
      if (!file || typeof content !== 'string') continue
      for (const symbol of extractSymbols(content, file.language)) {
        symbols.push({ symbol, filePath: file.path, fileName: file.name })
        if (symbol.children) {
          for (const child of symbol.children) {
            symbols.push({ symbol: child, filePath: file.path, fileName: file.name })
          }
        }
      }
    }
    await yieldToEventLoop()
    throwIfAborted(signal)
  }

  const residentOnly = codeIndex.contentStore.bulkReadMode === 'resident-only'
  if (missingPaths === 0 && !residentOnly) symbolIndexCache.set(codeIndex, symbols)
  return { symbols, missingPaths, totalPaths: paths.length, residentOnly }
}
