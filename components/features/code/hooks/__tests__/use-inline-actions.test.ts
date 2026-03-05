import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { CodeIndex, SearchResult } from '@/lib/code/code-index'
import type { ExtractedSymbol } from '../use-symbol-extraction'
import type { SymbolRange, InlineActionType } from '../../types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSearchIndex = vi.fn<(...args: unknown[]) => SearchResult[]>()

vi.mock('@/lib/code/code-index', () => ({
  searchIndex: (...args: unknown[]) => mockSearchIndex(...args),
}))

import { useInlineActions } from '../use-inline-actions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCodeIndex(): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
    isIndexing: false,
  }
}

function makeSymbol(
  overrides: Partial<ExtractedSymbol> & Pick<ExtractedSymbol, 'name' | 'line'>,
): ExtractedSymbol {
  return { kind: 'function', isExported: true, ...overrides }
}

function makeSymbolRange(overrides: Partial<SymbolRange> = {}): SymbolRange {
  return {
    symbol: makeSymbol({ name: 'testFunc', line: 1 }),
    startLine: 1,
    endLine: 10,
    ...overrides,
  }
}

const ARGS = {
  fileContent: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
  filePath: 'src/example.ts',
  language: 'typescript',
  apiKey: 'sk-test-123',
  provider: 'openai',
  model: 'gpt-4o',
}

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

function mockFetchOk(chunks: string[]) {
  return vi.fn().mockResolvedValue({ ok: true, body: createMockStream(chunks) })
}

function mockFetchError(status: number, errorBody?: object) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(errorBody ?? null),
  })
}

