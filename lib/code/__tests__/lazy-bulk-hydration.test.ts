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
  it('structural indexing fails visibly without fetching every lazy file', async () => {
    const { fetchFile, index } = lazyIndex()
    await expect(buildStructuralIndexAsync(index)).rejects.toThrow('Content unavailable')
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('full search fails visibly without fetching every lazy file', async () => {
    const { fetchFile, index } = lazyIndex()
    await expect(searchIndexAsync(index, 'fetched')).rejects.toThrow('Content unavailable')
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('full scanning fails visibly without fetching every lazy file', async () => {
    const { fetchFile, index } = lazyIndex()
    await expect(scanIssuesAsync(index, null)).rejects.toThrow('Content unavailable')
    expect(fetchFile).not.toHaveBeenCalled()
  })
})
