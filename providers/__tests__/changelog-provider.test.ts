import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks — same vi.mock order as docs-provider.test.ts
// ---------------------------------------------------------------------------

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    addToolOutput: vi.fn(),
    status: 'ready',
    setMessages: vi.fn(),
    stop: vi.fn(),
    error: null,
  })),
}))

vi.mock('ai', () => {
  class MockDefaultChatTransport {
    constructor() { /* no-op */ }
  }
  return {
    DefaultChatTransport: MockDefaultChatTransport,
    lastAssistantMessageIsCompleteWithToolCalls: vi.fn(),
  }
})

vi.mock('@/providers', () => ({
  useAPIKeys: () => ({
    selectedModel: { provider: 'openai', id: 'gpt-4o' },
    apiKeys: { openai: { key: 'test-key' } },
    getValidProviders: () => ['openai'],
  }),
  useRepository: () => ({
    repo: { fullName: 'owner/repo', description: 'A repo' },
    files: [{ path: 'index.ts' }],
    codeIndex: null,
  }),
  useRepositoryData: () => ({
    repo: { fullName: 'owner/repo', description: 'A repo' },
    files: [{ path: 'index.ts' }],
    codeIndex: null,
  }),
}))

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTreeString: vi.fn(() => 'mocked-tree'),
}))

vi.mock('@/lib/ai/structural-index', () => ({
  buildStructuralIndex: vi.fn(() => '{}'),
}))

vi.mock('@/lib/ai/providers', () => ({
  getMaxIndexBytesForModel: vi.fn(() => 50000),
}))

vi.mock('@/lib/ai/tool-call-handler', () => ({
  handleToolCall: vi.fn(),
}))

import {
  ChangelogProvider,
  useChangelog,
  useChangelogChat,
} from '@/providers/changelog-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ChangelogProvider, null, children)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangelogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children without crashing', () => {
    const { result } = renderHook(() => useChangelog(), { wrapper })
    expect(result.current).toBeDefined()
  })

  it('provides initial changelog state', () => {
    const { result } = renderHook(() => useChangelog(), { wrapper })

    expect(result.current.generatedChangelogs).toEqual([])
    expect(result.current.activeChangelogId).toBeNull()
    expect(result.current.showNewChangelog).toBe(true)
    expect(typeof result.current.setGeneratedChangelogs).toBe('function')
    expect(typeof result.current.setActiveChangelogId).toBe('function')
    expect(typeof result.current.setShowNewChangelog).toBe('function')
    expect(typeof result.current.clearChangelogs).toBe('function')
  })

  it('provides initial chat state', () => {
    const { result } = renderHook(() => useChangelogChat(), { wrapper })

    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeNull()
    expect(result.current.isGenerating).toBe(false)
    expect(typeof result.current.sendMessage).toBe('function')
    expect(typeof result.current.setMessages).toBe('function')
    expect(typeof result.current.stop).toBe('function')
    expect(typeof result.current.setGenContext).toBe('function')
  })
})

describe('useChangelog hook', () => {
  it('throws when used outside ChangelogProvider', () => {
    expect(() => {
      renderHook(() => useChangelog())
    }).toThrow('useChangelog must be used within a ChangelogProvider')
  })
})

describe('useChangelogChat hook', () => {
  it('throws when used outside ChangelogProvider', () => {
    expect(() => {
      renderHook(() => useChangelogChat())
    }).toThrow('useChangelogChat must be used within a ChangelogProvider')
  })
})
