import { describe, expect, it, vi } from 'vitest'
import { buildStructuralIndexAsync } from '@/lib/ai/structural-index'
import {
  batchIndexMetadataOnly,
  createEmptyIndexWithStore,
  searchIndexAsync,
} from '../code-index'
import { LazyContentStore } from '../content-store'
import { FetchQueue } from '../fetch-queue'
import { scanIssuesAsync } from '../scanner/scanner'

function lazyIndex() {
  const fetchFile = vi.fn(async (path: string) => `export const fetched = '${path}'`)
  const store = new LazyContentStore('owner/repo', new FetchQueue({ fetchFn: fetchFile }))
  store.registerPaths(['src/a.ts', 'src/b.ts'])
  const index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), [
    { path: 'src/a.ts', language: 'typescript', lineCount: 1 },
    { path: 'src/b.ts', language: 'typescript', lineCount: 1 },
  ])
  return { fetchFile, index }
}

describe('bulk hydration of on-demand repositories', () => {
  it('structural indexing preserves available structure and reports missing content', async () => {
    const { fetchFile, index } = lazyIndex()
    const result = await buildStructuralIndexAsync(index)
    expect(result).toContain('[content-coverage]')
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('full search reports missing lazy files without bulk hydration', async () => {
    const { fetchFile, index } = lazyIndex()
    const result = await searchIndexAsync(index, 'fetched')
    expect(result.unsearchedPaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('full scanning reports unscanned files without bulk hydration', async () => {
    const { fetchFile, index } = lazyIndex()
    const result = await scanIssuesAsync(index, null)
    expect(result.unscannedFileCount).toBe(2)
    expect(fetchFile).not.toHaveBeenCalled()
  })
})
