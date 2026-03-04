"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { Button } from "@/components/ui/button"
import { ChatMessage } from "./chat-message"
import { ChatInput } from "./chat-input"
import { Bot, AlertCircle, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAPIKeys, useRepository } from "@/providers"
import { buildFileTreeString } from "@/lib/github/fetcher"
import { downloadFile } from "@/lib/export"
import { buildStructuralIndex } from "@/lib/ai/structural-index"
import { getMaxIndexBytesForModel } from "@/lib/ai/providers"
import { executeToolLocally } from "@/lib/ai/client-tool-executor"
import type { CodeIndex } from "@/lib/code/code-index"

export function ChatSidebar({ className }: { className?: string }) {
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const { repo, files, codeIndex } = useRepository()
  const [input, setInput] = useState("")

  const validProviders = getValidProviders()
  const hasValidKey = validProviders.length > 0 && selectedModel

  // Build repo context for the AI
  const repoContext = useMemo(() => {
    if (!repo || files.length === 0) return undefined
    return {
      name: repo.fullName,
      description: repo.description || 'No description',
      structure: buildFileTreeString(files),
    }
  }, [repo, files])

  // Ref to avoid stale closure in onToolCall
  const codeIndexRef = useRef<CodeIndex | null>(codeIndex)
  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])

  // Create a stable transport — always available so the Chat instance
  // created by useChat is never initialised with transport: undefined.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat' }),
    [],
  )

  const { messages, sendMessage, addToolOutput, status, error } = useChat({
    transport,
    id: 'codedoc-chat',

    onToolCall: async ({ toolCall }) => {
      if (toolCall.dynamic) return

      try {
        const result = executeToolLocally(
          toolCall.toolName,
          toolCall.input as Record<string, unknown>,
          codeIndexRef.current,
        )
        addToolOutput({
          // AI SDK expects a literal tool name type, but dynamic tool names require this cast
          tool: toolCall.toolName as never,
          toolCallId: toolCall.toolCallId,
          output: result,
        })
      } catch (err) {
        addToolOutput({
          state: 'output-error' as const,
          // AI SDK expects a literal tool name type, but dynamic tool names require this cast
          tool: toolCall.toolName as never,
          toolCallId: toolCall.toolCallId,
          errorText: err instanceof Error ? err.message : 'Tool execution failed',
        })
      }
    },

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  const handleSubmit = () => {
    if (!input.trim() || isLoading || !hasValidKey || !selectedModel) return

    const currentInput = input.trim()
    setInput("")

    const structuralIndex = buildStructuralIndex(codeIndex, { maxIndexBytes: getMaxIndexBytesForModel(selectedModel.id) })

    sendMessage(
      { text: currentInput },
      {
        body: {
          provider: selectedModel.provider,
          model: selectedModel.id,
          apiKey: apiKeys[selectedModel.provider].key,
          repoContext,
          structuralIndex,
          maxSteps: 50,
        },
      },
    )
  }

  return (
    <aside className={cn("flex h-full flex-col overflow-hidden rounded-lg bg-card", className)}>
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-foreground/[0.06] px-4">
        <span className="text-sm font-medium text-text-primary">Chat</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-text-primary"
              title="Export chat as Markdown"
              onClick={() => {
                const md = messages.map(m => {
                  const role = m.role === 'user' ? 'User' : 'Assistant'
                  const text = m.parts
                    ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map(p => p.text)
                    .join('') || ''
                  return `## ${role}\n\n${text}`
                }).join('\n\n---\n\n')
                const title = repo ? `# Chat — ${repo.name}\n\n` : '# Chat\n\n'
                downloadFile({
                  content: title + md,
                  filename: `chat-${repo?.name || 'export'}.md`,
                  mimeType: 'text/markdown',
                })
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          {repo && (
            <span className="text-xs text-text-muted truncate max-w-[150px]" title={repo.fullName}>
              {repo.fullName}
            </span>
          )}
        </div>
      </div>

      {/* API Key Warning */}
      {!hasValidKey && (
        <div className="flex items-center gap-2 px-4 py-2 bg-status-warning/10 border-b border-status-warning/20">
          <AlertCircle className="h-4 w-4 text-status-warning shrink-0" />
          <p className="text-xs text-status-warning">
            Add an API key in Settings to start chatting
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && hasValidKey && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary">
              {repo 
                ? `Ask me anything about ${repo.name}`
                : "Connect a repository to get contextual help"
              }
            </p>
            <p className="text-xs text-text-muted mt-1">
              I can explain code, generate docs, and answer questions
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {error && (
          <div className="flex items-center justify-center gap-2 p-3 bg-status-error/10 rounded-lg mx-auto max-w-sm">
            <AlertCircle className="h-4 w-4 text-status-error shrink-0" />
            <p className="text-xs text-status-error text-center">{error.message}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3">
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder={hasValidKey ? "Ask about the codebase..." : "Add API key to chat"}
          disabled={!hasValidKey}
        />
      </div>
    </aside>
  )
}
