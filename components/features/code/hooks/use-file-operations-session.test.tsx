import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyIndex } from '@/lib/code/code-index'
import { useFileOperations } from './use-file-operations'

describe('useFileOperations repository session isolation', () => {
  it('ignores a stale openFile callback first invoked after a repository switch', async () => {
    const sessionA = { id: 1, signal: new AbortController().signal }
    const sessionB = { id: 2, signal: new AbortController().signal }
    let current = sessionA
    const { result } = renderHook(() => useFileOperations({
      repo: { owner: 'acme', name: 'a', defaultBranch: 'main' },
      files: [],
      codeIndex: createEmptyIndex(),
      modifiedContents: new Map(),
      repositorySession: sessionA,
      isRepositorySessionCurrent: session => session === current,
    }))
    const staleOpen = result.current.openFile

    current = sessionB
    await act(async () => staleOpen({ name: 'a.ts', path: 'a.ts', type: 'file' }))

    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
  })
})
