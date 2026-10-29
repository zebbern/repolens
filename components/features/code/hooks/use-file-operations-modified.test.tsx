import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { batchIndexFiles, createEmptyIndex } from '@/lib/code/code-index'
import { useFileOperations } from './use-file-operations'

describe('useFileOperations with edited files', () => {
  it('reopens an edited file as modified against its pre-edit source', async () => {
    const session = { id: 1, signal: new AbortController().signal }
    // A replace writes the edit into the index and records the pre-edit baseline.
    const index = batchIndexFiles(createEmptyIndex(), [{ path: 'a.ts', content: 'const new = 1', language: 'typescript' }])
    const file = { name: 'a.ts', path: 'a.ts', type: 'file' as const }
    const { result } = renderHook(() => useFileOperations({
      repo: { owner: 'acme', name: 'repo', defaultBranch: 'main' },
      files: [file],
      codeIndex: index,
      modifiedContents: new Map([['a.ts', 'const new = 1']]),
      originalContents: new Map([['a.ts', 'const old = 1']]),
      repositorySession: session,
      isRepositorySessionCurrent: candidate => candidate === session,
    }))

    await act(async () => Promise.resolve())
    await act(async () => result.current.openFile(file))

    expect(result.current.activeTab).toMatchObject({
      content: 'const new = 1',
      originalContent: 'const old = 1',
      isModified: true,
    })
  })
})
