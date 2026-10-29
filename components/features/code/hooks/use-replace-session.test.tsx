import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useReplace } from './use-replace'

describe('useReplace repository session isolation', () => {
  it('does not commit a replacement whose file read resolves after a repository switch', async () => {
    const a = { id: 1, signal: new AbortController().signal }
    let current: typeof a | null = a
    let resolve!: (content: string) => void
    const getFileContent = vi.fn(() => new Promise<string>(done => { resolve = done }))
    const updateCodeIndex = vi.fn()
    const setModifiedContents = vi.fn()
    const setOriginalContents = vi.fn()
    const setOpenTabs = vi.fn()

    const { result } = renderHook(() => useReplace({
      updateCodeIndex,
      setModifiedContents,
      originalContents: new Map(),
      setOriginalContents,
      getFileContent,
      debouncedSearchQuery: 'old',
      searchOptions: { caseSensitive: false, wholeWord: false, regex: false },
      replaceQuery: 'new',
      searchResults: [],
      setOpenTabs,
      repositorySession: a,
      isRepositorySessionCurrent: session => session === current,
    }))

    let pending!: Promise<void>
    act(() => { pending = result.current.replaceAllInFile('a.ts') })
    current = { id: 2, signal: new AbortController().signal }
    resolve('old value')
    await act(async () => pending)

    expect(updateCodeIndex).not.toHaveBeenCalled()
    expect(setModifiedContents).not.toHaveBeenCalled()
    expect(setOriginalContents).not.toHaveBeenCalled()
    expect(setOpenTabs).not.toHaveBeenCalled()
  })
})
