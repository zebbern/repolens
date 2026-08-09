import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { zipSync } from 'fflate'
import { createEmptyIndex } from '@/lib/code/code-index'
import { useDownloads } from '../use-downloads'

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>()
  return { ...actual, zipSync: vi.fn(actual.zipSync) }
})

describe('useDownloads genuine empty modified files', () => {
  const createdBlobs: Blob[] = []
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let originalClick: typeof HTMLAnchorElement.prototype.click

  beforeEach(() => {
    createdBlobs.length = 0
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    originalClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob)
      return `blob:download-${createdBlobs.length}`
    })
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    HTMLAnchorElement.prototype.click = originalClick
  })

  function renderDownloads() {
    return renderHook(() => useDownloads({
      modifiedContents: new Map([['src/empty.ts', '']]),
      openTabs: [],
      codeIndex: createEmptyIndex(),
      files: [],
      getFileContent: async () => null,
      repo: null,
    }))
  }

  it('downloads a single modified file whose content is genuinely empty', () => {
    const { result } = renderDownloads()

    act(() => result.current.downloadFile(result.current.modifiedTabs[0]))

    expect(createdBlobs).toHaveLength(1)
    expect(createdBlobs[0].size).toBe(0)
  })

  it('includes a genuinely empty modified file in the changes ZIP', async () => {
    const { result } = renderDownloads()

    await act(async () => result.current.downloadAllModified())
    const archive = vi.mocked(zipSync).mock.calls[0][0] as Record<string, Uint8Array>

    expect(Object.keys(archive)).toContain('src/empty.ts')
    expect(archive['src/empty.ts']).toHaveLength(0)
  })
})
