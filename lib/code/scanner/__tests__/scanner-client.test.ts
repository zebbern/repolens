import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  batchIndexFiles,
  batchIndexMetadataOnly,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
} from '@/lib/code/code-index'
import type { ScanResults } from '../types'
import type { CodeIndex } from '../../code-index'
import type { FullAnalysis } from '../../parser/types'
import {
  serializeCodeIndex,
  deserializeCodeIndex,
  serializeFullAnalysis,
} from '../serialization'
import type { ScanWorkerRequest, ScanWorkerResponse } from '../serialization'

const originalWorker = globalThis.Worker

afterEach(async () => {
  Object.defineProperty(globalThis, 'Worker', {
    value: originalWorker,
    writable: true,
    configurable: true,
  })
  vi.doUnmock('@/lib/parsers/tree-sitter')
  vi.resetModules()
})

// In jsdom, `Worker` is undefined, so scanner-client exercises its real
// async in-thread fallback.

describe('scanInWorker (jsdom environment)', () => {
  it('Worker is undefined in jsdom — confirming fallback branch is taken', () => {
    expect(typeof Worker).toBe('undefined')
  })

  it('serialization round-trip used by the worker path preserves CodeIndex', () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'const x = 1;', 'typescript')

    const serialized = serializeCodeIndex(index)
    const restored = deserializeCodeIndex(serialized)

    expect(restored.files.size).toBe(1)
    expect(restored.files.get('src/app.ts')?.content).toBe('const x = 1;')
  })

  it('scanInWorker module exports the expected function signatures', async () => {
    // Dynamic import to verify the module shape (even though the fallback
    // require call would fail at runtime in this test env)
    const mod = await import('../scanner-client')

    expect(typeof mod.scanInWorker).toBe('function')
    expect(typeof mod.terminateScanWorker).toBe('function')
  })

  it('hydrates metadata-only source before scanning in the no-worker fallback', async () => {
    const index = batchIndexFiles(
      createEmptyIndex(),
      [{ path: 'src/danger.ts', content: 'export const run = (input: string) => eval(input)', language: 'typescript' }],
      { retainContent: false },
    )
    const { scanInWorker } = await import('../scanner-client')

    const result = await scanInWorker(index, null)

    expect(result.issues.some(issue => issue.file === 'src/danger.ts' && issue.ruleId === 'eval-usage')).toBe(true)
    expect(result.unscannedFileCount).toBe(0)
  })

  it('includes a genuine Tree-sitter-only Python finding in the no-worker fallback', async () => {
    const node = {
      text: 'except:',
      startPosition: { row: 2, column: 0 },
      namedChildren: [],
    }
    vi.doMock('@/lib/parsers/tree-sitter', () => ({
      initTreeSitter: vi.fn().mockResolvedValue(undefined),
      getLanguageForFile: vi.fn((path: string) => path.endsWith('.py') ? 'python' : undefined),
      parseFile: vi.fn().mockResolvedValue({ delete: vi.fn() }),
      queryTree: vi.fn().mockResolvedValue([{
        captures: {
          clause: [node],
          fn: [node],
          _fn: [node],
          value: [node],
          pass: [node],
        },
      }]),
    }))
    vi.resetModules()
    let index = createEmptyIndex()
    index = indexFile(index, 'src/handler.py', 'try:\n    pass\nexcept:\n    pass\n', 'python')
    const { scanInWorker } = await import('../scanner-client')

    const result = await scanInWorker(index, null, { failureMode: 'strict' })

    expect(result.issues.some(issue => issue.ruleId === 'ts-bare-except-py')).toBe(true)
  })

  it('sends a per-request cancel and rejects with AbortError', async () => {
    class FakeWorker {
      static instance: FakeWorker
      readonly messages: ScanWorkerRequest[] = []
      onmessage: ((event: MessageEvent<ScanWorkerResponse>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      constructor() {
        FakeWorker.instance = this
      }

      postMessage(message: ScanWorkerRequest): void {
        this.messages.push(message)
      }

      terminate(): void {}

      emit(message: ScanWorkerResponse): void {
        this.onmessage?.(new MessageEvent('message', { data: message }))
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: FakeWorker,
      writable: true,
      configurable: true,
    })
    vi.resetModules()

    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.ts', 'eval(input)', 'typescript')
    const { scanInWorker } = await import('../scanner-client')
    const controller = new AbortController()
    const resultPromise = scanInWorker(index, null, { signal: controller.signal })
    const fakeWorker = FakeWorker.instance
    const scanRequest = fakeWorker.messages.find(message => message.type === 'scan')
    expect(scanRequest?.type).toBe('scan')
    if (!scanRequest || scanRequest.type !== 'scan') return

    controller.abort()
    let cancelAssertion: unknown
    try {
      await vi.waitFor(() => {
        expect(fakeWorker.messages).toContainEqual({ type: 'cancel', id: scanRequest.id })
      }, { timeout: 100 })
    } catch (error) {
      cancelAssertion = error
    }

    fakeWorker.emit({ type: 'error', id: scanRequest.id, name: 'AbortError', error: 'Scan aborted' })
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    if (cancelAssertion) throw cancelAssertion
  })

  it('transfers a session-local IDB rename overlay to the scanner worker', async () => {
    class FakeWorker {
      static instance: FakeWorker
      readonly messages: ScanWorkerRequest[] = []
      onmessage: ((event: MessageEvent<ScanWorkerResponse>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      constructor() {
        FakeWorker.instance = this
      }

      postMessage(message: ScanWorkerRequest): void {
        this.messages.push(message)
      }

      terminate(): void {}

      emit(message: ScanWorkerResponse): void {
        this.onmessage?.(new MessageEvent('message', { data: message }))
      }
    }

    Object.defineProperty(globalThis, 'Worker', {
      value: FakeWorker,
      writable: true,
      configurable: true,
    })
    vi.resetModules()
    const { scanInWorker } = await import('../scanner-client')
    const { IDBContentStore } = await import('@/lib/code/content-store')
    const store = new IDBContentStore('owner/repo@tree', undefined, { kind: 'disabled' })
    store.registerPaths(['src/original.ts'])
    store.applySessionOverlay({
      deletedPaths: ['src/original.ts'],
      entries: [{ path: 'src/renamed.ts', content: 'eval(userInput)' }],
    })
    const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
      { path: 'src/renamed.ts', language: 'typescript', lineCount: 1 },
    ])

    const pending = scanInWorker(index, null)
    const request = FakeWorker.instance.messages.find(
      (message): message is Extract<ScanWorkerRequest, { type: 'scan' }> => message.type === 'scan',
    )!

    expect(request).toMatchObject({
      storeKey: 'owner/repo@tree',
      contentOverlay: {
        deletedPaths: ['src/original.ts'],
        entries: [{ path: 'src/renamed.ts', content: 'eval(userInput)' }],
      },
    })

    FakeWorker.instance.emit({ type: 'error', id: request.id, error: 'test complete' })
    await expect(pending).rejects.toThrow('test complete')
  })
})

describe('terminateScanWorker', () => {
  it('does not throw when called with no active worker', async () => {
    const { terminateScanWorker } = await import('../scanner-client')

    // Should be safe to call even when no worker was ever created
    expect(() => terminateScanWorker()).not.toThrow()
  })

  it('can be called multiple times without error', async () => {
    const { terminateScanWorker } = await import('../scanner-client')

    expect(() => {
      terminateScanWorker()
      terminateScanWorker()
    }).not.toThrow()
  })
})
