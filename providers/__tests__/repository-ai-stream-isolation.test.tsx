import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const harness = vi.hoisted(() => ({
  repository: {
    current: {
      repo: { fullName: 'acme/a', description: 'Repository A' },
      files: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      codeIndex: null,
      repositorySession: { id: 1, signal: new AbortController().signal },
    },
  },
  chat: {
    docs: {
      stop: vi.fn(),
      setMessages: vi.fn(),
      sendMessage: vi.fn(),
      addToolOutput: vi.fn(),
      onToolCall: null as null | ((args: { toolCall: { dynamic: boolean; toolName: string; input: unknown; toolCallId: string } }) => Promise<void>),
    },
    changelog: {
      stop: vi.fn(),
      setMessages: vi.fn(),
      sendMessage: vi.fn(),
      addToolOutput: vi.fn(),
      onToolCall: null as null | ((args: { toolCall: { dynamic: boolean; toolName: string; input: unknown; toolCallId: string } }) => Promise<void>),
    },
  },
  transports: [] as Array<{
    api: string
    prepareSendMessagesRequest: (args: { messages: UIMessage[] }) => Promise<{ body: Record<string, unknown> }>
  }>,
}))

vi.mock('@ai-sdk/react', async () => {
  const ReactModule = await import('react')
  return {
    useChat: vi.fn(({ id, onToolCall }: {
      id: string
      onToolCall: (args: { toolCall: { dynamic: boolean; toolName: string; input: unknown; toolCallId: string } }) => Promise<void>
    }) => {
      const kind = id.startsWith('docs-generator') ? 'docs' : 'changelog'
      const controls = harness.chat[kind]
      controls.onToolCall = onToolCall
      const [messages, setMessageState] = ReactModule.useState<UIMessage[]>([{
        id: `${kind}-old-message`,
        role: 'assistant',
        parts: [{ type: 'text', text: `old ${kind}` }],
      }])
      const setMessages = ReactModule.useCallback((next: UIMessage[]) => {
        controls.setMessages(next)
        setMessageState(next)
      }, [controls])

      return {
        messages,
        sendMessage: controls.sendMessage,
        addToolOutput: controls.addToolOutput,
        status: 'streaming',
        setMessages,
        stop: controls.stop,
        error: null,
      }
    }),
  }
})

vi.mock('ai', () => {
  class MockDefaultChatTransport {
    constructor(options: (typeof harness.transports)[number]) {
      harness.transports.push(options)
    }
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
  }),
  useRepositoryData: () => harness.repository.current,
  useRepositoryActions: () => ({
    isRepositorySessionCurrent: (session: unknown) => session === harness.repository.current.repositorySession,
  }),
}))

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTreeString: vi.fn(() => 'mocked-tree'),
}))

vi.mock('@/lib/ai/structural-index', () => ({
  buildStructuralIndexAsync: vi.fn(async () => '{}'),
}))

vi.mock('@/lib/ai/providers', () => ({
  getMaxIndexBytesForModel: vi.fn(() => 50_000),
}))

vi.mock('@/lib/ai/tool-call-handler', () => ({
  handleToolCall: vi.fn(),
}))

import { ChangelogProvider, useChangelog, useChangelogChat } from '../changelog-provider'
import { DocsProvider, useDocs, useDocsChat } from '../docs-provider'
import { handleToolCall } from '@/lib/ai/tool-call-handler'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(res => { resolve = res })
  return { promise, resolve }
}

function docsWrapper({ children }: { children: ReactNode }) {
  return <DocsProvider>{children}</DocsProvider>
}

function changelogWrapper({ children }: { children: ReactNode }) {
  return <ChangelogProvider>{children}</ChangelogProvider>
}

