'use client'

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
import { executeToolLocally } from '@/lib/ai/client-tool-executor'
import type { CodeIndex } from '@/lib/code/code-index'

// ---------------------------------------------------------------------------
// Types & constants (moved from doc-viewer.tsx)
// ---------------------------------------------------------------------------

export type DocType = 'architecture' | 'setup' | 'api-reference' | 'file-explanation' | 'custom'

export interface DocPreset {
  id: DocType
  label: string
  description: string
  icon: ReactNode
  prompt: string
}

// NOTE: icons are set to `null` here because React elements shouldn't live in
// a provider module.  DocViewer maps `id → icon` at render time via
// `DOC_PRESET_ICONS`.  The provider only cares about the prompt text.
export const DOC_PRESETS: DocPreset[] = [
  {
    id: 'architecture',
    label: 'Architecture Overview',
    description: 'How the project is structured, modules, data flow, and design decisions',
    icon: null,
    prompt:
      'Generate a comprehensive architecture overview for this codebase. Cover the high-level structure, key modules, data flow, and notable design decisions.',
  },
  {
    id: 'setup',
    label: 'Setup / Getting Started',
    description: 'Installation, configuration, and how to run the project locally',
    icon: null,
    prompt:
      'Generate a Getting Started guide for this project. Include prerequisites, installation steps, configuration (env vars, etc.), and how to run it locally.',
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    description: 'Exported functions, classes, types, and interfaces with signatures',
    icon: null,
    prompt:
      'Generate an API reference documenting all significant exported functions, classes, types, and interfaces. Include type signatures, parameter descriptions, and usage examples.',
  },
  {
    id: 'file-explanation',
    label: 'Explain a File',
    description: 'Deep explanation of a specific file -- purpose, logic, and how it fits',
    icon: null,
    prompt: '', // set dynamically based on selected file
  },
  {
    id: 'custom',
    label: 'Custom Prompt',
    description: 'Ask the AI to generate any docs you need',
    icon: null,
    prompt: '',
  },
]

export interface GeneratedDoc {
  id: string
  type: DocType
  title: string
  messages: UIMessage[]
  createdAt: Date
  targetFile?: string
  customPrompt?: string
  maxSteps?: number
}

/** Extracts all assistant text from chat messages. */
export function getAssistantText(messages: UIMessage[]): string {
  return messages
    .filter(m => m.role === 'assistant')
    .flatMap(
      m =>
        m.parts
          ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map(p => p.text) || [],
    )
    .join('')
}

/** Builds the prompt string for a given preset / file / custom prompt. */
export function buildDocPrompt(
  preset: DocPreset,
  targetFile: string | null,
  customPrompt: string,
): string {
  if (preset.id === 'file-explanation' && targetFile) {
    return `Explain this file in detail: \`${targetFile}\`. Cover its purpose, how it fits in the architecture, key functions/classes, and walk through the main logic.`
  }
  if (preset.id === 'custom') return customPrompt
  return preset.prompt
}

// ---------------------------------------------------------------------------
// Generation context ref type (shared between provider & hook)
// ---------------------------------------------------------------------------

export interface GenContext {
  docType: DocType
  targetFile: string | null
  customPrompt: string
  maxSteps?: number
  compactionEnabled?: boolean
}

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

const DocsStateContext = createContext<DocsStateContextType | undefined>(undefined)

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

const DocsChatContext = createContext<DocsChatContextType | undefined>(undefined)

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
              compactionEnabled: ctx.compactionEnabled ?? false,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.fullName])

  const clearDocs = useCallback(() => {
    setGeneratedDocs([])
    setActiveDocId(null)
    setShowNewDoc(true)
    setMessages([])
    // setMessages is a stable ref from @ai-sdk/react useChat — does not need tracking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // sendMessage, setMessages, stop are stable refs from @ai-sdk/react useChat
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, status, error, isGenerating, setGenContext],
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
  if (context === undefined) {
    throw new Error('useDocs must be used within a DocsProvider')
  }
  return context
}

export function useDocsChat() {
  const context = useContext(DocsChatContext)
  if (context === undefined) {
    throw new Error('useDocsChat must be used within a DocsProvider')
  }
  return context
}
