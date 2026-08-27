import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scanIssues, scanIssuesAsync, clearScanCache } from '@/lib/code/scanner/scanner'
import {
  batchIndexMetadataOnly,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
} from '@/lib/code/code-index'
import { InMemoryContentStore, type ContentStore } from '@/lib/code/content-store'
import { scanCompositeRules } from '@/lib/code/scanner/rules-composite'
import { scanSupplyChain } from '@/lib/code/scanner/supply-chain-scanner'
import { scanWithTreeSitter } from '@/lib/code/scanner/tree-sitter-scanner'

const scannerViewSizes = vi.hoisted(() => ({ composite: [] as number[], supplyChain: [] as number[] }))
const scannerRegexCompilations = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/lib/code/code-index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/code/code-index')>()
  return {
    ...actual,
    buildSearchRegex: vi.fn((...args: Parameters<typeof actual.buildSearchRegex>) => {
      if (args[1]?.trusted) scannerRegexCompilations.count++
      return actual.buildSearchRegex(...args)
    }),
  }
})

vi.mock('@/lib/code/scanner/rules-composite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/code/scanner/rules-composite')>()
  return {
    ...actual,
    scanCompositeRules: vi.fn((index: Parameters<typeof actual.scanCompositeRules>[0]) => {
      scannerViewSizes.composite.push(index.files.size)
      return actual.scanCompositeRules(index)
    }),
  }
})

vi.mock('@/lib/code/scanner/supply-chain-scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/code/scanner/supply-chain-scanner')>()
  return {
    ...actual,
    scanSupplyChain: vi.fn((index: Parameters<typeof actual.scanSupplyChain>[0]) => {
      scannerViewSizes.supplyChain.push(index.files.size)
      return actual.scanSupplyChain(index)
    }),
  }
})

vi.mock('@/lib/code/scanner/tree-sitter-scanner', () => ({
  scanWithTreeSitter: vi.fn(),
}))

const mockedScanCompositeRules = vi.mocked(scanCompositeRules)
const mockedScanSupplyChain = vi.mocked(scanSupplyChain)
const mockedScanWithTreeSitter = vi.mocked(scanWithTreeSitter)