describe('repository-scoped AI provider state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.transports.length = 0
    harness.chat.docs.onToolCall = null
    harness.chat.changelog.onToolCall = null
    harness.repository.current = {
      repo: { fullName: 'acme/a', description: 'Repository A' },
      files: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      codeIndex: null,
      repositorySession: { id: 1, signal: new AbortController().signal },
    }
  })

  it('stops and clears Docs before a new send, resets repository inputs, and preserves skills', async () => {
    const pendingTool = deferred()
    vi.mocked(handleToolCall).mockImplementation(async (_toolCall, addOutput) => {
      await pendingTool.promise
      addOutput({ tool: 'readFile' as never, toolCallId: 'docs-tool', output: 'stale docs output' })
    })
    const { result, rerender } = renderHook(() => ({
      state: useDocs(),
      chat: useDocsChat(),
    }), { wrapper: docsWrapper })

    act(() => {
      result.current.state.setGeneratedDocs([{
        id: 'old-doc',
        type: 'file-explanation',
        title: 'Old doc',
        messages: result.current.chat.messages,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }])
      result.current.chat.setGenContext({
        docType: 'file-explanation',
        targetFile: 'a.ts',
        customPrompt: 'Explain repository A',
        activeSkills: ['security-review'],
      })
    })
    const oldToolHandler = harness.chat.docs.onToolCall!
    let toolCompletion!: Promise<void>
    act(() => {
      toolCompletion = harness.chat.docs.onToolCall!({
        toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'docs-tool' },
      })
    })

    harness.repository.current = {
      repo: { fullName: 'acme/b', description: 'Repository B' },
      files: [{ name: 'b.ts', path: 'b.ts', type: 'file' }],
      codeIndex: null,
      repositorySession: { id: 2, signal: new AbortController().signal },
    }
    await act(async () => rerender())
    await act(async () => oldToolHandler({
      toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'docs-late-tool' },
    }))
    expect(handleToolCall).toHaveBeenCalledTimes(1)

    expect(harness.chat.docs.stop).toHaveBeenCalledOnce()
    expect(result.current.chat.messages).toEqual([])
    expect(result.current.state.generatedDocs).toEqual([])
    expect(harness.chat.docs.stop.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.docs.setMessages.mock.invocationCallOrder[0])

    const transport = harness.transports.find(item => item.api === '/api/docs/generate')
    const request = await transport?.prepareSendMessagesRequest({ messages: [] })
    expect(request?.body.targetFile).toBeNull()
    expect(request?.body.activeSkills).toEqual(['security-review'])

    act(() => result.current.chat.sendMessage({ text: 'new repository question' }))
    expect(harness.chat.docs.setMessages.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.docs.sendMessage.mock.invocationCallOrder[0])

    await act(async () => {
      pendingTool.resolve()
      await toolCompletion
    })
    expect(harness.chat.docs.addToolOutput).not.toHaveBeenCalled()
  })

  it('stops and clears Changelog before a new send, resets repository inputs, and preserves skills', async () => {
    const pendingTool = deferred()
    vi.mocked(handleToolCall).mockImplementation(async (_toolCall, addOutput) => {
      await pendingTool.promise
      addOutput({ tool: 'readFile' as never, toolCallId: 'changelog-tool', output: 'stale changelog output' })
    })
    const { result, rerender } = renderHook(() => ({
      state: useChangelog(),
      chat: useChangelogChat(),
    }), { wrapper: changelogWrapper })

    act(() => {
      result.current.state.setGeneratedChangelogs([{
        id: 'old-changelog',
        type: 'conventional',
        title: 'Old changelog',
        messages: result.current.chat.messages,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }])
      result.current.chat.setGenContext({
        changelogType: 'conventional',
        fromRef: 'v1',
        toRef: 'v2',
        customPrompt: 'Repository A changes',
        commitData: 'A-only commits',
        activeSkills: ['release-notes'],
      })
    })
    const oldToolHandler = harness.chat.changelog.onToolCall!
    let toolCompletion!: Promise<void>
    act(() => {
      toolCompletion = harness.chat.changelog.onToolCall!({
        toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'changelog-tool' },
      })
    })

    harness.repository.current = {
      repo: { fullName: 'acme/b', description: 'Repository B' },
      files: [{ name: 'b.ts', path: 'b.ts', type: 'file' }],
      codeIndex: null,
      repositorySession: { id: 2, signal: new AbortController().signal },
    }
    await act(async () => rerender())
    await act(async () => oldToolHandler({
      toolCall: { dynamic: false, toolName: 'readFile', input: { path: 'a.ts' }, toolCallId: 'changelog-late-tool' },
    }))
    expect(handleToolCall).toHaveBeenCalledTimes(1)

    expect(harness.chat.changelog.stop).toHaveBeenCalledOnce()
    expect(result.current.chat.messages).toEqual([])
    expect(result.current.state.generatedChangelogs).toEqual([])
    expect(harness.chat.changelog.stop.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.changelog.setMessages.mock.invocationCallOrder[0])

    const transport = harness.transports.find(item => item.api === '/api/changelog/generate')
    const request = await transport?.prepareSendMessagesRequest({ messages: [] })
    expect(request?.body).toMatchObject({
      fromRef: '',
      toRef: '',
      activeSkills: ['release-notes'],
    })
    expect(request?.body.commitData).toBeUndefined()

    act(() => result.current.chat.sendMessage({ text: 'new repository question' }))
    expect(harness.chat.changelog.setMessages.mock.invocationCallOrder[0])
      .toBeLessThan(harness.chat.changelog.sendMessage.mock.invocationCallOrder[0])

    await act(async () => {
      pendingTool.resolve()
      await toolCompletion
    })
    expect(harness.chat.changelog.addToolOutput).not.toHaveBeenCalled()
  })
})
