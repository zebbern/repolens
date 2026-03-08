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
import { useAPIKeys, useRepository } from '@/providers'
import { buildFileTreeString } from '@/lib/github/fetcher'
import { buildStructuralIndex } from '@/lib/ai/structural-index'
import { getMaxIndexBytesForModel } from '@/lib/ai/providers'
import { handleToolCall } from '@/lib/ai/tool-call-handler'
import type { CodeIndex } from '@/lib/code/code-index'
import type { GenContext, GeneratedDoc, DocType } from '@/lib/docs'

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

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DocsProvider({ children }: { children: ReactNode }) {
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const { repo, files, codeIndex } = useRepository()

  const hasValidKey = getValidProviders().length > 0 && selectedModel

  // --- Docs state ---
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [showNewDoc, setShowNewDoc] = useState(true)

  // --- Generation context ref (shared with transport) ---
  const genContextRef = useRef<GenContext>({
    docType: 'architecture',
    targetFile: null,
    customPrompt: '',
  })

  const setGenContext = useCallback((ctx: GenContext) => {
    genContextRef.current = ctx
  }, [])

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
  // Fix: use refs for all dynamic values so a single stable transport
  // always reads the latest state at request time.
  const selectedModelRef = useRef(selectedModel)
  const hasValidKeyRef = useRef(hasValidKey)
  const apiKeysRef = useRef(apiKeys)
  const repoContextRef = useRef(repoContext)
  const codeIndexRef = useRef<CodeIndex | null>(codeIndex)

  const allFilePathsRef = useRef<string[]>(files.map(f => f.path))
  useEffect(() => { allFilePathsRef.current = files.map(f => f.path) }, [files])

  useEffect(() => { selectedModelRef.current = selectedModel }, [selectedModel])
  useEffect(() => { hasValidKeyRef.current = hasValidKey }, [hasValidKey])
  useEffect(() => { apiKeysRef.current = apiKeys }, [apiKeys])
  useEffect(() => { repoContextRef.current = repoContext }, [repoContext])
  useEffect(() => { codeIndexRef.current = codeIndex }, [codeIndex])

  // Stable transport — never undefined, reads from refs at request time
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/docs/generate',
        prepareSendMessagesRequest: ({ messages }) => {
          const model = selectedModelRef.current
          const keys = apiKeysRef.current
          const repoCtx = repoContextRef.current
          const ctx = genContextRef.current

          if (!model || !repoCtx) {
            throw new Error('Model or repository not ready for doc generation')
          }

          const structuralIndex = buildStructuralIndex(codeIndexRef.current, { maxIndexBytes: getMaxIndexBytesForModel(model.id) })

          return {
            body: {
              messages,
              provider: model.provider,
              model: model.id,
              apiKey: keys[model.provider].key,
              docType: ctx.docType,
              repoContext: repoCtx,
              structuralIndex,
              targetFile: ctx.targetFile,
              maxSteps: ctx.maxSteps,
              ...(ctx.activeSkills && ctx.activeSkills.length > 0 ? { activeSkills: ctx.activeSkills } : {}),
            },
          }
        },
      }),
    [], // Stable — never recreated; reads current values from refs
  )

  // --- useChat (lives in provider so state survives unmount) ---
  const { messages, sendMessage, addToolOutput, status, setMessages, stop, error } = useChat({
    transport,
    id: 'docs-generator',

    onToolCall: async ({ toolCall }): Promise<void> => handleToolCall(toolCall, addToolOutput, codeIndexRef, allFilePathsRef.current),

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isGenerating = status === 'streaming' || status === 'submitted'

  // --- Clear docs on repo change ---
  const prevRepoRef = useRef(repo?.fullName)
  useEffect(() => {
    if (prevRepoRef.current && prevRepoRef.current !== repo?.fullName) {
      setGeneratedDocs([])
      setActiveDocId(null)
      setShowNewDoc(true)
      setMessages([])
    }
    prevRepoRef.current = repo?.fullName
  }, [repo?.fullName, setMessages])

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
      sendMessage,
      status,
      setMessages,
      stop,
      error,
      isGenerating,
      setGenContext,
    }),
    [messages, sendMessage, status, setMessages, stop, error, isGenerating, setGenContext],
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
