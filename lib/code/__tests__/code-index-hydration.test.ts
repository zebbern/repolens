import { describe, expect, it, vi } from 'vitest'
import {
  batchIndexMetadataOnly,
  createEmptyIndexWithStore,
  hydrateCodeIndexContent,
  InMemoryContentStore,
  resolveFileContentBatches,
} from '../code-index'

describe('bounded code-index content hydration', () => {
  it('never requests every stored file in one getBatch call', async () => {
    const entries = new Map(Array.from({ length: 125 }, (_, index) => [
      `src/f${index}.ts`,
      `export const value${index} = ${index}`,
    ]))
    const store = new InMemoryContentStore(entries)
    const getBatch = vi.spyOn(store, 'getBatch')
    const index = batchIndexMetadataOnly(
      createEmptyIndexWithStore(store),
      Array.from(entries.keys(), path => ({ path, language: 'typescript', lineCount: 1 })),
    )

    const hydrated = await hydrateCodeIndexContent(index)

    expect(hydrated.missingPaths).toEqual([])
    expect(hydrated.index.files.get('src/f124.ts')?.content).toBe('export const value124 = 124')
    expect(getBatch.mock.calls.length).toBeGreaterThan(1)
    expect(Math.max(...getBatch.mock.calls.map(([paths]) => paths.length))).toBeLessThanOrEqual(50)
  })

  it('lets consumers process bounded batches without building a hydrated index', async () => {
    const entries = new Map(Array.from({ length: 45 }, (_, index) => [
      `src/f${index}.ts`,
      `value ${index}`,
    ]))
    const store = new InMemoryContentStore(entries)
    const index = batchIndexMetadataOnly(
      createEmptyIndexWithStore(store),
      Array.from(entries.keys(), path => ({ path, lineCount: 1 })),
    )
    const batchSizes: number[] = []
    let resolvedFiles = 0

    for await (const batch of resolveFileContentBatches(index, Array.from(entries.keys()), { batchSize: 20 })) {
      batchSizes.push(batch.paths.length)
      resolvedFiles += batch.contents.size
    }

    expect(batchSizes).toEqual([20, 20, 5])
    expect(resolvedFiles).toBe(45)
    expect(Array.from(index.files.values()).every(file => file.content === undefined)).toBe(true)
  })
})
