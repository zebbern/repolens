import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { batchIndexMetadataOnly, createEmptyIndex } from '@/lib/code/code-index'
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

  it('loads indexed content whenever resident source is absent even when availability is full', async () => {
    const session = { id: 1, signal: new AbortController().signal }
    const loadFileContent = vi.fn().mockResolvedValue('export const loaded = true')
    const index = batchIndexMetadataOnly(createEmptyIndex(), [
      { path: 'src/loaded.ts', language: 'typescript', lineCount: 1 },
    ])
    const file = { name: 'loaded.ts', path: 'src/loaded.ts', type: 'file' as const }
    const { result } = renderHook(() => useFileOperations({
      repo: { owner: 'acme', name: 'repo', defaultBranch: 'main' },
      files: [file],
      codeIndex: index,
      modifiedContents: new Map(),
      loadFileContent,
      contentAvailability: 'full',
      repositorySession: session,
      isRepositorySessionCurrent: candidate => candidate === session,
    }))

    await act(async () => Promise.resolve())
    await act(async () => result.current.openFile(file))

    expect(loadFileContent).toHaveBeenCalledWith('src/loaded.ts', session)
    expect(result.current.activeTab?.content).toBe('export const loaded = true')
  })
})
