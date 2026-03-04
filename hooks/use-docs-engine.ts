import { useRef, useEffect } from 'react'
import { useDocs, useDocsChat } from '@/providers/docs-provider'
import {
  DOC_PRESETS,
  buildDocPrompt,
  type DocType,
  type GeneratedDoc,
  type GenContext,
} from '@/providers/docs-provider'

/**
 * Encapsulates doc generation orchestration — starting, completing, and
 * deleting generations.  Uses both `useDocs()` (state) and `useDocsChat()`
 * (chat) contexts so it can bridge the two.
 *
 * UI-only state (selectedPreset, customPrompt, targetFile, etc.) stays local
 * to DocViewer.
 */
export function useDocsEngine() {
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
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    }
  }, [])

  // --- When generation completes, save the doc ---
  const prevStatus = useRef(status)
  useEffect(() => {
    if (
      (prevStatus.current === 'streaming' || prevStatus.current === 'submitted') &&
      status === 'ready' &&
      messages.length > 0
    ) {
      isSubmittingRef.current = false
      const ctx = genContextRef.current
      const preset = DOC_PRESETS.find(p => p.id === ctx.docType)
      const docId = `doc-${Date.now()}`
      const title =
        ctx.docType === 'file-explanation' && ctx.targetFile
          ? `${ctx.targetFile.split('/').pop()} Explained`
          : ctx.docType === 'custom'
            ? ctx.customPrompt.slice(0, 50) + (ctx.customPrompt.length > 50 ? '...' : '')
            : preset?.label || 'Documentation'

      const newDoc: GeneratedDoc = {
        id: docId,
        type: ctx.docType,
        title,
        messages: [...messages],
        createdAt: new Date(),
        targetFile: ctx.targetFile || undefined,
        customPrompt: ctx.customPrompt || undefined,
        maxSteps: ctx.maxSteps,
      }

      setGeneratedDocs(prev => [newDoc, ...prev])
      setActiveDocId(docId)
      setShowNewDoc(false)
    }
    prevStatus.current = status
  }, [status, messages, setGeneratedDocs, setActiveDocId, setShowNewDoc])

  // --- Actions ---

  const handleGenerate = (
    preset: (typeof DOC_PRESETS)[number],
    targetFile: string | null,
    customPrompt: string,
    maxSteps?: number,
    compactionEnabled?: boolean,
  ) => {
    if (isGenerating || isSubmittingRef.current) return

    // Snapshot context into ref before sending
    const ctx: GenContext = {
      docType: preset.id,
      targetFile,
      customPrompt,
      maxSteps,
      compactionEnabled: compactionEnabled ?? false,
    }
    genContextRef.current = ctx
    setGenContext(ctx) // also push to provider ref for transport

    setMessages([])

    const prompt = buildDocPrompt(preset, targetFile, customPrompt)

    // Let React flush setMessages([]) before sending
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    isSubmittingRef.current = true
    sendTimerRef.current = setTimeout(() => {
      sendMessage({ text: prompt })
      isSubmittingRef.current = false
    }, 50)
  }

  const handleRegenerate = (doc: GeneratedDoc) => {
    if (isGenerating || isSubmittingRef.current) return

    const preset = DOC_PRESETS.find(p => p.id === doc.type)
    if (!preset) return

    setShowNewDoc(true)
    setActiveDocId(null)

    const ctx: GenContext = {
      docType: doc.type,
      targetFile: doc.targetFile || null,
      customPrompt: doc.customPrompt || '',
      maxSteps: doc.maxSteps,
    }
    genContextRef.current = ctx
    setGenContext(ctx)

    setMessages([])

    const prompt = buildDocPrompt(preset, doc.targetFile || null, doc.customPrompt || '')

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    isSubmittingRef.current = true
    sendTimerRef.current = setTimeout(() => {
      sendMessage({ text: prompt })
      isSubmittingRef.current = false
    }, 50)
  }

  const handleDeleteDoc = (id: string) => {
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
