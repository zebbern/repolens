import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock the provider hooks that useChangelogEngine depends on
// ---------------------------------------------------------------------------

const mockSetGeneratedChangelogs = vi.fn()
const mockSetActiveChangelogId = vi.fn()
const mockSetShowNewChangelog = vi.fn()
const mockSendMessage = vi.fn()
const mockSetMessages = vi.fn()
const mockStop = vi.fn()
const mockSetGenContext = vi.fn()

let mockStatus = 'ready'
let mockMessages: any[] = []
let mockIsGenerating = false
let mockError: Error | null = null
let mockGeneratedChangelogs: any[] = []
let mockActiveChangelogId: string | null = null

vi.mock('@/providers/changelog-provider', () => ({
  useChangelog: () => ({
    generatedChangelogs: mockGeneratedChangelogs,
    setGeneratedChangelogs: mockSetGeneratedChangelogs,
    activeChangelogId: mockActiveChangelogId,
    setActiveChangelogId: mockSetActiveChangelogId,
    setShowNewChangelog: mockSetShowNewChangelog,
  }),
  useChangelogChat: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    status: mockStatus,
    setMessages: mockSetMessages,
    stop: mockStop,
    error: mockError,
    isGenerating: mockIsGenerating,
    setGenContext: mockSetGenContext,
  }),
  CHANGELOG_PRESETS: [
    { id: 'conventional', label: 'Conventional Commits', description: 'Structured', icon: null, prompt: 'Generate Conventional Commits changelog.' },
    { id: 'release-notes', label: 'Release Notes', description: 'User-facing', icon: null, prompt: 'Generate user-facing release notes.' },
    { id: 'keep-a-changelog', label: 'Keep a Changelog', description: 'keepachangelog', icon: null, prompt: 'Generate Keep a Changelog.' },
    { id: 'custom', label: 'Custom Prompt', description: 'Custom', icon: null, prompt: '' },
  ],
  buildChangelogPrompt: vi.fn(
    (preset: { id: string; prompt: string }, fromRef: string, toRef: string, customPrompt: string) => {
      const rangeLabel = `Changes from \`${fromRef}\` to \`${toRef}\``
      if (preset.id === 'custom') return customPrompt ? `${rangeLabel}\n\n${customPrompt}` : rangeLabel
      return `${rangeLabel}\n\n${preset.prompt}`
    },
  ),
}))

import { useChangelogEngine } from './use-changelog-engine'

const conventionalPreset = { id: 'conventional' as const, label: 'Conventional Commits', description: '', icon: null, prompt: 'Generate Conventional Commits changelog.' }

