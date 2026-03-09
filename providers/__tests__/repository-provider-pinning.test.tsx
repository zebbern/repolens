import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import React from 'react'

// Mock external dependencies the provider imports
vi.mock('@/lib/github/fetcher', () => ({
  fetchRepoMetadata: vi.fn(),
  fetchRepoTree: vi.fn(),
  buildFileTree: vi.fn(),
  fetchFileContent: vi.fn(),
  detectLanguage: vi.fn(),
}))

vi.mock('@/lib/github/zipball', () => ({
  fetchRepoZipball: vi.fn(),
  streamUnzipFiles: vi.fn().mockResolvedValue({ count: 0, totalSize: 0 }),
  isFileIndexable: vi.fn(() => true),
}))

vi.mock('@/lib/cache/repo-cache', () => ({
  getCachedRepo: vi.fn().mockResolvedValue(null),
  setCachedRepo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/code/import-parser', () => ({
  analyzeCodebase: vi.fn(() => ({})),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

// Mock the GitHub token provider
vi.mock('@/providers/github-token-provider', () => ({
  useGitHubToken: vi.fn(() => ({ token: null })),
}))

import { RepositoryProvider, useRepository } from '../repository-provider'
import { batchIndexFiles, createEmptyIndex } from '@/lib/code/code-index'
import { PINNED_CONTEXT_CONFIG } from '@/config/constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(RepositoryProvider, null, children)
  }
}

/** Build a CodeIndex with the given files pre-populated. */
function buildIndex(files: Array<{ path: string; content: string }>) {
  return batchIndexFiles(
    createEmptyIndex(),
    files.map((f) => ({ ...f, language: 'typescript' })),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RepositoryProvider — Pin Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── pinFile ────────────────────────────────────────────────────────

  it('pinFile adds a file to pinnedFiles', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/app.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(1)
    expect(result.current.pinnedFiles.get('src/app.ts')).toEqual({
      path: 'src/app.ts',
      type: 'file',
    })
  })

  it('pinFile with directory type stores directory pin', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/lib', 'directory')
    })

    expect(result.current.pinnedFiles.get('src/lib')).toEqual({
      path: 'src/lib',
      type: 'directory',
    })
  })

  it('pinFile is a no-op for already-pinned paths', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/app.ts')
      result.current.pinFile('src/app.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(1)
  })

  it('pinFile respects MAX_PINNED_FILES limit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      for (let i = 0; i < PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES; i++) {
        result.current.pinFile(`file-${i}.ts`)
      }
    })

    expect(result.current.pinnedFiles.size).toBe(PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES)

    // Attempting to pin one more should be a no-op
    act(() => {
      result.current.pinFile('one-too-many.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(PINNED_CONTEXT_CONFIG.MAX_PINNED_FILES)
    expect(result.current.pinnedFiles.has('one-too-many.ts')).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Pin limit reached'),
    )

    warnSpy.mockRestore()
  })

  // ── unpinFile ──────────────────────────────────────────────────────

  it('unpinFile removes a pinned path', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/a.ts')
      result.current.pinFile('src/b.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(2)

    act(() => {
      result.current.unpinFile('src/a.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(1)
    expect(result.current.pinnedFiles.has('src/a.ts')).toBe(false)
    expect(result.current.pinnedFiles.has('src/b.ts')).toBe(true)
  })

  it('unpinFile is a no-op for unknown paths', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/a.ts')
    })

    act(() => {
      result.current.unpinFile('nonexistent.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(1)
  })

  // ── clearPins ──────────────────────────────────────────────────────

  it('clearPins empties all pinned files', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/a.ts')
      result.current.pinFile('src/b.ts')
      result.current.pinFile('src/c.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(3)

    act(() => {
      result.current.clearPins()
    })

    expect(result.current.pinnedFiles.size).toBe(0)
  })

  // ── isPinned ───────────────────────────────────────────────────────

  it('isPinned returns true for pinned paths and false for unpinned', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/pinned.ts')
    })

    expect(result.current.isPinned('src/pinned.ts')).toBe(true)
    expect(result.current.isPinned('src/not-pinned.ts')).toBe(false)
  })

  // ── getPinnedContents ──────────────────────────────────────────────

  it('getPinnedContents returns empty result when nothing is pinned', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const contents = await result.current.getPinnedContents()

    expect(contents).toEqual({
      content: '',
      fileCount: 0,
      totalBytes: 0,
      skipped: [],
    })
  })

  it('getPinnedContents assembles content for pinned files', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const index = buildIndex([
      { path: 'src/utils.ts', content: 'export const foo = 1' },
      { path: 'src/bar.ts', content: 'export const bar = 2' },
    ])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/utils.ts')
      result.current.pinFile('src/bar.ts')
    })

    const contents = await result.current.getPinnedContents()

    expect(contents.fileCount).toBe(2)
    expect(contents.totalBytes).toBeGreaterThan(0)
    expect(contents.content).toContain('src/utils.ts')
    expect(contents.content).toContain('export const foo = 1')
    expect(contents.content).toContain('src/bar.ts')
    expect(contents.content).toContain('export const bar = 2')
    expect(contents.skipped).toEqual([])
  })

  it('getPinnedContents skips files not found in codeIndex (stale pins)', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const index = buildIndex([{ path: 'src/exists.ts', content: 'hello' }])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/exists.ts')
      result.current.pinFile('src/deleted.ts') // Not in index
    })

    const contents = await result.current.getPinnedContents()

    expect(contents.fileCount).toBe(1)
    expect(contents.content).toContain('src/exists.ts')
    expect(contents.content).not.toContain('src/deleted.ts')
  })

  it('getPinnedContents skips files exceeding MAX_SINGLE_FILE_BYTES', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const largeContent = 'x'.repeat(PINNED_CONTEXT_CONFIG.MAX_SINGLE_FILE_BYTES + 1)
    const index = buildIndex([
      { path: 'src/big.ts', content: largeContent },
      { path: 'src/small.ts', content: 'small file' },
    ])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/big.ts')
      result.current.pinFile('src/small.ts')
    })

    const contents = await result.current.getPinnedContents()

    expect(contents.fileCount).toBe(1)
    expect(contents.content).toContain('src/small.ts')
    expect(contents.content).not.toContain('src/big.ts')
    expect(contents.skipped).toContain('src/big.ts')
  })

  it('getPinnedContents respects MAX_PINNED_BYTES total limit', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    // Each file is under MAX_SINGLE_FILE_BYTES (50KB) but together they exceed MAX_PINNED_BYTES (100KB)
    const fileA = 'x'.repeat(45_000)
    const fileB = 'y'.repeat(45_000)
    const fileC = 'z'.repeat(20_000) // this will push over the limit
    const index = buildIndex([
      { path: 'src/a.ts', content: fileA },
      { path: 'src/b.ts', content: fileB },
      { path: 'src/c.ts', content: fileC },
    ])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/a.ts')
      result.current.pinFile('src/b.ts')
      result.current.pinFile('src/c.ts')
    })

    const contents = await result.current.getPinnedContents()

    // a + b = 90K — fits under 100K budget
    // c would push to 110K — skipped
    expect(contents.fileCount).toBe(2)
    expect(contents.content).toContain('src/a.ts')
    expect(contents.content).toContain('src/b.ts')
    expect(contents.skipped).toContain('src/c.ts')
  })

  it('getPinnedContents resolves directory pins to all matching child files', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const index = buildIndex([
      { path: 'src/lib/a.ts', content: 'a content' },
      { path: 'src/lib/b.ts', content: 'b content' },
      { path: 'src/other/c.ts', content: 'c content' },
    ])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/lib', 'directory')
    })

    const contents = await result.current.getPinnedContents()

    expect(contents.fileCount).toBe(2)
    expect(contents.content).toContain('src/lib/a.ts')
    expect(contents.content).toContain('src/lib/b.ts')
    expect(contents.content).not.toContain('src/other/c.ts')
  })

  it('getPinnedContents deduplicates files pinned individually and via directory', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const index = buildIndex([
      { path: 'src/lib/a.ts', content: 'a content' },
      { path: 'src/lib/b.ts', content: 'b content' },
    ])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/lib/a.ts', 'file')
      result.current.pinFile('src/lib', 'directory')
    })

    const contents = await result.current.getPinnedContents()

    // a.ts should appear only once despite being pinned individually and via directory
    const occurrences = contents.content.split('src/lib/a.ts').length - 1
    expect(occurrences).toBe(1)
    expect(contents.fileCount).toBe(2) // a.ts + b.ts
  })

  it('getPinnedContents returns content in code fence format with file extension', async () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    const index = buildIndex([{ path: 'src/utils.ts', content: 'const x = 1' }])

    act(() => {
      result.current.updateCodeIndex(index)
      result.current.pinFile('src/utils.ts')
    })

    const contents = await result.current.getPinnedContents()

    expect(contents.content).toContain('### `src/utils.ts`')
    expect(contents.content).toContain('```ts')
    expect(contents.content).toContain('const x = 1')
    expect(contents.content).toContain('```')
  })

  // ── disconnectRepository clears pins ───────────────────────────────

  it('disconnectRepository clears all pinned files', () => {
    const { result } = renderHook(() => useRepository(), { wrapper: createWrapper() })

    act(() => {
      result.current.pinFile('src/a.ts')
      result.current.pinFile('src/b.ts')
    })

    expect(result.current.pinnedFiles.size).toBe(2)

    act(() => {
      result.current.disconnectRepository()
    })

    expect(result.current.pinnedFiles.size).toBe(0)
  })
})
