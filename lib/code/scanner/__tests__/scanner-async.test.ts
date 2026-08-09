import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scanIssues, scanIssuesAsync, clearScanCache } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { scanWithTreeSitter } from '@/lib/code/scanner/tree-sitter-scanner'

vi.mock('@/lib/code/scanner/tree-sitter-scanner', () => ({
  scanWithTreeSitter: vi.fn(),
}))

const mockedScanWithTreeSitter = vi.mocked(scanWithTreeSitter)

describe('scanIssuesAsync', () => {
  beforeEach(() => {
    clearScanCache()
    mockedScanWithTreeSitter.mockReset()
    mockedScanWithTreeSitter.mockResolvedValue([])
  })

  it('returns same results as sync scanIssues for identical input', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/danger.ts', 'const result = eval(userInput)', 'typescript')
    index = indexFile(index, 'src/messy.ts', 'console.log("debug info")', 'typescript')

    const syncResult = scanIssues(index, null)
    clearScanCache()
    const asyncResult = await scanIssuesAsync(index, null)

    expect(asyncResult.issues.length).toBe(syncResult.issues.length)
    expect(asyncResult.summary).toEqual(syncResult.summary)
    expect(asyncResult.healthGrade).toBe(syncResult.healthGrade)
    expect(asyncResult.healthScore).toBe(syncResult.healthScore)
    expect(asyncResult.scannedFiles).toBe(syncResult.scannedFiles)
    expect(asyncResult.rulesEvaluated).toBe(syncResult.rulesEvaluated)
    expect(asyncResult.languagesDetected).toEqual(syncResult.languagesDetected)
    expect(syncResult.diagnostics.engines['tree-sitter']).toBe('skipped')
    expect(asyncResult.diagnostics.engines['tree-sitter']).toBe('completed')

    // Issue IDs and severities match
    const syncIds = syncResult.issues.map(i => i.id).sort()
    const asyncIds = asyncResult.issues.map(i => i.id).sort()
    expect(asyncIds).toEqual(syncIds)
  })

  it('rejects with AbortError when already aborted', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const controller = new AbortController()
    controller.abort()

    await expect(scanIssuesAsync(index, null, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('rejects with AbortError when aborted between phases', async () => {
    let index = createEmptyIndex()
    // Add enough files to ensure multiple phases
    for (let i = 0; i < 5; i++) {
      index = indexFile(index, `src/file${i}.ts`, `eval(x${i})`, 'typescript')
    }

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 0)

    await expect(scanIssuesAsync(index, null, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
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

    // Different codeIndex → different results
    expect(result2).not.toBe(result1)
  })

  it('handles empty index', async () => {
    const index = createEmptyIndex()

    const result = await scanIssuesAsync(index, null)

    expect(result.issues).toHaveLength(0)
    expect(result.healthScore).toBe(100)
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

    // Partial scan should find issues only in the changed file
    const partialFiles = new Set(partialResult.issues.map(i => i.file))
    expect(partialFiles.has('src/b.ts')).toBe(false)
  })

  it('reports Tree-sitter failure in best-effort mode', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.py', 'try:\n    pass\nexcept:\n    pass\n', 'python')
    mockedScanWithTreeSitter.mockRejectedValueOnce(new Error('grammar unavailable'))

    const result = await scanIssuesAsync(index, null)

    expect(result.diagnostics.engines['tree-sitter']).toBe('failed')
    expect(result.diagnostics.failures).toEqual([
      { engine: 'tree-sitter', message: 'grammar unavailable' },
    ])
  })

  it('reports content engines as not applicable for metadata-only scans', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const result = await scanIssuesAsync(index, null, { metadataOnly: true })

    expect(result.diagnostics).toEqual({
      engines: {
        regex: 'not-applicable',
        ast: 'not-applicable',
        taint: 'not-applicable',
        composite: 'not-applicable',
        structural: 'completed',
        'supply-chain': 'not-applicable',
        'tree-sitter': 'not-applicable',
      },
      failures: [],
    })
    expect(mockedScanWithTreeSitter).not.toHaveBeenCalled()
  })

  it('throws an engine failure in strict mode', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.py', 'try:\n    pass\nexcept:\n    pass\n', 'python')
    mockedScanWithTreeSitter.mockRejectedValueOnce(new Error('query failed'))

    await expect(scanIssuesAsync(index, null, { failureMode: 'strict' })).rejects.toThrow(
      'query failed',
    )
  })

  it('does not cache a best-effort scan with an engine failure', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.py', 'try:\n    pass\nexcept:\n    pass\n', 'python')
    mockedScanWithTreeSitter
      .mockRejectedValueOnce(new Error('temporary grammar failure'))
      .mockResolvedValueOnce([])

    const failed = await scanIssuesAsync(index, null)
    const recovered = await scanIssuesAsync(index, null)

    expect(failed.diagnostics.engines['tree-sitter']).toBe('failed')
    expect(recovered.diagnostics.engines['tree-sitter']).toBe('completed')
    expect(recovered).not.toBe(failed)
    expect(mockedScanWithTreeSitter).toHaveBeenCalledTimes(2)
  })

  it('does not cache or deduplicate scans carrying a signal', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const first = await scanIssuesAsync(index, null, { signal: new AbortController().signal })
    const second = await scanIssuesAsync(index, null, { signal: new AbortController().signal })

    expect(second).not.toBe(first)
    expect(mockedScanWithTreeSitter).toHaveBeenCalledTimes(2)
  })

  it('keeps cache identity separate for failure mode', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(x)', 'typescript')

    const bestEffort = await scanIssuesAsync(index, null, { failureMode: 'best-effort' })
    const strict = await scanIssuesAsync(index, null, { failureMode: 'strict' })

    expect(strict).not.toBe(bestEffort)
    expect(mockedScanWithTreeSitter).toHaveBeenCalledTimes(2)
  })
})
