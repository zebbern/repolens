import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileUIPart, UIMessage } from 'ai'

const harness = vi.hoisted(() => ({
  repository: {
    current: {
      repo: { owner: 'acme', name: 'a', fullName: 'acme/a', description: 'Repository A' },
      files: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      codeIndex: { files: new Map() },
      repositorySession: { id: 1, signal: new AbortController().signal },
    },
  },
  status: { current: 'streaming' as 'streaming' | 'ready' },
  chat: {
    stop: vi.fn(),
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    addToolOutput: vi.fn(),
    onToolCall: null as null | ((args: { toolCall: { dynamic: boolean; toolName: string; input: unknown; toolCallId: string } }) => Promise<void>),
  },
  actions: {
    pinFile: vi.fn(),
    unpinFile: vi.fn(),
    clearPins: vi.fn(),
    getPinnedContents: vi.fn().mockResolvedValue({
      content: '', fileCount: 0, totalBytes: 0, skipped: [],
    }),
    isRepositorySessionCurrent: (session: unknown) => session === harness.repository.current.repositorySession,
  },
}))

vi.mock('@ai-sdk/react', async () => {
  const ReactModule = await import('react')
  return {
    useChat: vi.fn(({ onToolCall }: {
      onToolCall: (args: { toolCall: { dynamic: boolean; toolName: string; input: unknown; toolCallId: string } }) => Promise<void>
    }) => {
      harness.chat.onToolCall = onToolCall
      const [messages, setMessageState] = ReactModule.useState<UIMessage[]>([{
        id: 'old-chat-message',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Repository A answer' }],
      }])
      const setMessages = ReactModule.useCallback((next: UIMessage[]) => {
        harness.chat.setMessages(next)
        setMessageState(next)
      }, [])
      return {
        messages,
        sendMessage: harness.chat.sendMessage,
        addToolOutput: harness.chat.addToolOutput,
        status: harness.status.current,
        error: null,
        stop: harness.chat.stop,
        setMessages,
      }
    }),
  }
})

vi.mock('ai', () => ({
  DefaultChatTransport: class MockDefaultChatTransport {},
  lastAssistantMessageIsCompleteWithToolCalls: vi.fn(),
  isToolUIPart: vi.fn(() => false),
}))

vi.mock('@/providers', () => ({
  useAPIKeys: () => ({
    selectedModel: { provider: 'openai', id: 'gpt-4o' },
    apiKeys: { openai: { key: 'test-key' } },
    getValidProviders: () => ['openai'],
  }),
  useRepositoryData: () => harness.repository.current,
  useRepositoryActions: () => harness.actions,
  useRepositoryProgress: () => ({ pinnedFiles: new Map() }),
  useTours: () => ({ saveTour: vi.fn(), startTour: vi.fn() }),
  useGitHubToken: () => ({ token: null }),
}))

vi.mock('./chat-message', () => ({
  ChatMessage: ({ message }: { message: UIMessage }) => (
    <div>{message.parts.find(part => part.type === 'text')?.text}</div>
  ),
}))

vi.mock('./chat-input', () => ({
  ChatInput: ({
    value,
    onChange,
    onSubmit,
    attachedImages,
    onImageAttach,
    skillPicker,
  }: {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    attachedImages: FileUIPart[]
    onImageAttach: (images: FileUIPart[]) => void
    skillPicker: React.ReactNode
  }) => (
    <div>
      <input aria-label="chat-draft" value={value} onChange={event => onChange(event.target.value)} />
      <span>attachments:{attachedImages.length}</span>
      <button type="button" onClick={() => onImageAttach([{
        type: 'file', mediaType: 'image/png', filename: 'repo-a.png', url: 'data:image/png;base64,AA==',
      }])}>attach</button>
      {skillPicker}
      <button type="button" onClick={onSubmit}>send</button>
    </div>
  ),
}))

vi.mock('./skill-selector', () => ({
  SkillSelector: ({ activeSkills, onToggle }: {
    activeSkills: Set<string>
    onToggle: (id: string) => void
  }) => (
    <button type="button" onClick={() => onToggle('security-review')}>
      skills:{activeSkills.size}
    </button>
  ),
}))

