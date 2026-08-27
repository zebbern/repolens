import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsyncSearchResult, SearchResult } from '@/lib/code/code-index'

const { mockMainThreadSearch, mockSearchInWorker } = vi.hoisted(() => ({
  mockMainThreadSearch: vi.fn(),
  mockSearchInWorker: vi.fn(),
}))

vi.mock('@/lib/code/code-index', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/code/code-index')>()),
  searchIndexAsync: mockMainThreadSearch,
}))

vi.mock('@/lib/code/search-worker-client', () => ({
  searchInWorker: mockSearchInWorker,
}))

import { createAsyncSearchResult, createEmptyIndex } from '@/lib/code/code-index'
import { useSearch } from './use-search'

const SEARCH_OPTIONS = { caseSensitive: false, regex: false, wholeWord: false }
const MATCH = { line: 1, content: 'needle', column: 0, length: 6 }

function searchResult(
  results: SearchResult[],
  unsearchedPaths: string[] = [],
  truncated = false,
): AsyncSearchResult {
  return createAsyncSearchResult(results, unsearchedPaths, truncated, unsearchedPaths)
}

function hookProps(query: string) {
  return {
    codeIndex: createEmptyIndex(),
    isIndexingComplete: true,
    debouncedSearchQuery: query,
    searchOptions: SEARCH_OPTIONS,
    fileFilter: '',
    files: [],
    openFile: vi.fn(async () => undefined),
    sidebarMode: 'search' as const,
  }
}

describe('useSearch worker isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates content search to the worker and exposes partial-result metadata', async () => {
    mockSearchInWorker.mockResolvedValue(searchResult(
      [{ file: 'src/found.ts', matches: [MATCH] }],
      ['src/unavailable.ts'],
      true,
    ))
    const props = hookProps('needle')

    const { result } = renderHook(() => useSearch(props))

    await waitFor(() => expect(result.current.searchResults).toHaveLength(1))
    expect(mockSearchInWorker).toHaveBeenCalledWith(
      props.codeIndex,
      'needle',
      expect.objectContaining({ ...SEARCH_OPTIONS, signal: expect.any(AbortSignal) }),
    )
    expect(mockMainThreadSearch).not.toHaveBeenCalled()
    expect(result.current.unsearchedCount).toBe(1)
    expect(result.current.unavailableCount).toBe(1)
    expect(result.current.isSearchTruncated).toBe(true)
  })

  it('keeps file-filter worker options compact for a large repository', async () => {
    mockSearchInWorker.mockResolvedValue(searchResult([]))
    const props = hookProps('needle')
    props.fileFilter = '*.ts, src/*, config'
    for (let fileIndex = 0; fileIndex < 5_000; fileIndex++) {
      const path = `src/file-${fileIndex}.ts`
      props.codeIndex.files.set(path, {
        path,
        name: `file-${fileIndex}.ts`,
        content: 'needle',
        lineCount: 1,
      })
    }

    renderHook(() => useSearch(props))

    await waitFor(() => expect(mockSearchInWorker).toHaveBeenCalled())
    const workerOptions = mockSearchInWorker.mock.calls[0][2]
    expect(workerOptions.pathFilter).toEqual({
      includes: [
        { kind: 'suffix', value: '.ts' },
        { kind: 'prefix', value: 'src/' },
        { kind: 'contains', value: 'config' },
      ],
    })
    expect(workerOptions).not.toHaveProperty('allowedPaths')
    expect(JSON.stringify({ ...workerOptions, signal: undefined }).length).toBeLessThan(200)
  })

  it('does not label limit-skipped files as unavailable content', async () => {
    mockSearchInWorker.mockResolvedValue(createAsyncSearchResult(
      [{ file: 'src/found.ts', matches: [MATCH] }],
      ['src/skipped-by-limit.ts'],
      true,
      [],
    ))

    const { result } = renderHook(() => useSearch(hookProps('needle')))

    await waitFor(() => expect(result.current.searchResults).toHaveLength(1))
    expect(result.current.unsearchedCount).toBe(1)
    expect(result.current.unavailableCount).toBe(0)
    expect(result.current.isSearchTruncated).toBe(true)
  })

  it('reports worker failure separately from unavailable content', async () => {
    mockSearchInWorker.mockRejectedValue(new Error('worker startup failed'))
    const props = hookProps('needle')
    props.codeIndex = createEmptyIndex()
    props.codeIndex.files.set('src/resident.ts', {
      path: 'src/resident.ts',
      name: 'resident.ts',
      content: 'needle',
      lineCount: 1,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { result } = renderHook(() => useSearch(props))

    await waitFor(() => expect(result.current.searchError).toBe('worker startup failed'))
    expect(result.current.unsearchedCount).toBe(0)
    expect(result.current.unavailableCount).toBe(0)
    expect(result.current.isSearchTruncated).toBe(false)
    warn.mockRestore()
  })

  it('searches an unsafe regex as literal text and exposes a warning', async () => {
    mockSearchInWorker.mockResolvedValue(searchResult([
      { file: 'src/literal.ts', matches: [{ ...MATCH, content: '(a+)+$', length: 6 }] },
    ]))
    const props = hookProps('(a+)+$')
    props.searchOptions = { ...SEARCH_OPTIONS, regex: true }

    const { result } = renderHook(() => useSearch(props))

    await waitFor(() => expect(result.current.searchResults).toHaveLength(1))
    expect(mockSearchInWorker).toHaveBeenCalledWith(
      props.codeIndex,
      '(a+)+$',
      expect.objectContaining({ regex: false, signal: expect.any(AbortSignal) }),
    )
    expect(result.current.searchError).toBeNull()
    expect(result.current.searchWarning).toBe('Unsafe regular expression was searched as literal text.')
  })

  it('aborts a stale request and prevents its result from replacing the newer query', async () => {
    let resolveOld!: (result: AsyncSearchResult) => void
    let resolveNew!: (result: AsyncSearchResult) => void
    mockSearchInWorker
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve }))
    const initialProps = hookProps('old')
    const { result, rerender } = renderHook(
      ({ props }) => useSearch(props),
      { initialProps: { props: initialProps } },
    )
    const firstSignal = mockSearchInWorker.mock.calls[0][2].signal as AbortSignal

    const nextProps = { ...initialProps, debouncedSearchQuery: 'new' }
    rerender({ props: nextProps })

    expect(firstSignal.aborted).toBe(true)
    await act(async () => {
      resolveNew(searchResult([{ file: 'new.ts', matches: [MATCH] }]))
      await Promise.resolve()
    })
    await act(async () => {
      resolveOld(searchResult([{ file: 'old.ts', matches: [MATCH] }]))
      await Promise.resolve()
    })

    expect(result.current.searchResults.map(item => item.file)).toEqual(['new.ts'])
  })
})
