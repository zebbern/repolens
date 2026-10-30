// Tests for lazy content loading scanner features:
// - scanIssuesAsync with { metadataOnly: true }
// - on-demand single-file scans (scanIssuesAsync with { changedFiles })
// - mergeScanResults
// - unscannedFileCount / isMetadataOnly fields

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import { scanIssuesAsync, mergeScanResults, clearScanCache } from './scanner'
import { scan } from './__tests__/scan-test-helpers'
import { createEmptyIndex, indexFile, batchIndexMetadataOnly } from '../code-index'
import type { CodeIndex } from '../code-index'

beforeEach(() => {
  clearScanCache()
})

// ---------------------------------------------------------------------------
// Helper: build a metadata-only index (simulates batchIndexMetadataOnly)
// ---------------------------------------------------------------------------
function buildMetadataOnlyIndex(
  files: Array<{ path: string; language?: string; lineCount?: number }>,
): CodeIndex {
  const base = createEmptyIndex()
  return batchIndexMetadataOnly(base, files)
}

// ---------------------------------------------------------------------------
// Helper: build an index with some files having content and some metadata-only
// ---------------------------------------------------------------------------
function buildPartialContentIndex(): CodeIndex {
  // Start with full-content files
  let index = createEmptyIndex()
  index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')
  index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')
  // Add metadata-only files with content omitted.
  return batchIndexMetadataOnly(index, [
    { path: 'src/large-file.ts', language: 'typescript', lineCount: 500 },
    { path: 'src/unloaded-a.ts', language: 'typescript', lineCount: 50 },
    { path: 'src/unloaded-b.py', language: 'python', lineCount: 100 },
  ])
}

// ===========================================================================
// scanIssuesAsync with { metadataOnly: true }
// ===========================================================================

describe('scanIssuesAsync with metadataOnly option', () => {
  it('returns valid ScanResults with isMetadataOnly: true', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/app.ts', language: 'typescript', lineCount: 100 },
      { path: 'src/utils.ts', language: 'typescript', lineCount: 50 },
    ])

    const result = await scan(index, null, { metadataOnly: true })

    expect(result.isMetadataOnly).toBe(true)
    expect(result.scannedAt).toBeInstanceOf(Date)
    expect(result.healthScore).toBeGreaterThanOrEqual(0)
    expect(result.healthScore).toBeLessThanOrEqual(100)
  })

  it('does NOT run regex-based rules (no content to search)', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/app.ts', language: 'typescript', lineCount: 10 },
    ])

    const result = await scan(index, null, { metadataOnly: true })

    // No content-based rules should fire
    const regexIssues = result.issues.filter(i =>
      i.ruleId === 'eval-usage' || i.ruleId === 'console-log' || i.ruleId === 'hardcoded-secret',
    )
    expect(regexIssues).toHaveLength(0)
  })

  it('detects large-file structural issue from metadata', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/huge.ts', language: 'typescript', lineCount: 900 },
      { path: 'src/small.ts', language: 'typescript', lineCount: 50 },
    ])

    const result = await scan(index, null, { metadataOnly: true })

    const largeFileIssues = result.issues.filter(i => i.ruleId === 'large-file')
    expect(largeFileIssues).toHaveLength(1)
    expect(largeFileIssues[0].file).toBe('src/huge.ts')
    expect(largeFileIssues[0].severity).toBe('warning') // 900 > 800
  })

  it('reports correct unscannedFileCount for metadata-only index', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/a.ts', language: 'typescript', lineCount: 10 },
      { path: 'src/b.ts', language: 'typescript', lineCount: 20 },
      { path: 'src/c.ts', language: 'typescript', lineCount: 30 },
    ])

    const result = await scan(index, null, { metadataOnly: true })

    // All files have absent content, so all are unscanned.
    expect(result.unscannedFileCount).toBe(3)
  })

  it('does not cache metadata-only results (no memoization interference)', async () => {
    // Inline content, so only the metadata-only option keeps the result out of the memo.
    const index = indexFile(createEmptyIndex(), 'src/a.ts', 'eval(x)', 'typescript')

    // Direct calls: the scan() helper clears the memo, which would hide caching.
    const result1 = await scanIssuesAsync(index, null, { metadataOnly: true })
    const result2 = await scanIssuesAsync(index, null, { metadataOnly: true })

    expect(result1.isMetadataOnly).toBe(true)
    expect(result2.isMetadataOnly).toBe(true)
    expect(result2).not.toBe(result1)
  })

  it('default behavior (no options) is unchanged', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')

    const result = await scan(index, null)

    expect(result.isMetadataOnly).toBe(false)
    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
  })

  it('backward compatible with string[] changedFiles parameter', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'console.log("a")', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("b")', 'typescript')

    // Old-style call with string[]
    const result = await scan(index, null, ['src/a.ts'])

    expect(result.isPartialScan).toBe(true)
    const filesWithIssues = new Set(result.issues.map(i => i.file))
    for (const file of filesWithIssues) {
      expect(file).toBe('src/a.ts')
    }
  })

  it('options object with changedFiles works same as string[]', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'console.log("a")', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("b")', 'typescript')

    const result = await scan(index, null, { changedFiles: ['src/a.ts'] })

    expect(result.isPartialScan).toBe(true)
    const filesWithIssues = new Set(result.issues.map(i => i.file))
    for (const file of filesWithIssues) {
      expect(file).toBe('src/a.ts')
    }
  })
})

