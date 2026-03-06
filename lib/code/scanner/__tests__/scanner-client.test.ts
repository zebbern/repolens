import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { ScanResults } from '../types'
import type { CodeIndex } from '../../code-index'
import type { FullAnalysis } from '../../parser/types'
import {
  serializeCodeIndex,
  deserializeCodeIndex,
  serializeFullAnalysis,
} from '../serialization'

// In jsdom, `Worker` is undefined. scanner-client.ts falls back to a sync
// `require('./scanner')` call which can't resolve .ts files in Vitest's ESM mode.
// We therefore test the fallback logic structurally:
//   1. Confirm Worker is unavailable (jsdom)
//   2. Confirm serialization round-trip used by the worker path is correct
//   3. Test terminateScanWorker (no require involved)

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