describe('useChangelogEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockStatus = 'ready'
    mockMessages = []
    mockIsGenerating = false
    mockError = null
    mockGeneratedChangelogs = []
    mockActiveChangelogId = null
    mockSetGeneratedChangelogs.mockImplementation((updater: any) => {
      if (typeof updater === 'function') mockGeneratedChangelogs = updater(mockGeneratedChangelogs)
      else mockGeneratedChangelogs = updater
    })
  })

  afterEach(() => { vi.useRealTimers() })

  it('returns expected shape', () => {
    const { result } = renderHook(() => useChangelogEngine())
    expect(result.current).toHaveProperty('generatedChangelogs')
    expect(result.current).toHaveProperty('messages')
    expect(result.current).toHaveProperty('status')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('isGenerating')
    expect(result.current).toHaveProperty('stop')
    expect(result.current).toHaveProperty('handleGenerate')
    expect(result.current).toHaveProperty('handleRegenerate')
    expect(result.current).toHaveProperty('handleDeleteChangelog')
  })

  it('returns current status and messages from chat provider', () => {
    mockStatus = 'streaming'; mockMessages = [{ role: 'user', content: 'hello' }]; mockIsGenerating = true
    const { result } = renderHook(() => useChangelogEngine())
    expect(result.current.status).toBe('streaming')
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.isGenerating).toBe(true)
  })

  it('handleGenerate clears messages and schedules send', () => {
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(conventionalPreset, 'v1.0', 'v2.0', '') })
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockSetGenContext).toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) })
    expect(mockSendMessage).toHaveBeenCalledWith({ text: expect.any(String) })
  })

  it('handleGenerate sets gen context with correct parameters', () => {
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(conventionalPreset, 'v1.0', 'v2.0', '', 'commit abc123', 40, ['security-audit']) })
    expect(mockSetGenContext).toHaveBeenCalledWith(expect.objectContaining({
      changelogType: 'conventional', fromRef: 'v1.0', toRef: 'v2.0', commitData: 'commit abc123', maxSteps: 40,
    }))
  })

  it('handleGenerate is a no-op when isGenerating is true', () => {
    mockIsGenerating = true
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(conventionalPreset, 'v1.0', 'v2.0', '') })
    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  it('handleDeleteChangelog removes the changelog from state', () => {
    mockGeneratedChangelogs = [{ id: 'cl-1' }, { id: 'cl-2' }]
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleDeleteChangelog('cl-1') })
    expect(mockSetGeneratedChangelogs).toHaveBeenCalledWith(expect.any(Function))
  })

  it('handleDeleteChangelog resets active if deleted is active', () => {
    mockActiveChangelogId = 'cl-1'
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleDeleteChangelog('cl-1') })
    expect(mockSetActiveChangelogId).toHaveBeenCalledWith(null)
    expect(mockSetShowNewChangelog).toHaveBeenCalledWith(true)
  })

  it('handleDeleteChangelog does not reset active when deleting non-active', () => {
    mockActiveChangelogId = 'cl-2'
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleDeleteChangelog('cl-1') })
    expect(mockSetActiveChangelogId).not.toHaveBeenCalled()
    expect(mockSetShowNewChangelog).not.toHaveBeenCalled()
  })

  it('handleRegenerate dispatches generation with original context', () => {
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleRegenerate({ id: 'cl-42', type: 'conventional' as const, title: 'Test', messages: [], createdAt: new Date(), fromRef: 'v1.0', toRef: 'v2.0' }) })
    expect(mockSetShowNewChangelog).toHaveBeenCalledWith(true)
    expect(mockSetActiveChangelogId).toHaveBeenCalledWith(null)
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockSetGenContext).toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) })
    expect(mockSendMessage).toHaveBeenCalledWith({ text: expect.any(String) })
  })

  it('handleRegenerate does not fire when generating', () => {
    mockIsGenerating = true
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleRegenerate({ id: 'cl-42', type: 'conventional' as const, title: 'Test', messages: [], createdAt: new Date() }) })
    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  it('handleRegenerate is no-op for unknown preset type', () => {
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleRegenerate({ id: 'cl-42', type: 'nonexistent' as any, title: 'Unknown', messages: [], createdAt: new Date() }) })
    expect(mockSetMessages).not.toHaveBeenCalled()
  })

  it('handleRegenerate restores fromRef, toRef, customPrompt', () => {
    const { result } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleRegenerate({ id: 'cl-42', type: 'custom' as const, title: 'Custom', messages: [], createdAt: new Date(), fromRef: 'main', toRef: 'dev', customPrompt: 'List breaking changes' }) })
    expect(mockSetGenContext).toHaveBeenCalledWith(expect.objectContaining({ changelogType: 'custom', fromRef: 'main', toRef: 'dev', customPrompt: 'List breaking changes' }))
  })

  it('exposes stop function from chat provider', () => {
    const { result } = renderHook(() => useChangelogEngine())
    expect(result.current.stop).toBe(mockStop)
  })

  it('exposes error from chat provider', () => {
    mockError = new Error('test error')
    const { result } = renderHook(() => useChangelogEngine())
    expect(result.current.error).toEqual(new Error('test error'))
  })

  it('calls stop on unmount when streaming', () => {
    mockStatus = 'streaming'
    const { unmount } = renderHook(() => useChangelogEngine())
    unmount()
    expect(mockStop).toHaveBeenCalled()
  })

  it('calls stop on unmount when submitted', () => {
    mockStatus = 'submitted'
    const { unmount } = renderHook(() => useChangelogEngine())
    unmount()
    expect(mockStop).toHaveBeenCalled()
  })

  it('does not call stop on unmount when idle', () => {
    mockStatus = 'ready'
    const { unmount } = renderHook(() => useChangelogEngine())
    unmount()
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('clears pending send timer on unmount', () => {
    const { result, unmount } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(conventionalPreset, 'v1', 'v2', '') })
    expect(mockSendMessage).not.toHaveBeenCalled()
    unmount()
    act(() => { vi.advanceTimersByTime(200) })
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('saves changelog when status transitions from streaming to ready', () => {
    const { result, rerender } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(conventionalPreset, 'v1.0', 'v2.0', '') })
    act(() => { vi.advanceTimersByTime(100) })
    mockStatus = 'streaming'; mockMessages = [{ role: 'user', content: 'prompt', parts: [] }, { role: 'assistant', content: 'output', parts: [{ type: 'text', text: 'output' }] }]
    rerender()
    mockStatus = 'ready'; rerender()
    expect(mockSetGeneratedChangelogs).toHaveBeenCalledWith(expect.any(Function))
    const setterFn = mockSetGeneratedChangelogs.mock.calls.find((call: any) => typeof call[0] === 'function')?.[0]
    if (setterFn) {
      const saved = setterFn([])
      expect(saved[0]?.type).toBe('conventional')
      expect(saved[0]?.title).toContain('Conventional Commits')
    }
  })

  it('generates title with ref range for non-custom types', () => {
    const rnPreset = { id: 'release-notes' as const, label: 'Release Notes', description: '', icon: null, prompt: 'Generate release notes.' }
    const { result, rerender } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(rnPreset, 'v1.0', 'v2.0', '') })
    act(() => { vi.advanceTimersByTime(100) })
    mockStatus = 'streaming'; mockMessages = [{ role: 'user', content: 'p', parts: [] }, { role: 'assistant', content: 'n', parts: [{ type: 'text', text: 'n' }] }]; rerender()
    mockStatus = 'ready'; rerender()
    const setterFn = mockSetGeneratedChangelogs.mock.calls.find((call: any) => typeof call[0] === 'function')?.[0]
    if (setterFn) { const r = setterFn([]); expect(r[0]?.title).toContain('v1.0..v2.0') }
  })

  it('generates truncated title from custom prompt', () => {
    const customPreset = { id: 'custom' as const, label: 'Custom', description: '', icon: null, prompt: '' }
    const longPrompt = 'A'.repeat(60)
    const { result, rerender } = renderHook(() => useChangelogEngine())
    act(() => { result.current.handleGenerate(customPreset, 'v1', 'v2', longPrompt) })
    act(() => { vi.advanceTimersByTime(100) })
    mockStatus = 'streaming'; mockMessages = [{ role: 'user', content: 'p', parts: [] }, { role: 'assistant', content: 'o', parts: [{ type: 'text', text: 'o' }] }]; rerender()
    mockStatus = 'ready'; rerender()
    const setterFn = mockSetGeneratedChangelogs.mock.calls.find((call: any) => typeof call[0] === 'function')?.[0]
    if (setterFn) { const r = setterFn([]); expect(r[0]?.title).toHaveLength(53); expect(r[0]?.title).toMatch(/\.{3}$/) }
  })
})
