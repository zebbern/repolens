import { useRef, useEffect } from 'react'
import { useDocs, useDocsChat } from '@/providers/docs-provider'
import {
  DOC_PRESETS,
  buildDocPrompt,
  type DocType,
  type GeneratedDoc,
  type GenContext,
} from '@/providers/docs-provider'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** Return value of {@link useDocsEngine}. */
export interface DocsEngineReturn {
  /** All generated documentation entries, newest first. */
  generatedDocs: GeneratedDoc[]
  /** Current chat messages from the active generation session. */
  messages: ReturnType<typeof useDocsChat>['messages']
  /** Chat status: `'ready'` | `'submitted'` | `'streaming'`. */
  status: ReturnType<typeof useDocsChat>['status']
  /** Error from the last generation attempt, if any. */
  error: Error | null | undefined
  /** Whether a generation is currently in progress. */
  isGenerating: boolean
  /** Abort the current generation. */
  stop: () => void
  /**
   * Start a new documentation generation.
   *
   * Validates inputs, snapshots context, clears prior messages, and sends
   * the prompt with a short delay to let React flush state.
   */
  handleGenerate: (
    preset: (typeof DOC_PRESETS)[number],
    targetFile: string | null,
    customPrompt: string,
    maxSteps?: number,
    compactionEnabled?: boolean,
    activeSkills?: string[],
  ) => void
  /**
   * Regenerate documentation from an existing {@link GeneratedDoc}.
   *
   * Looks up the original preset, restores the generation context, and
   * re-sends the prompt.
   */
  handleRegenerate: (doc: GeneratedDoc) => void
  /**
   * Delete a generated doc by ID.
   *
   * If the deleted doc was the active doc, resets to the new-doc form.
   */
  handleDeleteDoc: (id: string) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Orchestrates documentation generation lifecycle.
 *
 * Bridges `useDocs()` (state) and `useDocsChat()` (chat) contexts to manage
 * the full generation workflow: context setup, message sending, completion
 * handling, and doc persistence.
 *
 * UI-only state (selectedPreset, customPrompt, targetFile, etc.) stays local
 * to DocViewer — this hook only manages the generation engine.
 */
export function useDocsEngine(): DocsEngineReturn {
  const {
    generatedDocs,
    setGeneratedDocs,
    activeDocId,
    setActiveDocId,
    setShowNewDoc,
  } = useDocs()

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    stop,
    error,
    isGenerating,
    setGenContext,
  } = useDocsChat()

