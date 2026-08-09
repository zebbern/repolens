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
import type { CodeIndex } from '@/lib/code/code-index'
import type { GenContext, GeneratedDoc, DocType } from '@/lib/docs'
import type { APIKeysState, ProviderModel } from '@/types/types'

// Re-export for backward compatibility
export {
  DOC_PRESETS,
  getAssistantText,
  buildDocPrompt,
} from '@/lib/docs'
export type { DocType, DocPreset, GeneratedDoc, GenContext } from '@/lib/docs'

// ---------------------------------------------------------------------------
// Docs State Context  (rarely changes)
// ---------------------------------------------------------------------------

interface DocsStateContextType {
  generatedDocs: GeneratedDoc[]
  activeDocId: string | null
  showNewDoc: boolean
  setGeneratedDocs: React.Dispatch<React.SetStateAction<GeneratedDoc[]>>
  setActiveDocId: (id: string | null) => void
  setShowNewDoc: (show: boolean) => void
  clearDocs: () => void
}

const DocsStateContext = createContext<DocsStateContextType | null>(null)

// ---------------------------------------------------------------------------
// Docs Chat Context  (changes frequently during generation)
// ---------------------------------------------------------------------------

interface DocsChatContextType {
  messages: UIMessage[]
  sendMessage: (msg: { text: string }) => void
  status: string
  setMessages: (msgs: UIMessage[]) => void
  stop: () => void
  error: Error | null | undefined
  isGenerating: boolean
  /** Set the generation context ref so the transport picks it up. */
  setGenContext: (ctx: GenContext) => void
}

const DocsChatContext = createContext<DocsChatContextType | null>(null)

interface DocsTransportRuntime {
  selectedModel: ProviderModel | null
  apiKeys: APIKeysState
  repoContext: { name: string; description: string; structure: string } | undefined
  codeIndex: CodeIndex
  genContext: GenContext
}

function createDocsTransportController() {
  let runtime: DocsTransportRuntime | null = null
  const transport = new DefaultChatTransport({
    api: '/api/docs/generate',
    prepareSendMessagesRequest: ({ messages }) => {
      const current = runtime
      if (!current?.selectedModel || !current.repoContext) {
        throw new Error('Model or repository not ready for doc generation')
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
          docType: genContext.docType,
          repoContext,
          structuralIndex,
          targetFile: genContext.targetFile,
          maxSteps: genContext.maxSteps,
          ...(genContext.activeSkills?.length ? { activeSkills: genContext.activeSkills } : {}),
        },
      }
    },
  })

  return {
    transport,
    update(next: DocsTransportRuntime) {
      runtime = next
    },
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DocsProvider({ children }: { children: ReactNode }) {
  const { selectedModel, apiKeys } = useAPIKeys()
  const { repo, files, codeIndex, repositorySession } = useRepositoryData()
  const { isRepositorySessionCurrent } = useRepositoryActions()
  const repoKey = repo?.fullName

  // --- Docs state ---
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [showNewDoc, setShowNewDoc] = useState(true)

  // --- Generation context (shared with transport) ---
  const [genContext, setGenContext] = useState<GenContext>({
    docType: 'architecture',
    targetFile: null,
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
  // IMPORTANT: The ai-sdk Chat instance is created once in useRef and only
  // recreated when the `id` changes — NOT when `transport` changes. If we
  // pass `undefined` on the first render (e.g. before selectedModel is set),
  // the Chat permanently uses DefaultChatTransport → /api/chat.
  //
  // Keep a single stable transport while updating its request-time runtime.
  const codeIndexRef = useRef<CodeIndex | null>(codeIndex)

  const allFilePathsRef = useRef<string[]>(files.map(f => f.path))
  useEffect(() => { allFilePathsRef.current = files.map(f => f.path) }, [files])

  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])

  const [transportController] = useState(createDocsTransportController)
  useEffect(() => {
    transportController.update({ selectedModel, apiKeys, repoContext, codeIndex, genContext })
  }, [transportController, selectedModel, apiKeys, repoContext, codeIndex, genContext])
  const transport = transportController.transport

  // --- useChat (lives in provider so state survives unmount) ---
  const { messages, sendMessage, addToolOutput, status, setMessages, stop, error } = useChat({
    transport,
    id: `docs-generator:${repositorySession?.id ?? 'none'}`,

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
      setGeneratedDocs([])
      setActiveDocId(null)
      setShowNewDoc(true)
      setGenContext(previous => ({
        docType: 'architecture',
        targetFile: null,
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

  const clearDocs = useCallback(() => {
    setGeneratedDocs([])
    setActiveDocId(null)
    setShowNewDoc(true)
    setMessages([])
  }, [setMessages])

  // --- Context values ---
  const stateValue = useMemo<DocsStateContextType>(
    () => ({
      generatedDocs,
      activeDocId,
      showNewDoc,
      setGeneratedDocs,
      setActiveDocId,
      setShowNewDoc,
      clearDocs,
    }),
    [generatedDocs, activeDocId, showNewDoc, clearDocs],
  )

  const chatValue = useMemo<DocsChatContextType>(
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
    <DocsStateContext.Provider value={stateValue}>
      <DocsChatContext.Provider value={chatValue}>{children}</DocsChatContext.Provider>
    </DocsStateContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useDocs() {
  const context = useContext(DocsStateContext)
  if (context === null) {
    throw new Error('useDocs must be used within a DocsProvider')
  }
  return context
}

export function useDocsChat() {
  const context = useContext(DocsChatContext)
  if (context === null) {
    throw new Error('useDocsChat must be used within a DocsProvider')
  }
  return context
}
