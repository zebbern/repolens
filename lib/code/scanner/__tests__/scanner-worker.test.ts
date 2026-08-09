import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

// Mock the tree-sitter parser module before importing anything that pulls in the
// scanner. `tree-sitter-scanner.ts` imports it with this exact specifier, so the
// real `scanWithTreeSitter` still runs and the real rules still fire.
vi.mock('@/lib/parsers/tree-sitter', () => ({
  initTreeSitter: vi.fn(),
  getLanguageForFile: vi.fn(),
  parseFile: vi.fn(),
  queryTree: vi.fn(),
}))

// Side-effect import: registers the worker's `message` listener on `self`.
import '@/lib/code/scanner/scanner.worker'
import { batchIndexFiles, createEmptyIndex, createEmptyIndexWithStore, indexFile } from '@/lib/code/code-index'
import { IDBContentStore } from '@/lib/code/content-store'
import { serializeCodeIndex, serializeCodeIndexMeta } from '../serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from '../serialization'
import { initTreeSitter, getLanguageForFile, parseFile, queryTree } from '@/lib/parsers/tree-sitter'

const mockedInitTreeSitter = vi.mocked(initTreeSitter)
const mockedGetLanguageForFile = vi.mocked(getLanguageForFile)
const mockedParseFile = vi.mocked(parseFile)
const mockedQueryTree = vi.mocked(queryTree)

const PY_SOURCE = 'import os\nos.system(x)\n'

let originalPostMessage: PropertyDescriptor | undefined

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  globalThis.IDBKeyRange = IDBKeyRange
  // test/setup.ts runs vi.restoreAllMocks() after every test, so every
  // implementation has to be re-established here rather than in the factory.
  mockedInitTreeSitter.mockResolvedValue(undefined)
  mockedGetLanguageForFile.mockImplementation((path: string) =>
    path.endsWith('.py') ? 'python' : undefined
  )
  mockedParseFile.mockResolvedValue({ delete: vi.fn() } as unknown as import('web-tree-sitter').Tree)

  const node = {
    text: 'a + b',
    startPosition: { row: 1, column: 0 },
    namedChildren: [],
  } as unknown as import('web-tree-sitter').Node
  // Supplying every captureName the Python rules use makes all 9 fire on one match.
  mockedQueryTree.mockResolvedValue([
    {
      captures: {
        concat: [node],
        fn: [node],
        _fn: [node],
        value: [node],
        clause: [node],
        pass: [node],
      },
    },
  ] as unknown as Awaited<ReturnType<typeof queryTree>>)

  originalPostMessage = Object.getOwnPropertyDescriptor(globalThis, 'postMessage')
})

afterEach(() => {
  if (originalPostMessage) {
    Object.defineProperty(globalThis, 'postMessage', originalPostMessage)
  } else {
    delete (globalThis as { postMessage?: unknown }).postMessage
  }
})

/** Drive the worker's registered message handler and return its single response. */
async function runWorker(request: ScanWorkerRequest): Promise<ScanWorkerResponse> {
  const captured: ScanWorkerResponse[] = []
  // `postMessage` is inherited from Window.prototype in jsdom, so vi.spyOn on
  // globalThis does not intercept it — define an own property instead.
  Object.defineProperty(globalThis, 'postMessage', {
    value: (msg: ScanWorkerResponse) => {
      captured.push(msg)
    },
    writable: true,
    configurable: true,
  })

  self.dispatchEvent(new MessageEvent('message', { data: request }))
  await vi.waitFor(() => expect(captured.length).toBe(1))
  return captured[0]
}

function buildRequest(changedFiles?: string[]): ScanWorkerRequest {
  let index = createEmptyIndex()
  index = indexFile(index, 'src/messy.ts', 'console.log("debug")\n', 'typescript')
  index = indexFile(index, 'src/app.py', PY_SOURCE, 'python')
  // Matches SCANNER_EXCLUDE_PATTERNS (`__tests__/`) but NOT SKIP_VENDORED, so the
  // scanner's exclusion filter is the only thing that can drop it.
  index = indexFile(index, '__tests__/legacy_scan.py', PY_SOURCE, 'python')

  return {
    id: 1,
    codeIndex: serializeCodeIndex(index),
    analysis: null,
    ...(changedFiles ? { changedFiles } : {}),
  }
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

describe('scanner.worker', () => {
  it('returns a fully finalized ScanResults for a full scan', async () => {
    const res = await runWorker(buildRequest())
    expect(res.type).toBe('result')
    if (res.type !== 'result') return

    const issues = res.results.issues

    // Tree-sitter issues must be part of the graded pipeline, not appended after it.
    expect(issues.filter(i => i.ruleId.startsWith('ts-')).length).toBeGreaterThan(0)
    expect(issues.every(i => typeof i.riskScore === 'number')).toBe(true)

    // Severity sort invariant: ranks are non-decreasing across the whole array.
    const ranks = issues.map(i => SEVERITY_RANK[i.severity] ?? 99)
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1])
    }

    // Excluded paths must not leak in via the Tree-sitter pass.
    expect(issues.filter(i => i.file === '__tests__/legacy_scan.py')).toHaveLength(0)

    // Grades must reflect the Tree-sitter findings.
    expect(res.results.summary.critical).toBeGreaterThan(0)
    expect(res.results.securityGrade).not.toBe('A')
  })

  it('honours changedFiles and still excludes test-fixture paths', async () => {
    const res = await runWorker(buildRequest(['__tests__/legacy_scan.py']))
    expect(res.type).toBe('result')
    if (res.type !== 'result') return

    expect(res.results.isPartialScan).toBe(true)
    expect(
      res.results.issues.filter(i => i.file === '__tests__/legacy_scan.py')
    ).toHaveLength(0)
  })

  it('hydrates absent IDB source and counts a genuine empty file as scanned', async () => {
    const store = new IDBContentStore('owner/repo@tree')
    const index = batchIndexFiles(createEmptyIndexWithStore(store), [
      { path: 'src/danger.ts', content: 'eval(userInput)\n', language: 'typescript' },
      { path: 'src/empty.ts', content: '', language: 'typescript' },
    ], { retainContent: false })
    await store.flush()

    const response = await runWorker({
      id: 7,
      codeIndex: serializeCodeIndexMeta(index),
      analysis: null,
      storeKey: store.storeKey,
    })

    expect(response.type).toBe('result')
    if (response.type !== 'result') return
    expect(response.results.issues.some(issue => issue.ruleId === 'eval-usage')).toBe(true)
    expect(response.results.scannedFiles).toBe(2)
    expect(response.results.unscannedFileCount).toBe(0)
  })
})
