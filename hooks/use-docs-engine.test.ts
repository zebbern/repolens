import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

type MockRecord = Record<string, unknown>
type MockStateUpdate = MockRecord[] | ((previous: MockRecord[]) => MockRecord[])

// Mock the providers that useDocsEngine depends on
const mockSetGeneratedDocs = vi.fn()
const mockSetActiveDocId = vi.fn()
const mockSetShowNewDoc = vi.fn()
const mockSendMessage = vi.fn()
const mockSetMessages = vi.fn()
const mockStop = vi.fn()
const mockSetGenContext = vi.fn()

let mockStatus = 'ready'
let mockMessages: MockRecord[] = []
let mockIsGenerating = false
let mockError: Error | null = null
let mockGeneratedDocs: MockRecord[] = []
let mockActiveDocId: string | null = null

vi.mock('@/providers/docs-provider', () => ({
  useDocs: () => ({
    generatedDocs: mockGeneratedDocs,
    setGeneratedDocs: mockSetGeneratedDocs,
    activeDocId: mockActiveDocId,
    setActiveDocId: mockSetActiveDocId,
    setShowNewDoc: mockSetShowNewDoc,
  }),
  useDocsChat: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    status: mockStatus,
    setMessages: mockSetMessages,
    stop: mockStop,
    error: mockError,
    isGenerating: mockIsGenerating,
    setGenContext: mockSetGenContext,
  }),
  DOC_PRESETS: [
    {
      id: 'architecture',
      label: 'Architecture Overview',
      description: 'Architecture description',
      icon: null,
      prompt: 'Generate architecture overview',
    },
    {
      id: 'setup',
      label: 'Setup / Getting Started',
      description: 'Setup description',
      icon: null,
      prompt: 'Generate setup guide',
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Custom doc',
      icon: null,
      prompt: '',
    },
    {
      id: 'file-explanation',
      label: 'File Explanation',
      description: 'Explain a file',
      icon: null,
      prompt: 'Explain this file',
    },
  ],
  buildDocPrompt: vi.fn(
    (preset: { prompt: string }, targetFile: string | null, customPrompt: string) =>
      `${preset.prompt} ${targetFile ?? ''} ${customPrompt}`.trim()
  ),
}))

import { useDocsEngine } from './use-docs-engine'

