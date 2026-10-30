// Shared helper for scanner tests: runs the authoritative async scanner.

import type { CodeIndex } from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import { clearScanCache, scanIssuesAsync, type AsyncScanOptions } from '@/lib/code/scanner/scanner'
import type { ScanResults } from '@/lib/code/scanner/types'

/**
 * Clear the scan memo, then run scanIssuesAsync, so a test that reuses a
 * CodeIndex always gets a fresh scan. A path array is shorthand for
 * `{ changedFiles }`, as in scanInWorker.
 */
export function scan(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  changedFilesOrOptions: string[] | AsyncScanOptions = {},
): Promise<ScanResults> {
  clearScanCache()
  const options = Array.isArray(changedFilesOrOptions)
    ? { changedFiles: changedFilesOrOptions }
    : changedFilesOrOptions
  return scanIssuesAsync(codeIndex, analysis, options)
}