// ===========================================================================
// unscannedFileCount
// ===========================================================================

describe('unscannedFileCount', () => {
  it('is 0 for fully indexed codebase', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1', 'typescript')

    const result = await scan(index, null)

    expect(result.unscannedFileCount).toBe(0)
  })

  it('counts files with absent content', async () => {
    const index = buildPartialContentIndex()
    const result = await scan(index, null)

    // Three metadata-only files have absent content.
    expect(result.unscannedFileCount).toBe(3)
  })

  it('present on metadata-only scans', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'a.ts', lineCount: 10 },
      { path: 'b.ts', lineCount: 20 },
    ])

    const result = await scan(index, null, { metadataOnly: true })
    expect(result.unscannedFileCount).toBe(2)
  })
})

// ===========================================================================
// On-demand single-file scans (scanIssuesAsync with { changedFiles })
// ===========================================================================

describe('on-demand single-file scans', () => {
  it('scans a single file and returns issues for that file only', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const x = eval(input)', 'typescript')
    index = indexFile(index, 'src/other.ts', 'console.log("hi")', 'typescript')

    const result = await scanIssuesAsync(index, null, { changedFiles: ['src/danger.ts'] })

    expect(result.isPartialScan).toBe(true)
    expect(result.scannedFiles).toBe(1)
    const filesWithIssues = new Set(result.issues.map(i => i.file))
    for (const file of filesWithIssues) {
      expect(file).toBe('src/danger.ts')
    }
  })

  it('returns eval-usage for a file with eval()', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(userInput)', 'typescript')

    const result = await scanIssuesAsync(index, null, { changedFiles: ['src/app.ts'] })

    const evalIssues = result.issues.filter(i => i.ruleId === 'eval-usage')
    expect(evalIssues.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty issues for clean file', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/clean.ts', 'export const x = 1', 'typescript')

    const result = await scanIssuesAsync(index, null, { changedFiles: ['src/clean.ts'] })

    expect(result.issues).toHaveLength(0)
  })

  it('does not cache on-demand scans or let them evict the full-scan memo', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'const clean = 1', 'typescript')

    // Direct calls: the scan() helper clears the memo, which would hide caching.
    const fullResult = await scanIssuesAsync(index, null)
    const onDemand1 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const onDemand2 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })

    expect(onDemand1.isPartialScan).toBe(true)
    expect(onDemand2).not.toBe(onDemand1)
    expect(await scanIssuesAsync(index, null)).toBe(fullResult)
  })
})

