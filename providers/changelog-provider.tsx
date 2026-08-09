"use client"

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from 'ai'
import { useAPIKeys, useRepositoryActions, useRepositoryData } from '@/providers'
import { buildFileTreeString } from '@/lib/github/fetcher'
import { buildStructuralIndex } from '@/lib/ai/structural-index'
import { getMaxIndexBytesForModel } from '@/lib/ai/providers'
import { handleToolCall, type AddToolOutputFn } from '@/lib/ai/tool-call-handler'
import { flattenFiles, type CodeIndex } from '@/lib/code/code-index'
import type { ChangelogGenContext, GeneratedChangelog } from '@/lib/changelog'
import type { APIKeysState, ProviderModel } from '@/types/types'

// Re-export for backward compatibility
export {
  CHANGELOG_PRESETS,
  getAssistantText,
  buildChangelogPrompt,
} from '@/lib/changelog'
export type {
  ChangelogType,
  ChangelogPreset,
  GeneratedChangelog,
  ChangelogGenContext,
} from '@/lib/changelog'

// ---------------------------------------------------------------------------
// Changelog State Context  (rarely changes)
// ---------------------------------------------------------------------------

interface ChangelogStateContextType {
  generatedChangelogs: GeneratedChangelog[]
  activeChangelogId: string | null
  showNewChangelog: boolean
  setGeneratedChangelogs: React.Dispatch<React.SetStateAction<GeneratedChangelog[]>>
  setActiveChangelogId: (id: string | null) => void
  setShowNewChangelog: (show: boolean) => void
  clearChangelogs: () => void
}

const ChangelogStateContext = createContext<ChangelogStateContextType | null>(null)

// ---------------------------------------------------------------------------
// Changelog Chat Context  (changes frequently during generation)
// ---------------------------------------------------------------------------

interface ChangelogChatContextType {
  messages: UIMessage[]
  sendMessage: (msg: { text: string }) => void
  status: string
  setMessages: (msgs: UIMessage[]) => void
  stop: () => void
  error: Error | null | undefined
  isGenerating: boolean
  /** Set the generation context ref so the transport picks it up. */
  setGenContext: (ctx: ChangelogGenContext) => void
}

const ChangelogChatContext = createContext<ChangelogChatContextType | null>(null)

interface ChangelogTransportRuntime {
  selectedModel: ProviderModel | null
  apiKeys: APIKeysState
  repoContext: { name: string; description: string; structure: string } | undefined
  codeIndex: CodeIndex
  genContext: ChangelogGenContext
}

