"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, isToolUIPart } from "ai"
import type { FileUIPart } from "ai"
import { Button } from "@/components/ui/button"
import { ChatMessage } from "./chat-message"
import { ChatInput } from "./chat-input"
import { PinnedContextChips } from "./pinned-context-chips"
import { PinFilePicker } from "./pin-file-picker"
import { SkillSelector } from "./skill-selector"
import { TokenUsageFooter } from "./token-usage-footer"
import { Bot, AlertCircle, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAPIKeys, useRepositoryData, useRepositoryActions, useRepositoryProgress, useTours, useGitHubToken } from "@/providers"
import { toast } from "sonner"
import { buildFileTreeString } from "@/lib/github/fetcher"
import { downloadFile } from "@/lib/export"
import { buildStructuralIndex } from "@/lib/ai/structural-index"
import { getMaxIndexBytesForModel } from "@/lib/ai/providers"
import { handleToolCall } from "@/lib/ai/tool-call-handler"
import { executeToolLocally, type ToolExecutorOptions } from "@/lib/ai/client-tool-executor"
import type { ToolCallInfo, AddToolOutputFn } from "@/lib/ai/tool-call-handler"
import type { CodeIndex } from "@/lib/code/code-index"
import type { PinnedContentsResult } from "@/types/types"
import type { Tour } from "@/types/tours"

// TODO(F8): Wire docs/changelog/comparison providers into chat context for richer tool responses.
// These providers are not currently accessible in the chat sidebar and should be added
// in a future iteration as a separate feature.