describe('useDocsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockStatus = 'ready'
    mockMessages = []
    mockIsGenerating = false
    mockError = null
    mockGeneratedDocs = []
    mockActiveDocId = null

    // Make setGeneratedDocs work like a real state setter
    mockSetGeneratedDocs.mockImplementation((updater: MockStateUpdate) => {
      if (typeof updater === 'function') {
        mockGeneratedDocs = updater(mockGeneratedDocs)
      } else {
        mockGeneratedDocs = updater
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns expected shape', () => {
    const { result } = renderHook(() => useDocsEngine())

    expect(result.current).toHaveProperty('generatedDocs')
    expect(result.current).toHaveProperty('messages')
    expect(result.current).toHaveProperty('status')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('isGenerating')
    expect(result.current).toHaveProperty('stop')
    expect(result.current).toHaveProperty('handleGenerate')
    expect(result.current).toHaveProperty('handleRegenerate')
    expect(result.current).toHaveProperty('handleDeleteDoc')
  })

  it('returns current status and messages from chat provider', () => {
    mockStatus = 'streaming'
    mockMessages = [{ role: 'user', content: 'hello' }]
    mockIsGenerating = true

    const { result } = renderHook(() => useDocsEngine())

    expect(result.current.status).toBe('streaming')
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.isGenerating).toBe(true)
  })

  it('handleGenerate clears messages and schedules send', () => {
    const { result } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'architecture' as const,
      label: 'Architecture Overview',
      description: '',
      icon: null,
      prompt: 'Generate architecture overview',
    }

    act(() => {
      result.current.handleGenerate(preset, null, '', undefined, [])
    })

    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockSetGenContext).toHaveBeenCalled()

    // Advance timer to trigger the deferred send
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockSendMessage).toHaveBeenCalledWith({
      text: expect.any(String),
    })
  })

  it('handleGenerate does not fire when already generating', () => {
    mockIsGenerating = true
    const { result } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'architecture' as const,
      label: 'Architecture Overview',
      description: '',
      icon: null,
      prompt: 'Generate architecture overview',
    }

    act(() => {
      result.current.handleGenerate(preset, null, '', undefined, [])
    })

    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  it('handleDeleteDoc removes a doc from the list', () => {
    mockGeneratedDocs = [
      { id: 'doc-1', type: 'architecture', title: 'Test Doc' },
      { id: 'doc-2', type: 'setup', title: 'Setup Doc' },
    ]

    const { result } = renderHook(() => useDocsEngine())

    act(() => {
      result.current.handleDeleteDoc('doc-1')
    })

    expect(mockSetGeneratedDocs).toHaveBeenCalledWith(expect.any(Function))
  })

  it('handleDeleteDoc sets activeDocId to null and shows new doc form when deleting active doc', () => {
    mockActiveDocId = 'doc-1'

    const { result } = renderHook(() => useDocsEngine())

    act(() => {
      result.current.handleDeleteDoc('doc-1')
    })

    expect(mockSetActiveDocId).toHaveBeenCalledWith(null)
    expect(mockSetShowNewDoc).toHaveBeenCalledWith(true)
  })

  it('handleDeleteDoc does not reset activeDocId when deleting non-active doc', () => {
    mockActiveDocId = 'doc-2'

    const { result } = renderHook(() => useDocsEngine())

    act(() => {
      result.current.handleDeleteDoc('doc-1')
    })

    expect(mockSetActiveDocId).not.toHaveBeenCalled()
    expect(mockSetShowNewDoc).not.toHaveBeenCalled()
  })

  it('exposes stop function from chat provider', () => {
    const { result } = renderHook(() => useDocsEngine())
    expect(result.current.stop).toBe(mockStop)
  })

  it('exposes error from chat provider', () => {
    mockError = new Error('test error')
    const { result } = renderHook(() => useDocsEngine())
    expect(result.current.error).toEqual(new Error('test error'))
  })

  // ---------------------------------------------------------------------------
  // Return type conformance (DocsEngineReturn)
  // ---------------------------------------------------------------------------

  it('return value satisfies DocsEngineReturn interface', () => {
    const { result } = renderHook(() => useDocsEngine())
    const engine = result.current

    // State fields
    expect(Array.isArray(engine.generatedDocs)).toBe(true)
    expect(Array.isArray(engine.messages)).toBe(true)
    expect(typeof engine.status).toBe('string')
    expect(typeof engine.isGenerating).toBe('boolean')

    // Action methods
    expect(typeof engine.stop).toBe('function')
    expect(typeof engine.handleGenerate).toBe('function')
    expect(typeof engine.handleRegenerate).toBe('function')
    expect(typeof engine.handleDeleteDoc).toBe('function')
  })

  // ---------------------------------------------------------------------------
  // Abort-on-unmount
  // ---------------------------------------------------------------------------

  it('calls stop on unmount when generation is streaming', () => {
    mockStatus = 'streaming'
    const { unmount } = renderHook(() => useDocsEngine())

    unmount()

    expect(mockStop).toHaveBeenCalled()
  })

  it('calls stop on unmount when status is submitted', () => {
    mockStatus = 'submitted'
    const { unmount } = renderHook(() => useDocsEngine())

    unmount()

    expect(mockStop).toHaveBeenCalled()
  })

  it('does not call stop on unmount when idle', () => {
    mockStatus = 'ready'
    const { unmount } = renderHook(() => useDocsEngine())

    unmount()

    expect(mockStop).not.toHaveBeenCalled()
  })

  it('clears pending send timer on unmount', () => {
    const { result, unmount } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'architecture' as const,
      label: 'Architecture Overview',
      description: '',
      icon: null,
      prompt: 'Generate architecture overview',
    }

    // Start generation (schedules a timer) but do NOT advance timers
    act(() => {
      result.current.handleGenerate(preset, null, '', undefined, [])
    })

    expect(mockSendMessage).not.toHaveBeenCalled()

    // Unmount before the timer fires
    unmount()

    // Advance timers — send should NOT happen because the timer was cleared
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // handleRegenerate
  // ---------------------------------------------------------------------------

  it('handleRegenerate dispatches generation with the original doc context', () => {
    const { result } = renderHook(() => useDocsEngine())

    const doc = {
      id: 'doc-42',
      type: 'architecture' as const,
      title: 'Architecture Overview',
      messages: [],
      createdAt: new Date(),
      targetFile: undefined,
      customPrompt: undefined,
    }

    act(() => {
      result.current.handleRegenerate(doc)
    })

    // Should switch to new-doc form and clear active doc
    expect(mockSetShowNewDoc).toHaveBeenCalledWith(true)
    expect(mockSetActiveDocId).toHaveBeenCalledWith(null)

    // Should clear messages and set gen context
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockSetGenContext).toHaveBeenCalled()

    // Advance timer to trigger the deferred send
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockSendMessage).toHaveBeenCalledWith({
      text: expect.any(String),
    })
  })

  it('handleRegenerate does not fire when already generating', () => {
    mockIsGenerating = true
    const { result } = renderHook(() => useDocsEngine())

    const doc = {
      id: 'doc-42',
      type: 'architecture' as const,
      title: 'Architecture Overview',
      messages: [],
      createdAt: new Date(),
    }

    act(() => {
      result.current.handleRegenerate(doc)
    })

    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  it('handleRegenerate is a no-op for unknown preset type', () => {
    const { result } = renderHook(() => useDocsEngine())

    const doc = {
      id: 'doc-42',
      type: 'nonexistent-type' as never,
      title: 'Unknown',
      messages: [],
      createdAt: new Date(),
    }

    act(() => {
      result.current.handleRegenerate(doc)
    })

    expect(mockSetMessages).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('handleRegenerate restores targetFile and customPrompt from the doc', () => {
    const { result } = renderHook(() => useDocsEngine())

    const doc = {
      id: 'doc-42',
      type: 'file-explanation' as const,
      title: 'utils.ts Explained',
      messages: [],
      createdAt: new Date(),
      targetFile: 'src/utils.ts',
      customPrompt: undefined,
    }

    act(() => {
      result.current.handleRegenerate(doc)
    })

    // setGenContext should be called with the restored context
    expect(mockSetGenContext).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: 'file-explanation',
        targetFile: 'src/utils.ts',
      }),
    )
  })

  // ---------------------------------------------------------------------------
  // buildDocTitle (tested via doc-save integration)
  // ---------------------------------------------------------------------------

  it('generates title from preset label for standard doc types', () => {
    const { result, rerender } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'architecture' as const,
      label: 'Architecture Overview',
      description: '',
      icon: null,
      prompt: 'Generate architecture overview',
    }

    act(() => {
      result.current.handleGenerate(preset, null, '', undefined, [])
    })

    // Advance timer to fire the send
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Simulate streaming → ready transition to trigger doc save
    mockStatus = 'streaming'
    mockMessages = [
      { role: 'user', content: 'prompt', parts: [] },
      { role: 'assistant', content: 'response', parts: [{ type: 'text', text: 'response' }] },
    ]
    rerender()

    mockStatus = 'ready'
    rerender()

    // The saved doc should use the preset label as title
    expect(mockSetGeneratedDocs).toHaveBeenCalledWith(expect.any(Function))
    const setterFn = mockSetGeneratedDocs.mock.calls.find(
      call => typeof call[0] === 'function',
    )?.[0]
    if (setterFn) {
      const result = setterFn([])
      expect(result[0]?.title).toBe('Architecture Overview')
    }
  })

  it('generates title from filename for file-explanation docs', () => {
    const { result, rerender } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'file-explanation' as const,
      label: 'Explain a File',
      description: '',
      icon: null,
      prompt: '',
    }

    act(() => {
      result.current.handleGenerate(preset, 'src/utils/helpers.ts', '', undefined, [])
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    mockStatus = 'streaming'
    mockMessages = [
      { role: 'user', content: 'prompt', parts: [] },
      { role: 'assistant', content: 'response', parts: [{ type: 'text', text: 'response' }] },
    ]
    rerender()

    mockStatus = 'ready'
    rerender()

    expect(mockSetGeneratedDocs).toHaveBeenCalledWith(expect.any(Function))
    const setterFn = mockSetGeneratedDocs.mock.calls.find(
      call => typeof call[0] === 'function',
    )?.[0]
    if (setterFn) {
      const result = setterFn([])
      expect(result[0]?.title).toBe('helpers.ts Explained')
    }
  })

  it('generates truncated title from custom prompt', () => {
    const { result, rerender } = renderHook(() => useDocsEngine())

    const preset = {
      id: 'custom' as const,
      label: 'Custom',
      description: '',
      icon: null,
      prompt: '',
    }

    const longPrompt = 'A'.repeat(60)

    act(() => {
      result.current.handleGenerate(preset, null, longPrompt, undefined, [])
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    mockStatus = 'streaming'
    mockMessages = [
      { role: 'user', content: 'prompt', parts: [] },
      { role: 'assistant', content: 'response', parts: [{ type: 'text', text: 'response' }] },
    ]
    rerender()

    mockStatus = 'ready'
    rerender()

    expect(mockSetGeneratedDocs).toHaveBeenCalledWith(expect.any(Function))
    const setterFn = mockSetGeneratedDocs.mock.calls.find(
      call => typeof call[0] === 'function',
    )?.[0]
    if (setterFn) {
      const result = setterFn([])
      expect(result[0]?.title).toHaveLength(53) // 50 chars + '...'
      expect(result[0]?.title).toMatch(/\.{3}$/)
    }
  })
})