function createChangelogTransportController() {
  let runtime: ChangelogTransportRuntime | null = null
  const transport = new DefaultChatTransport({
    api: '/api/changelog/generate',
    prepareSendMessagesRequest: ({ messages }) => {
      const current = runtime
      if (!current?.selectedModel || !current.repoContext) {
        throw new Error('Model or repository not ready for changelog generation')
      }

      const { selectedModel, apiKeys, repoContext, codeIndex, genContext } = current
      const structuralIndex = buildStructuralIndex(codeIndex, {
        maxIndexBytes: getMaxIndexBytesForModel(selectedModel.id),
      })

      return {
        body: {
          messages,
          provider: selectedModel.provider,
          model: selectedModel.id,
          apiKey: apiKeys[selectedModel.provider].key,
          changelogType: genContext.changelogType,
          repoContext,
          structuralIndex,
          fromRef: genContext.fromRef,
          toRef: genContext.toRef,
          commitData: genContext.commitData,
          maxSteps: genContext.maxSteps,
          ...(genContext.activeSkills?.length ? { activeSkills: genContext.activeSkills } : {}),
        },
      }
    },
  })

  return {
    transport,
    update(next: ChangelogTransportRuntime) {
      runtime = next
    },
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ChangelogProvider({ children }: { children: ReactNode }) {
  const { selectedModel, apiKeys } = useAPIKeys()
  const { repo, files, codeIndex, repositorySession } = useRepositoryData()
  const { isRepositorySessionCurrent } = useRepositoryActions()
  const repoKey = repo?.fullName

  // --- Changelog state ---
  const [generatedChangelogs, setGeneratedChangelogs] = useState<GeneratedChangelog[]>([])
  const [activeChangelogId, setActiveChangelogId] = useState<string | null>(null)
  const [showNewChangelog, setShowNewChangelog] = useState(true)

  // --- Generation context (shared with transport) ---
  const [genContext, setGenContext] = useState<ChangelogGenContext>({
    changelogType: 'conventional',
    fromRef: '',
    toRef: '',
    customPrompt: '',
  })

  // --- Repo-derived data ---
  const repoContext = useMemo(() => {
    if (!repo || files.length === 0) return undefined
    return {
      name: repo.fullName,
      description: repo.description || 'No description',
      structure: buildFileTreeString(files),
    }
  }, [repo, files])

  // --- Transport ---
  const codeIndexRef = useRef<CodeIndex | null>(codeIndex)

  const allFilePathsRef = useRef<string[]>(flattenFiles(files).map(f => f.path))
  useEffect(() => { allFilePathsRef.current = flattenFiles(files).map(f => f.path) }, [files])

  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])

  const [transportController] = useState(createChangelogTransportController)
  useEffect(() => {
    transportController.update({ selectedModel, apiKeys, repoContext, codeIndex, genContext })
  }, [transportController, selectedModel, apiKeys, repoContext, codeIndex, genContext])
  const transport = transportController.transport

  // --- useChat (lives in provider so state survives unmount) ---
  const { messages, sendMessage, addToolOutput, status, setMessages, stop, error } = useChat({
    transport,
    id: `changelog-generator:${repositorySession?.id ?? 'none'}`,

    onToolCall: async ({ toolCall }): Promise<void> => {
      const repoSession = repositorySession
      if (!isRepositorySessionCurrent(repoSession)) return
      const addOutputIfCurrent: AddToolOutputFn = output => {
        if (isRepositorySessionCurrent(repoSession)) addToolOutput(output)
      }
      await handleToolCall(toolCall, addOutputIfCurrent, codeIndexRef, allFilePathsRef.current)
    },

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isGenerating = status === 'streaming' || status === 'submitted'

  // --- Stop and clear repository-derived state on repo change ---
  const currentRepoKeyRef = useRef(repoKey)
  const prevRepoRef = useRef(repoKey)
  useEffect(() => {
    if (prevRepoRef.current !== repoKey) {
      stop()
      setGeneratedChangelogs([])
      setActiveChangelogId(null)
      setShowNewChangelog(true)
      setGenContext(previous => ({
        changelogType: 'conventional',
        fromRef: '',
        toRef: '',
        customPrompt: '',
        ...(previous.activeSkills?.length ? { activeSkills: previous.activeSkills } : {}),
      }))
      setMessages([])
    }
    prevRepoRef.current = repoKey
    currentRepoKeyRef.current = repoKey
  }, [repoKey, setMessages, stop])

  const sendMessageForCurrentRepo = useCallback((message: { text: string }) => {
    if (!repoKey || currentRepoKeyRef.current !== repoKey) return
    void sendMessage(message)
  }, [repoKey, sendMessage])

  const clearChangelogs = useCallback(() => {
    setGeneratedChangelogs([])
    setActiveChangelogId(null)
    setShowNewChangelog(true)
    setMessages([])
  }, [setMessages])

  // --- Context values ---
  const stateValue = useMemo<ChangelogStateContextType>(
    () => ({
      generatedChangelogs,
      activeChangelogId,
      showNewChangelog,
      setGeneratedChangelogs,
      setActiveChangelogId,
      setShowNewChangelog,
      clearChangelogs,
    }),
    [generatedChangelogs, activeChangelogId, showNewChangelog, clearChangelogs],
  )

  const chatValue = useMemo<ChangelogChatContextType>(
    () => ({
      messages,
      sendMessage: sendMessageForCurrentRepo,
      status,
      setMessages,
      stop,
      error,
      isGenerating,
      setGenContext,
    }),
    [messages, sendMessageForCurrentRepo, status, setMessages, stop, error, isGenerating, setGenContext],
  )

  return (
    <ChangelogStateContext.Provider value={stateValue}>
      <ChangelogChatContext.Provider value={chatValue}>{children}</ChangelogChatContext.Provider>
    </ChangelogStateContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useChangelog() {
  const context = useContext(ChangelogStateContext)
  if (context === null) {
    throw new Error('useChangelog must be used within a ChangelogProvider')
  }
  return context
}

export function useChangelogChat() {
  const context = useContext(ChangelogChatContext)
  if (context === null) {
    throw new Error('useChangelogChat must be used within a ChangelogProvider')
  }
  return context
}