function trigger(
  hookResult: ReturnType<typeof useInlineActions>,
  action: InlineActionType,
  overrides: Partial<typeof ARGS & { symbolRange: SymbolRange }> = {},
) {
  const a = { ...ARGS, ...overrides }
  hookResult.triggerAction(
    action,
    overrides.symbolRange ?? makeSymbolRange(),
    a.fileContent,
    a.filePath,
    a.language,
    a.apiKey,
    a.provider,
    a.model,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useInlineActions', () => {
  let codeIndex: CodeIndex

  beforeEach(() => {
    vi.clearAllMocks()
    codeIndex = createMockCodeIndex()
    mockSearchIndex.mockReturnValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- Initial state ---

  it('has correct initial state', () => {
    const { result } = renderHook(() => useInlineActions(codeIndex))
    expect(result.current.activeSymbol).toBeNull()
    expect(result.current.activeAction).toBeNull()
    expect(result.current.result).toBeNull()
    expect(result.current.isStreaming).toBe(false)
  })

  // --- find-usages ---

  it('find-usages searches index without calling fetch', () => {
    const searchResults: SearchResult[] = [{
      file: 'src/other.ts',
      language: 'typescript',
      matches: [{ line: 5, content: 'import { testFunc }', column: 10, length: 8 }],
    }]
    mockSearchIndex.mockReturnValue(searchResults)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { result } = renderHook(() => useInlineActions(codeIndex))
    act(() => { trigger(result.current, 'find-usages') })

    expect(mockSearchIndex).toHaveBeenCalledWith(codeIndex, 'testFunc')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.result?.type).toBe('find-usages')
    expect(result.current.result?.content).toContain('src/other.ts')
    expect(result.current.isStreaming).toBe(false)
    fetchSpy.mockRestore()
  })

  it('find-usages with no results shows "No usages" message', () => {
    mockSearchIndex.mockReturnValue([])
    const { result } = renderHook(() => useInlineActions(codeIndex))
    act(() => { trigger(result.current, 'find-usages') })
    expect(result.current.result?.content).toContain('No usages')
  })

  // --- AI actions ---

  it.each(['explain', 'refactor', 'complexity'] as const)(
    '"%s" calls fetch to /api/inline-actions',
    async (action) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetchOk(['Hi']))
      const { result } = renderHook(() => useInlineActions(codeIndex))

      act(() => { trigger(result.current, action) })
      expect(result.current.isStreaming).toBe(true)
      expect(result.current.activeAction).toBe(action)

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/inline-actions')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body as string)
      expect(body.action).toBe(action)
      expect(body.symbolName).toBe('testFunc')
      expect(body.provider).toBe('openai')
      fetchSpy.mockRestore()
    },
  )

  it('sends correct symbol code extracted from file content', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetchOk([]))
    const fileContent = 'a\nb\nfunction foo() {\n  return 42\n}\nz'
    const { result } = renderHook(() => useInlineActions(codeIndex))
    act(() => {
      trigger(result.current, 'explain', {
        fileContent,
        symbolRange: makeSymbolRange({ startLine: 3, endLine: 5 }),
      })
    })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.symbolCode).toBe('function foo() {\n  return 42\n}')
    fetchSpy.mockRestore()
  })

  // --- dismissAction ---

  it('dismissAction clears result and active state', () => {
    const { result } = renderHook(() => useInlineActions(codeIndex))
    act(() => { trigger(result.current, 'find-usages') })
    expect(result.current.result).not.toBeNull()

    act(() => { result.current.dismissAction() })
    expect(result.current.result).toBeNull()
    expect(result.current.activeSymbol).toBeNull()
    expect(result.current.activeAction).toBeNull()
  })

  // --- abort previous on new trigger ---

  it('aborts previous fetch when a new AI action is triggered', () => {
    const abortSpy = vi.fn()
    const Orig = globalThis.AbortController
    globalThis.AbortController = class extends Orig {
      abort(...a: Parameters<AbortController['abort']>) { abortSpy(); return super.abort(...a) }
    } as typeof AbortController

    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetchOk(['slow']))
    const { result } = renderHook(() => useInlineActions(codeIndex))

    act(() => { trigger(result.current, 'explain') })
    act(() => { trigger(result.current, 'refactor') })
    expect(abortSpy).toHaveBeenCalled()

    globalThis.AbortController = Orig
    vi.restoreAllMocks()
  })

  // --- error handling ---

  it('sets error on result when fetch returns non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchError(500, { error: { message: 'Server error' } }),
    )
    const { result } = renderHook(() => useInlineActions(codeIndex))

    await act(async () => {
      trigger(result.current, 'explain')
      await vi.waitFor(() => expect(result.current.isStreaming).toBe(false))
    })
    expect(result.current.result?.error).toBe('Server error')
    vi.restoreAllMocks()
  })

  it('handles network failure gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useInlineActions(codeIndex))

    await act(async () => {
      trigger(result.current, 'explain')
      await vi.waitFor(() => expect(result.current.isStreaming).toBe(false))
    })
    expect(result.current.result?.error).toBe('Failed to fetch')
    vi.restoreAllMocks()
  })

  it('abort error is not treated as a real error', async () => {
    // Create an error that matches the `error.name === 'AbortError'` check
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError)
    const { result } = renderHook(() => useInlineActions(codeIndex))

    await act(async () => {
      trigger(result.current, 'explain')
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current.result?.error).toBeUndefined()
    vi.restoreAllMocks()
  })

  // --- streaming accumulation ---

  it('accumulates streamed chunks in result.content', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetchOk(['Hello ', 'World', '!']))
    const { result } = renderHook(() => useInlineActions(codeIndex))

    await act(async () => {
      trigger(result.current, 'explain')
      await vi.waitFor(() => expect(result.current.isStreaming).toBe(false))
    })
    expect(result.current.result?.content).toBe('Hello World!')
    vi.restoreAllMocks()
  })

  // --- unmount cleanup ---

  it('aborts in-flight fetch on unmount', () => {
    const abortSpy = vi.fn()
    const Orig = globalThis.AbortController
    globalThis.AbortController = class extends Orig {
      abort(...a: Parameters<AbortController['abort']>) { abortSpy(); return super.abort(...a) }
    } as typeof AbortController

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const { result, unmount } = renderHook(() => useInlineActions(codeIndex))

    act(() => { trigger(result.current, 'explain') })
    unmount()
    expect(abortSpy).toHaveBeenCalled()

    globalThis.AbortController = Orig
    vi.restoreAllMocks()
  })
})