vi.mock('./pinned-context-chips', () => ({ PinnedContextChips: () => null }))
vi.mock('./pin-file-picker', () => ({ PinFilePicker: () => null }))
vi.mock('./token-usage-footer', () => ({ TokenUsageFooter: () => null }))
vi.mock('@/lib/github/fetcher', () => ({ buildFileTreeString: vi.fn(() => 'tree') }))
vi.mock('@/lib/ai/structural-index', () => ({ buildStructuralIndexAsync: vi.fn(async () => '{}') }))
vi.mock('@/lib/ai/providers', () => ({ getMaxIndexBytesForModel: vi.fn(() => 50_000) }))
vi.mock('@/lib/ai/tool-call-handler', () => ({ handleToolCall: vi.fn() }))
vi.mock('@/lib/ai/client-tool-executor', () => ({ executeToolLocally: vi.fn() }))
vi.mock('@/lib/export', () => ({ downloadFile: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { ChatSidebar } from './chat-sidebar'
import { handleToolCall } from '@/lib/ai/tool-call-handler'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(res => { resolve = res })
  return { promise, resolve }
}

describe('ChatSidebar repository session isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.chat.onToolCall = null
    harness.status.current = 'streaming'
    harness.repository.current = {
      repo: { owner: 'acme', name: 'a', fullName: 'acme/a', description: 'Repository A' },
      files: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      codeIndex: { files: new Map() },
      repositorySession: { id: 1, signal: new AbortController().signal },
    }
  })

  it('stops and clears the old stream, draft, and attachments while preserving skills before a new send', async () => {
    const pendingTool = deferred()
    vi.mocked(handleToolCall).mockImplementation(async (_toolCall, addOutput) => {
      await pendingTool.promise
      addOutput({ tool: 'readFile' as never, toolCallId: 'chat-tool', output: 'stale chat output' })
    })
    const { rerender } = render(<ChatSidebar />)

    fireEvent.change(screen.getByLabelText('chat-draft'), { target: { value: 'Question about A' } })
    fireEvent.click(screen.getByRole('button', { name: 'attach' }))
    fireEvent.click(screen.getByRole('button', { name: 'skills:0' }))
    expect(screen.getByText('attachments:1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'skills:1' })).toBeInTheDocument()
    const oldToolHandler = harness.chat.onToolCall!
    let toolCompletion!: Promise<void>
    act(() => {
      toolCompletion = harness.chat.onToolCall!({
        toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'chat-tool' },
      })
    })

    harness.repository.current = {
      repo: { owner: 'acme', name: 'b', fullName: 'acme/b', description: 'Repository B' },
      files: [{ name: 'b.ts', path: 'b.ts', type: 'file' }],
      codeIndex: { files: new Map() },
      repositorySession: { id: 2, signal: new AbortController().signal },
    }
    await act(async () => rerender(<ChatSidebar />))
    await act(async () => oldToolHandler({
      toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'chat-late-tool' },
    }))
    expect(handleToolCall).toHaveBeenCalledTimes(1)

    expect(harness.chat.stop).toHaveBeenCalledOnce()
    expect(harness.chat.setMessages).toHaveBeenCalledWith([])
    expect(screen.getByLabelText('chat-draft')).toHaveValue('')
    expect(screen.getByText('attachments:0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'skills:1' })).toBeInTheDocument()
    expect(screen.queryByText('Repository A answer')).not.toBeInTheDocument()

    harness.status.current = 'ready'
    await act(async () => rerender(<ChatSidebar />))
    fireEvent.change(screen.getByLabelText('chat-draft'), { target: { value: 'Question about B' } })
    fireEvent.click(screen.getByRole('button', { name: 'send' }))
    await waitFor(() => expect(harness.chat.sendMessage).toHaveBeenCalledOnce())

    expect(harness.chat.stop.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.setMessages.mock.invocationCallOrder[0])
    expect(harness.chat.setMessages.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.sendMessage.mock.invocationCallOrder[0])

    await act(async () => {
      pendingTool.resolve()
      await toolCompletion
    })
    expect(harness.chat.addToolOutput).not.toHaveBeenCalled()
  })
})