// ===========================================================================
// mergeScanResults
// ===========================================================================

describe('mergeScanResults', () => {
  it('keeps the newest repository coverage when merging on-demand scans', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index.coverage = {
      treeStatus: 'complete',
      supportedFiles: { discovered: 2, loaded: 1 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'on-demand',
    }
    const base = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    index.coverage = {
      ...index.coverage,
      supportedFiles: { discovered: 2, loaded: 2 },
    }
    const addition = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })

    expect(mergeScanResults(base, addition).repositoryCoverage?.supportedFiles.loaded).toBe(2)
  })

  it('combines issues from two results without duplicates', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("debug")', 'typescript')

    const resultA = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const resultB = await scanIssuesAsync(index, null, { changedFiles: ['src/b.ts'] })
    const merged = mergeScanResults(resultA, resultB)

    // Should have issues from both files
    const files = new Set(merged.issues.map(i => i.file))
    expect(files.has('src/a.ts')).toBe(true)
    expect(files.has('src/b.ts')).toBe(true)

    // No duplicate ids
    const ids = merged.issues.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('deduplicates identical issues', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')

    const result1 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const result2 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const merged = mergeScanResults(result1, result2)

    // Should have same issues as a single scan (no duplicates)
    expect(merged.issues.length).toBe(result1.issues.length)
  })

  it('recomputes summary from merged issues', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("debug")', 'typescript')

    const resultA = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const resultB = await scanIssuesAsync(index, null, { changedFiles: ['src/b.ts'] })
    const merged = mergeScanResults(resultA, resultB)

    expect(merged.summary.total).toBe(merged.issues.length)
    expect(merged.summary.critical + merged.summary.warning + merged.summary.info)
      .toBe(merged.summary.total)
  })

  it('maintains sorted order (critical first)', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("debug")', 'typescript')

    const resultA = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const resultB = await scanIssuesAsync(index, null, { changedFiles: ['src/b.ts'] })
    const merged = mergeScanResults(resultA, resultB)

    if (merged.issues.length >= 2) {
      const severityOrder = { critical: 0, warning: 1, info: 2 } as const
      for (let i = 1; i < merged.issues.length; i++) {
        const prev = severityOrder[merged.issues[i - 1].severity]
        const curr = severityOrder[merged.issues[i].severity]
        expect(prev).toBeLessThanOrEqual(curr)
      }
    }
  })

  it('sets isMetadataOnly: false and isPartialScan: false', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')

    const metadataResult = await scan(
      buildMetadataOnlyIndex([{ path: 'src/huge.ts', lineCount: 900 }]),
      null,
      { metadataOnly: true },
    )
    const contentResult = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const merged = mergeScanResults(metadataResult, contentResult)

    expect(merged.isMetadataOnly).toBe(false)
    expect(merged.isPartialScan).toBe(false)
  })

  it('combines scannedFiles count', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'console.log("debug")', 'typescript')

    const resultA = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const resultB = await scanIssuesAsync(index, null, { changedFiles: ['src/b.ts'] })
    const merged = mergeScanResults(resultA, resultB)

    expect(merged.scannedFiles).toBe(resultA.scannedFiles + resultB.scannedFiles)
  })

  it('reduces unscannedFileCount from base', async () => {
    // Simulate: metadata-only scan reports 5 unscanned, then we scan 1 file
    const metaIndex = buildMetadataOnlyIndex([
      { path: 'a.ts', lineCount: 10 },
      { path: 'b.ts', lineCount: 20 },
      { path: 'c.ts', lineCount: 30 },
      { path: 'd.ts', lineCount: 40 },
      { path: 'e.ts', lineCount: 50 },
    ])
    const metaResult = await scan(metaIndex, null, { metadataOnly: true })
    expect(metaResult.unscannedFileCount).toBe(5)

    // Now scan one file on-demand
    let fullIndex = createEmptyIndex()
    fullIndex = indexFile(fullIndex, 'a.ts', 'console.log("hi")', 'typescript')
    const onDemand = await scanIssuesAsync(fullIndex, null, { changedFiles: ['a.ts'] })

    const merged = mergeScanResults(metaResult, onDemand)
    expect(merged.unscannedFileCount).toBe(4)
  })

  it('merges rule overflow maps', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')

    const result1 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })
    const result2 = await scanIssuesAsync(index, null, { changedFiles: ['src/a.ts'] })

    // Manually set overflow for testing
    result1.ruleOverflow.set('test-rule', 3)
    result2.ruleOverflow.set('test-rule', 5)
    result2.ruleOverflow.set('other-rule', 2)

    const merged = mergeScanResults(result1, result2)
    expect(merged.ruleOverflow.get('test-rule')).toBe(8) // 3 + 5
    expect(merged.ruleOverflow.get('other-rule')).toBe(2)
  })

  it('merges languagesDetected without duplicates', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'a.ts', 'const x = 1', 'typescript')
    index = indexFile(index, 'b.py', 'x = 1', 'python')

    const result1 = await scanIssuesAsync(index, null, { changedFiles: ['a.ts'] })
    const result2 = await scanIssuesAsync(index, null, { changedFiles: ['b.py'] })

    result1.languagesDetected = ['typescript']
    result2.languagesDetected = ['typescript', 'python']

    const merged = mergeScanResults(result1, result2)
    const unique = new Set(merged.languagesDetected)
    expect(unique.size).toBe(merged.languagesDetected.length)
    expect(unique.has('typescript')).toBe(true)
    expect(unique.has('python')).toBe(true)
  })
})

