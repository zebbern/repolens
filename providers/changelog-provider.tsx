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
import type { ChangelogGenContext, GeneratedChangelog } from '@/lib/changelog'

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

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ChangelogProvider({ children }: { children: ReactNode }) {
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const { repo, files, codeIndex } = useRepository()

  const hasValidKey = getValidProviders().length > 0 && selectedModel

  // --- Changelog state ---
  const [generatedChangelogs, setGeneratedChangelogs] = useState<GeneratedChangelog[]>([])
  const [activeChangelogId, setActiveChangelogId] = useState<string | null>(null)
  const [showNewChangelog, setShowNewChangelog] = useState(true)

  // --- Generation context ref (shared with transport) ---
  const genContextRef = useRef<ChangelogGenContext>({
    changelogType: 'conventional',
    fromRef: '',
    toRef: '',
    customPrompt: '',
  })

  const setGenContext = useCallback((ctx: ChangelogGenContext) => {
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
  // Use refs for all dynamic values so a single stable transport
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
        api: '/api/changelog/generate',
        prepareSendMessagesRequest: ({ messages }) => {
          const model = selectedModelRef.current
          const keys = apiKeysRef.current
          const repoCtx = repoContextRef.current
          const ctx = genContextRef.current

          if (!model || !repoCtx) {
            throw new Error('Model or repository not ready for changelog generation')
          }

          const structuralIndex = buildStructuralIndex(codeIndexRef.current, { maxIndexBytes: getMaxIndexBytesForModel(model.id) })

          return {
            body: {
              messages,
              provider: model.provider,
              model: model.id,
              apiKey: keys[model.provider].key,
              changelogType: ctx.changelogType,
              repoContext: repoCtx,
              structuralIndex,
              fromRef: ctx.fromRef,
              toRef: ctx.toRef,
              commitData: ctx.commitData,
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
    id: 'changelog-generator',

    onToolCall: async ({ toolCall }): Promise<void> => handleToolCall(toolCall, addToolOutput, codeIndexRef, allFilePathsRef.current),

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isGenerating = status === 'streaming' || status === 'submitted'

  // --- Clear changelogs on repo change ---
  const prevRepoRef = useRef(repo?.fullName)
  useEffect(() => {
    if (prevRepoRef.current && prevRepoRef.current !== repo?.fullName) {
      setGeneratedChangelogs([])
      setActiveChangelogId(null)
      setShowNewChangelog(true)
      setMessages([])
    }
    prevRepoRef.current = repo?.fullName
  }, [repo?.fullName, setMessages])

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