export function ChatSidebar({ className }: { className?: string }) {
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const { repo, files, codeIndex } = useRepositoryData()
  const { pinFile, unpinFile, clearPins, getPinnedContents } = useRepositoryActions()
  const { pinnedFiles } = useRepositoryProgress()
  const { saveTour, startTour } = useTours()
  const { token: githubToken } = useGitHubToken()
  const [input, setInput] = useState("")
  const [attachedImages, setAttachedImages] = useState<FileUIPart[]>([])
  const [activeSkills, setActiveSkills] = useState<Set<string>>(new Set())

  const handleImageAttach = useCallback((newImages: FileUIPart[]) => {
    setAttachedImages(prev => [...prev, ...newImages])
  }, [])

  const handleImageRemove = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleSkillToggle = useCallback((skillId: string) => {
    setActiveSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }, [])

  // Resolve pinned contents asynchronously (contentStore may be IDB-backed)
  const [pinnedResult, setPinnedResult] = useState<PinnedContentsResult>({ content: '', fileCount: 0, totalBytes: 0, skipped: [] })
  useEffect(() => {
    let stale = false
    getPinnedContents().then(result => {
      if (!stale) setPinnedResult(result)
    })
    return () => { stale = true }
  }, [getPinnedContents])

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

  // Refs to avoid stale closures
  const codeIndexRef = useRef<CodeIndex | null>(codeIndex)
  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])

  const allFilePathsRef = useRef<string[]>(files.map(f => f.path))
  useEffect(() => { allFilePathsRef.current = files.map(f => f.path) }, [files])

  const saveTourRef = useRef(saveTour)
  useEffect(() => { saveTourRef.current = saveTour }, [saveTour])
  const startTourRef = useRef(startTour)
  useEffect(() => { startTourRef.current = startTour }, [startTour])

  const repoRef = useRef(repo)
  useEffect(() => { repoRef.current = repo }, [repo])

  const githubTokenRef = useRef(githubToken)
  useEffect(() => { githubTokenRef.current = githubToken }, [githubToken])

  // Wrap tool call handler to intercept generateTour results
  const handleToolCallWithTourCapture = useMemo(() => {
    return async (toolCall: ToolCallInfo, addOutput: AddToolOutputFn, indexRef: React.MutableRefObject<CodeIndex | null>, filePathsRef: React.MutableRefObject<string[]>) => {
      // Construct tool executor options from current refs
      const currentRepo = repoRef.current
      const toolOptions: ToolExecutorOptions = {
        indexingProgress: {
          filesIndexed: indexRef.current?.files.size ?? 0,
          totalFiles: filePathsRef.current.length,
        },
        ...(currentRepo ? {
          repoMeta: {
            stars: currentRepo.stars,
            forks: currentRepo.forks,
            description: currentRepo.description ?? undefined,
            topics: currentRepo.topics,
            license: currentRepo.license ?? undefined,
            language: currentRepo.language ?? undefined,
          },
          repoName: currentRepo.fullName,
          repoInfo: {
            owner: currentRepo.owner,
            name: currentRepo.name,
            defaultBranch: currentRepo.defaultBranch,
            token: githubTokenRef.current ?? undefined,
          },
        } : {}),
      }

      if (toolCall.toolName === 'generateTour' && !toolCall.dynamic) {
        try {
          const resultStr = await executeToolLocally(
            toolCall.toolName,
            toolCall.input as Record<string, unknown>,
            indexRef.current,
            filePathsRef.current,
            toolOptions,
          )
          const parsed = JSON.parse(resultStr)
          if (parsed.tour && !parsed.error) {
            const tour = parsed.tour as Tour
            saveTourRef.current(tour)
            startTourRef.current(tour)
            toast.success(`Tour created: ${tour.name}`)
          }
          addOutput({
            tool: toolCall.toolName as never,
            toolCallId: toolCall.toolCallId,
            output: resultStr,
          })
        } catch (err) {
          addOutput({
            state: 'output-error' as const,
            tool: toolCall.toolName as never,
            toolCallId: toolCall.toolCallId,
            errorText: err instanceof Error ? err.message : 'Tour generation failed',
          })
        }
        return
      }
      await handleToolCall(toolCall, addOutput, indexRef, filePathsRef.current, toolOptions)
    }
  }, [])

  // Create a stable transport — always available so the Chat instance
  // created by useChat is never initialised with transport: undefined.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat' }),
    [],
  )

  const { messages, sendMessage, addToolOutput, status, error, stop } = useChat({
    transport,
    id: 'codedoc-chat',

    onToolCall: async ({ toolCall }): Promise<void> => handleToolCallWithTourCapture(toolCall, addToolOutput, codeIndexRef, allFilePathsRef),

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // Extract cumulative token usage from the last assistant message metadata
  const tokenUsage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && (msg as { metadata?: { usage?: { inputTokens: number; outputTokens: number } } }).metadata?.usage) {
        const usage = (msg as { metadata?: { usage?: { inputTokens: number; outputTokens: number } } }).metadata!.usage!
        return usage
      }
    }
    return null
  }, [messages])

  const handleSubmit = () => {
    const hasText = input.trim().length > 0
    const hasImages = attachedImages.length > 0
    if ((!hasText && !hasImages) || isLoading || !hasValidKey || !selectedModel) return

    const currentInput = input.trim()
    setInput("")
    const imagesToSend = [...attachedImages]
    setAttachedImages([])

    const structuralIndex = buildStructuralIndex(codeIndex, { maxIndexBytes: getMaxIndexBytesForModel(selectedModel.id) })

    const body = {
      provider: selectedModel.provider,
      model: selectedModel.id,
      apiKey: apiKeys[selectedModel.provider].key,
      repoContext,
      structuralIndex,
      pinnedContext: pinnedResult.content || undefined,
      maxSteps: 50,
      ...(activeSkills.size > 0 ? { activeSkills: Array.from(activeSkills) } : {}),
    }

    if (hasText && hasImages) {
      sendMessage({ text: currentInput, files: imagesToSend }, { body })
    } else if (hasImages) {
      sendMessage({ files: imagesToSend }, { body })
    } else {
      sendMessage({ text: currentInput }, { body })
    }
  }

  return (
    <aside className={cn("flex h-full flex-col overflow-hidden rounded-lg bg-card", className)}>
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-foreground/6 px-4">
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
          <div className="flex flex-col items-center justify-center h-full text-center animate-in fade-in duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/4 border border-foreground/6 mb-4">
              <Bot className="h-6 w-6 text-text-secondary" />
            </div>
            <p className="text-sm font-medium text-text-secondary">
              {repo 
                ? `Ask me anything about ${repo.name}`
                : "Connect a repository to get contextual help"
              }
            </p>
            <p className="text-xs text-text-muted mt-1.5">
              I can explain code, generate docs, and answer questions
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isLoading && messages.length > 0 && (() => {
          const lastMsg = messages[messages.length - 1]
          const hasContent = lastMsg.role === 'assistant' && lastMsg.parts?.some(
            p => (p.type === 'text' && p.text.trim().length > 0) || isToolUIPart(p)
          )
          if (lastMsg.role === 'user' || !hasContent) {
            return (
              <div className="flex items-center gap-1 px-3 py-2">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )
          }
          return null
        })()}

        {error && (
          <div className="flex items-center justify-center gap-2 p-3 bg-status-error/10 rounded-lg mx-auto max-w-sm">
            <AlertCircle className="h-4 w-4 text-status-error shrink-0" />
            <p className="text-xs text-status-error text-center">{error.message}</p>
          </div>
        )}
      </div>

      {/* Token Usage */}
      {selectedModel && (
        <TokenUsageFooter
          inputTokens={tokenUsage?.inputTokens ?? 0}
          outputTokens={tokenUsage?.outputTokens ?? 0}
          model={selectedModel.id}
        />
      )}

      {/* Input */}
      <div className="p-3">
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          onStop={stop}
          placeholder={hasValidKey ? "Ask about the codebase..." : "Add API key to chat"}
          disabled={!hasValidKey}
          attachedImages={attachedImages}
          onImageAttach={handleImageAttach}
          onImageRemove={handleImageRemove}
          pinnedChips={
            <PinnedContextChips
              pinnedFiles={pinnedFiles}
              onUnpin={unpinFile}
              onClearAll={clearPins}
              totalBytes={pinnedResult.totalBytes}
            />
          }
          pinPicker={
            repo ? (
              <PinFilePicker
                codeIndex={codeIndex}
                pinnedFiles={pinnedFiles}
                onPin={pinFile}
                onUnpin={unpinFile}
              />
            ) : undefined
          }
          skillPicker={
            <SkillSelector
              activeSkills={activeSkills}
              onToggle={handleSkillToggle}
            />
          }
        />
      </div>
    </aside>
  )
}