  // --- Refs for stale-closure avoidance ---
  const genContextRef = useRef<GenContext>({
    docType: 'architecture',
    targetFile: null,
    customPrompt: '',
  })
  const isSubmittingRef = useRef(false)
  const hasSavedRef = useRef(false)
  const currentDocIdRef = useRef<string | null>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup timer and abort in-flight generation on unmount
  useEffect(() => {
    return () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
      if (isSubmittingRef.current || status === 'streaming' || status === 'submitted') {
        stop()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- When generation completes, save the doc ---
  const prevStatus = useRef(status)
  useEffect(() => {
    if (
      (prevStatus.current === 'streaming' || prevStatus.current === 'submitted') &&
      status === 'ready' &&
      messages.length > 0
    ) {
      // Skip intermediate ready transitions where tool calls are still pending
      const lastMsg = messages[messages.length - 1]
      const hasPendingToolCalls =
        lastMsg?.role === 'assistant' &&
        Array.isArray(lastMsg?.parts) &&
        lastMsg.parts.some(
          (p: { type: string; state?: string }) => p.type === 'tool-invocation' && p.state !== 'result',
        )
      if (hasPendingToolCalls) {
        prevStatus.current = status
        return
      }

      // If we already saved this cycle, UPDATE the existing doc with latest messages
      if (hasSavedRef.current && currentDocIdRef.current) {
        setGeneratedDocs(prev =>
          prev.map(d =>
            d.id === currentDocIdRef.current
              ? { ...d, messages: [...messages] }
              : d,
          ),
        )
        prevStatus.current = status
        return
      }

      // First save in this cycle — create the doc
      hasSavedRef.current = true
      isSubmittingRef.current = false
      const ctx = genContextRef.current
      const preset = DOC_PRESETS.find(p => p.id === ctx.docType)
      const docId = `doc-${Date.now()}`
      currentDocIdRef.current = docId
      const title = buildDocTitle(ctx, preset?.label)

      const newDoc: GeneratedDoc = {
        id: docId,
        type: ctx.docType,
        title,
        messages: [...messages],
        createdAt: new Date(),
        targetFile: ctx.targetFile || undefined,
        customPrompt: ctx.customPrompt || undefined,
        maxSteps: ctx.maxSteps,
        activeSkills: ctx.activeSkills,
      }

      setGeneratedDocs(prev => [newDoc, ...prev])
      setActiveDocId(docId)
      setShowNewDoc(false)
    }
    prevStatus.current = status
  }, [status, messages, setGeneratedDocs, setActiveDocId, setShowNewDoc])

  // --- Shared generation logic ---

  /**
   * Initiates a generation cycle: snapshots context, clears messages,
   * builds the prompt, and schedules the send with a short delay.
   */
  const dispatchGeneration = (
    preset: (typeof DOC_PRESETS)[number],
    targetFile: string | null,
    customPrompt: string,
    maxSteps?: number,
    compactionEnabled?: boolean,
    activeSkills?: string[],
  ) => {
    const ctx: GenContext = {
      docType: preset.id,
      targetFile,
      customPrompt,
      maxSteps,
      compactionEnabled: compactionEnabled ?? false,
      ...(activeSkills && activeSkills.length > 0 ? { activeSkills } : {}),
    }
    genContextRef.current = ctx
    setGenContext(ctx)
    setMessages([])

    const prompt = buildDocPrompt(preset, targetFile, customPrompt)

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    isSubmittingRef.current = true
    hasSavedRef.current = false
    currentDocIdRef.current = null
    sendTimerRef.current = setTimeout(() => {
      sendMessage({ text: prompt })
      isSubmittingRef.current = false
    }, 50)
  }

  // --- Actions ---

  const handleGenerate: DocsEngineReturn['handleGenerate'] = (
    preset,
    targetFile,
    customPrompt,
    maxSteps,
    compactionEnabled,
    activeSkills,
  ) => {
    if (isGenerating || isSubmittingRef.current) return
    dispatchGeneration(preset, targetFile, customPrompt, maxSteps, compactionEnabled, activeSkills)
  }

  const handleRegenerate: DocsEngineReturn['handleRegenerate'] = (doc) => {
    if (isGenerating || isSubmittingRef.current) return

    const preset = DOC_PRESETS.find(p => p.id === doc.type)
    if (!preset) return

    setShowNewDoc(true)
    setActiveDocId(null)
    dispatchGeneration(
      preset,
      doc.targetFile || null,
      doc.customPrompt || '',
      doc.maxSteps,
      undefined,
      doc.activeSkills,
    )
  }

  const handleDeleteDoc: DocsEngineReturn['handleDeleteDoc'] = (id) => {
    setGeneratedDocs(prev => prev.filter(d => d.id !== id))
    if (activeDocId === id) {
      setActiveDocId(null)
      setShowNewDoc(true)
    }
  }

  return {
    // State
    generatedDocs,
    messages,
    status,
    error,
    isGenerating,
    stop,
    // Actions
    handleGenerate,
    handleRegenerate,
    handleDeleteDoc,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a display title for a generated doc based on generation context.
 *
 * - File explanations use the filename.
 * - Custom prompts use the first 50 characters of the user's prompt.
 * - All others use the preset label.
 */
function buildDocTitle(ctx: GenContext, presetLabel?: string): string {
  if (ctx.docType === 'file-explanation' && ctx.targetFile) {
    return `${ctx.targetFile.split('/').pop()} Explained`
  }
  if (ctx.docType === 'custom') {
    return ctx.customPrompt.slice(0, 50) + (ctx.customPrompt.length > 50 ? '...' : '')
  }
  return presetLabel || 'Documentation'
}