// ===========================================================================
// structural scanner metadata-only support
// ===========================================================================

describe('structural scanner with metadata-only files', () => {
  it('detects large files from metadata when analysis is null', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/huge.ts', language: 'typescript', lineCount: 500 },
      { path: 'src/small.ts', language: 'typescript', lineCount: 50 },
    ])

    // Full scan with null analysis — structural scanner should still find large files
    const result = await scan(index, null)

    const largeFileIssues = result.issues.filter(i => i.ruleId === 'large-file')
    expect(largeFileIssues).toHaveLength(1)
    expect(largeFileIssues[0].file).toBe('src/huge.ts')
  })

  it('does not detect large files when lineCount is 0 (unknown)', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/unknown.ts', language: 'typescript' }, // lineCount defaults to 0
    ])

    const result = await scan(index, null, { metadataOnly: true })
    const largeFileIssues = result.issues.filter(i => i.ruleId === 'large-file')
    expect(largeFileIssues).toHaveLength(0)
  })

  it('severity is info for 401-800 lines, warning for >800', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/medium.ts', language: 'typescript', lineCount: 500 },
      { path: 'src/huge.ts', language: 'typescript', lineCount: 900 },
    ])

    const result = await scan(index, null, { metadataOnly: true })
    const largeFileIssues = result.issues.filter(i => i.ruleId === 'large-file')
    expect(largeFileIssues).toHaveLength(2)

    const medium = largeFileIssues.find(i => i.file === 'src/medium.ts')
    const huge = largeFileIssues.find(i => i.file === 'src/huge.ts')
    expect(medium?.severity).toBe('info')
    expect(huge?.severity).toBe('warning')
  })
})

// ===========================================================================
// ScanResults type fields
// ===========================================================================

describe('ScanResults type fields', () => {
  it('includes unscannedFileCount and isMetadataOnly in full scan', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1', 'typescript')

    const result = await scan(index, null)

    expect(result.unscannedFileCount).toBeDefined()
    expect(result.isMetadataOnly).toBe(false)
  })

  it('includes unscannedFileCount and isMetadataOnly in metadata scan', async () => {
    const index = buildMetadataOnlyIndex([
      { path: 'src/app.ts', lineCount: 10 },
    ])

    const result = await scan(index, null, { metadataOnly: true })

    expect(result.unscannedFileCount).toBe(1)
    expect(result.isMetadataOnly).toBe(true)
  })
})