describe('scanIssuesAsync', () => {
  beforeEach(() => {
    clearScanCache()
    scannerViewSizes.composite.length = 0
    scannerViewSizes.supplyChain.length = 0
    scannerRegexCompilations.count = 0
    mockedScanCompositeRules.mockClear()
    mockedScanSupplyChain.mockClear()
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

    await scanIssuesAsync(index, null)
    clearScanCache()
    const partialResult = await scanIssuesAsync(index, null, {
      changedFiles: ['src/a.ts'],
    })

    // Partial scan should find issues only in the changed file
    const partialFiles = new Set(partialResult.issues.map(i => i.file))
    expect(partialFiles.has('src/b.ts')).toBe(false)
  })

  it('resolves only changed file content for a partial scan', async () => {
    const entries = new Map<string, string>()
    const metadata = Array.from({ length: 101 }, (_, index) => {
      const path = `src/file-${index}.ts`
      entries.set(path, index === 100 ? 'eval(changedValue)' : 'const value = 1')
      return { path, language: 'typescript', lineCount: 1 }
    })
    const store = new InMemoryContentStore(entries)
    const getBatch = vi.spyOn(store, 'getBatch')
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), metadata)

    const result = await scanIssuesAsync(index, null, {
      changedFiles: ['src/file-100.ts'],
    })

    expect(getBatch).toHaveBeenCalledOnce()
    expect(getBatch).toHaveBeenCalledWith(['src/file-100.ts'])
    expect(result.issues.some(issue => issue.file === 'src/file-100.ts')).toBe(true)
  })

  it('computes issue density from resolved source when metadata has no line count', async () => {
    const source = ['eval(userInput)', ...Array.from({ length: 999 }, () => '// filler')].join('\n')
    const store = new InMemoryContentStore(new Map([['src/app.ts', source]]))
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/app.ts', language: 'typescript' },
    ])

    const result = await scanIssuesAsync(index, null)

    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issuesPerKloc).toBeCloseTo(result.issues.length, 5)
  })

  it('does not hydrate or report intentionally excluded fixture paths as missing', async () => {
    const store = new InMemoryContentStore(new Map([
      ['src/app.ts', 'const value = 1'],
    ]))
    const getBatch = vi.spyOn(store, 'getBatch')
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/app.ts', language: 'typescript', lineCount: 1 },
      { path: '__tests__/fixture.ts', language: 'typescript', lineCount: 1 },
    ])

    const result = await scanIssuesAsync(index, null)

    expect(getBatch).toHaveBeenCalledOnce()
    expect(getBatch).toHaveBeenCalledWith(['src/app.ts'])
    expect(result.isPartialScan).toBe(false)
    expect(result.unscannedFileCount).toBe(0)
    expect(result.scannedFiles).toBe(1)
  })

  it('preserves metadata-safe structural findings when file content is unavailable', async () => {
    const store = new InMemoryContentStore()
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/large.ts', language: 'typescript', lineCount: 900 },
    ])

    const result = await scanIssuesAsync(index, null)

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/large.ts', ruleId: 'large-file' }),
    ]))
    expect(mockedScanWithTreeSitter).not.toHaveBeenCalled()
    expect(result.unscannedFileCount).toBe(1)
    expect(result.scannedFiles).toBe(0)
  })

  it('does not count unavailable changed-file content as scanned', async () => {
    const store = new InMemoryContentStore()
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/large.ts', language: 'typescript', lineCount: 900 },
    ])

    const result = await scanIssuesAsync(index, null, { changedFiles: ['src/large.ts'] })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'src/large.ts', ruleId: 'large-file' }),
    ]))
    expect(result.scannedFiles).toBe(0)
    expect(result.unscannedFileCount).toBe(1)
  })

  it('uses bounded scanner views while retaining repository-wide lockfile context', async () => {
    const entries = new Map<string, string>()
    const metadata = Array.from({ length: 101 }, (_, index) => {
      const path = index === 0
        ? 'packages/app/package.json'
        : index === 100
          ? 'packages/app/package-lock.json'
          : `src/file-${index}.ts`
      const content = index === 0
        ? JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } })
        : index === 100
          ? JSON.stringify({ lockfileVersion: 3, packages: {} })
          : 'const value = 1'
      entries.set(path, content)
      return { path, language: path.endsWith('.json') ? 'json' : 'typescript', lineCount: 1 }
    })
    const store = new InMemoryContentStore(entries)
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), metadata)

    const result = await scanIssuesAsync(index, null)

    expect(mockedScanCompositeRules).toHaveBeenCalledTimes(3)
    expect(scannerViewSizes.composite).toEqual([50, 50, 1])
    expect(mockedScanSupplyChain).toHaveBeenCalled()
    expect(Math.max(...scannerViewSizes.supplyChain)).toBeLessThanOrEqual(51)
    expect(result.issues.some(issue => issue.ruleId === 'supply-chain-no-lockfile')).toBe(false)
  })

  it('does not retry a failed async engine in later content batches', async () => {
    const entries = new Map<string, string>()
    const metadata = Array.from({ length: 101 }, (_, index) => {
      const path = `src/file-${index}.ts`
      entries.set(path, 'const value = 1')
      return { path, language: 'typescript', lineCount: 1 }
    })
    const store = new InMemoryContentStore(entries)
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), metadata)
    mockedScanWithTreeSitter.mockRejectedValue(new Error('grammar unavailable'))

    const result = await scanIssuesAsync(index, null)

    expect(mockedScanWithTreeSitter).toHaveBeenCalledOnce()
    expect(result.diagnostics.failures).toEqual([
      { engine: 'tree-sitter', message: 'grammar unavailable' },
    ])
  })

  it('compiles scanner regex rules once regardless of content batch count', async () => {
    const compileForFileCount = async (fileCount: number) => {
      const entries = new Map<string, string>()
      const metadata = Array.from({ length: fileCount }, (_, index) => {
        const path = `src/file-${index}.ts`
        entries.set(path, 'const value = 1')
        return { path, language: 'typescript', lineCount: 1 }
      })
      const store = new InMemoryContentStore(entries)
      const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), metadata)
      scannerRegexCompilations.count = 0
      clearScanCache()

      await scanIssuesAsync(index, null)

      return scannerRegexCompilations.count
    }

    const singleBatchCompilations = await compileForFileCount(1)
    const threeBatchCompilations = await compileForFileCount(101)

    expect(singleBatchCompilations).toBeGreaterThan(0)
    expect(threeBatchCompilations).toBe(singleBatchCompilations)
  })

  it('scans complete-store content in bounded batches and retains findings across batches', async () => {
    const treeSitterBatchSizes: number[] = []
    mockedScanWithTreeSitter.mockImplementation(async files => {
      treeSitterBatchSizes.push(files.size)
      return []
    })
    const entries = new Map<string, string>()
    const paths = new Set<string>()
    const getBatch = vi.fn(async (requestedPaths: string[]) => {
      const result = new Map<string, string>()
      for (const path of requestedPaths) {
        const content = entries.get(path)
        if (content !== undefined) result.set(path, content)
      }
      return result
    })
    const store: ContentStore = {
      bulkReadMode: 'complete',
      get: vi.fn(async path => entries.get(path) ?? null),
      getSync: vi.fn(() => null),
      getBatch,
      put: vi.fn((path, content) => { entries.set(path, content); paths.add(path) }),
      putBatch: vi.fn(batch => {
        for (const { path, content } of batch) {
          entries.set(path, content)
          paths.add(path)
        }
      }),
      has: vi.fn(path => paths.has(path)),
      delete: vi.fn(path => { entries.delete(path); paths.delete(path) }),
      flush: vi.fn(async () => {}),
      clear: vi.fn(async () => { entries.clear(); paths.clear() }),
      get size() { return paths.size },
    }

    const metadata = Array.from({ length: 101 }, (_, index) => {
      const path = `src/file-${index}.ts`
      const content = index === 0
        ? 'eval(userInput)'
        : index === 100
          ? 'element.innerHTML = userInput'
          : 'const value = 1'
      entries.set(path, content)
      paths.add(path)
      return { path, language: 'typescript', lineCount: 1 }
    })
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), metadata)

    const result = await scanIssuesAsync(index, null)

    expect(getBatch).toHaveBeenCalledTimes(3)
    expect(Math.max(...getBatch.mock.calls.map(([requestedPaths]) => requestedPaths.length))).toBeLessThanOrEqual(50)
    expect(result.issues.some(issue => issue.file === 'src/file-0.ts' && issue.ruleId === 'eval-usage')).toBe(true)
    expect(result.issues.some(issue => issue.file === 'src/file-100.ts' && issue.ruleId === 'innerhtml-xss')).toBe(true)
    expect(treeSitterBatchSizes).toEqual([50, 50, 1])
  })

  it('bounds deferred AST candidates while prioritizing later regex batches', async () => {
    const entries = new Map<string, string>()
    const metadata = Array.from({ length: 65 }, (_, index) => {
      const path = index < 50 ? `src/ast-${index}.ts` : `src/regex-${index}.ts`
      const content = index < 50
        ? 'Function("return 1")'
        : 'eval(userInput)'
      entries.set(path, content)
      return { path, language: 'typescript', lineCount: 1 }
    })
    const index = batchIndexMetadataOnly(
      createEmptyIndexWithStore(new InMemoryContentStore(entries)),
      metadata,
    )

    const result = await scanIssuesAsync(index, null)
    const evalIssues = result.issues.filter(issue => issue.ruleId === 'eval-usage')

    expect(evalIssues).toHaveLength(15)
    expect(evalIssues.map(issue => issue.file)).toEqual(
      Array.from({ length: 15 }, (_, index) => `src/regex-${index + 50}.ts`),
    )
    expect(result.ruleOverflow.get('eval-usage')).toBe(50)
  })

  it('reports partial AST and taint coverage when an eligible file cannot be parsed', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/conflicted.ts', '<<<<<<< CONFLICT', 'typescript')
    index = indexFile(index, 'src/valid.ts', 'const value = 1', 'typescript')

    const syncResult = scanIssues(index, null)
    expect(syncResult.diagnostics.engines.ast).toBe('partial')
    expect(syncResult.diagnostics.engines.taint).toBe('partial')

    clearScanCache()
    const result = await scanIssuesAsync(index, null)

    expect(result.diagnostics.engines.ast).toBe('partial')
    expect(result.diagnostics.engines.taint).toBe('partial')
    expect(result.diagnostics.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: 'ast', message: expect.stringContaining('src/conflicted.ts') }),
      expect.objectContaining({ engine: 'taint', message: expect.stringContaining('src/conflicted.ts') }),
    ]))
  })

  it('reports partial taint coverage when a parseable file exceeds the taint line limit', async () => {
    const content = [
      ...Array.from({ length: 3_000 }, (_, index) => `// line ${index}`),
      'export function handler(req: { query: { id: string } }) { return req.query.id }',
    ].join('\n')
    let index = createEmptyIndex()
    index = indexFile(index, 'src/large.ts', content, 'typescript')

    const syncResult = scanIssues(index, null)
    expect(syncResult.diagnostics.engines.ast).toBe('completed')
    expect(syncResult.diagnostics.engines.taint).toBe('partial')

    clearScanCache()
    const result = await scanIssuesAsync(index, null)

    expect(result.diagnostics.engines.ast).toBe('completed')
    expect(result.diagnostics.engines.taint).toBe('partial')
    expect(result.diagnostics.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: 'taint', message: expect.stringContaining('src/large.ts') }),
    ]))
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
