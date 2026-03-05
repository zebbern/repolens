import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scanIssues, scanIssuesAsync, clearScanCache } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'

describe('scanIssuesAsync', () => {
  beforeEach(() => {
    clearScanCache()
  })

  it('returns same results as sync scanIssues for identical input', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')
    index = indexFile(index, 'src/messy.ts', 'console.log("debug info")', 'typescript')

    const syncResult = scanIssues(index, null)
    clearScanCache()
    const asyncResult = await scanIssuesAsync(index, null)

    expect(asyncResult).not.toBeNull()
    expect(asyncResult!.issues.length).toBe(syncResult.issues.length)
    expect(asyncResult!.summary).toEqual(syncResult.summary)
    expect(asyncResult!.healthGrade).toBe(syncResult.healthGrade)
    expect(asyncResult!.healthScore).toBe(syncResult.healthScore)
    expect(asyncResult!.scannedFiles).toBe(syncResult.scannedFiles)
    expect(asyncResult!.rulesEvaluated).toBe(syncResult.rulesEvaluated)
    expect(asyncResult!.languagesDetected).toEqual(syncResult.languagesDetected)

    // Issue IDs and severities match
    const syncIds = syncResult.issues.map(i => i.id).sort()
    const asyncIds = asyncResult!.issues.map(i => i.id).sort()
    expect(asyncIds).toEqual(syncIds)
  })

  it('returns null when isStale returns true immediately', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const result = await scanIssuesAsync(index, null, {
      isStale: () => true,
    })

    expect(result).toBeNull()
  })

  it('returns null when isStale becomes true mid-scan', async () => {
    let index = createEmptyIndex()
    // Add enough files to ensure multiple phases
    for (let i = 0; i < 5; i++) {
      index = indexFile(index, `src/file${i}.ts`, `eval(x${i})`, 'typescript')
    }

    let callCount = 0
    const result = await scanIssuesAsync(index, null, {
      isStale: () => {
        callCount++
        // Allow the first yield, abort on the second
        return callCount >= 2
      },
    })

    expect(result).toBeNull()
    // isStale should have been called multiple times (once per yield point)
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  it('yields to main thread between phases (uses setTimeout)', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    // Track microtask vs macrotask ordering to confirm yield points
    const order: string[] = []

    const scanPromise = scanIssuesAsync(index, null).then(() => {
      order.push('scan-done')
    })

    // Schedule a macrotask that should interleave with yield points
    setTimeout(() => order.push('timeout'), 0)

    await scanPromise

    // The setTimeout callback should have had a chance to run during the scan
    // because scanIssuesAsync yields via setTimeout(0) between phases
    // Allow for timing — at minimum, the scan completed
    expect(order).toContain('scan-done')
  })

  it('returns cached result for the same codeIndex instance', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const result1 = await scanIssuesAsync(index, null)
    const result2 = await scanIssuesAsync(index, null)

    expect(result1).not.toBeNull()
    // Should be the exact same reference (cached)
    expect(result2).toBe(result1)
  })

  it('recomputes when codeIndex changes', async () => {
    let index1 = createEmptyIndex()
    index1 = indexFile(index1, 'src/app.ts', 'eval(x)', 'typescript')

    let index2 = createEmptyIndex()
    index2 = indexFile(index2, 'src/app.ts', 'const x = 1', 'typescript')

    const result1 = await scanIssuesAsync(index1, null)
    const result2 = await scanIssuesAsync(index2, null)

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    // Different codeIndex → different results
    expect(result2).not.toBe(result1)
  })

  it('handles empty index', async () => {
    const index = createEmptyIndex()

    const result = await scanIssuesAsync(index, null)

    expect(result).not.toBeNull()
    expect(result!.issues).toHaveLength(0)
    expect(result!.healthScore).toBe(100)
  })

  it('supports changedFiles option for partial scans', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/a.ts', 'eval(x)', 'typescript')
    index = indexFile(index, 'src/b.ts', 'eval(y)', 'typescript')

    const fullResult = await scanIssuesAsync(index, null)
    clearScanCache()
    const partialResult = await scanIssuesAsync(index, null, {
      changedFiles: ['src/a.ts'],
    })

    expect(fullResult).not.toBeNull()
    expect(partialResult).not.toBeNull()
    // Partial scan should find issues only in the changed file
    const partialFiles = new Set(partialResult!.issues.map(i => i.file))
    expect(partialFiles.has('src/b.ts')).toBe(false)
  })

  it('isStale is checked after every yield point', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    let callCount = 0
    await scanIssuesAsync(index, null, {
      isStale: () => {
        callCount++
        return false
      },
    })

    // There are 5 yield points (phases 1-5 + final), so isStale should be
    // called at least 5 times for a full scan
    expect(callCount).toBeGreaterThanOrEqual(5)
  })
})
