import { useRef, useEffect } from 'react'
import { useChangelog, useChangelogChat } from '@/providers/changelog-provider'
import {
  CHANGELOG_PRESETS,
  buildChangelogPrompt,
  type ChangelogGenContext,
  type GeneratedChangelog,
} from '@/providers/changelog-provider'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** Return value of {@link useChangelogEngine}. */
export interface ChangelogEngineReturn {
  /** All generated changelogs, newest first. */
  generatedChangelogs: GeneratedChangelog[]
  /** Current chat messages from the active generation session. */
  messages: ReturnType<typeof useChangelogChat>['messages']
  /** Chat status: `'ready'` | `'submitted'` | `'streaming'`. */
  status: ReturnType<typeof useChangelogChat>['status']
  /** Error from the last generation attempt, if any. */
  error: Error | null | undefined
  /** Whether a generation is currently in progress. */
  isGenerating: boolean
  /** Abort the current generation. */
  stop: () => void
  /**
   * Start a new changelog generation.
   *
   * Validates inputs, snapshots context, clears prior messages, and sends
   * the prompt with a short delay to let React flush state.
   */
  handleGenerate: (
    preset: (typeof CHANGELOG_PRESETS)[number],
    fromRef: string,
    toRef: string,
    customPrompt: string,
    commitData?: string,
    maxSteps?: number,
    compactionEnabled?: boolean,
    activeSkills?: string[],
  ) => void
  /**
   * Regenerate a changelog from an existing {@link GeneratedChangelog}.
   *
   * Looks up the original preset, restores the generation context, and
   * re-sends the prompt.
   */
  handleRegenerate: (changelog: GeneratedChangelog) => void
  /**
   * Delete a generated changelog by ID.
   *
   * If the deleted changelog was the active one, resets to the new form.
   */
  handleDeleteChangelog: (id: string) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Orchestrates changelog generation lifecycle.
 *
 * Bridges `useChangelog()` (state) and `useChangelogChat()` (chat) contexts to
 * manage the full generation workflow: context setup, message sending,
 * completion handling, and changelog persistence.
 *
 * UI-only state (selectedPreset, customPrompt, refs, etc.) stays local
 * to the changelog viewer — this hook only manages the generation engine.
 */
export function useChangelogEngine(): ChangelogEngineReturn {
  const {
    generatedChangelogs,
    setGeneratedChangelogs,
    activeChangelogId,
    setActiveChangelogId,
    setShowNewChangelog,
  } = useChangelog()

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    stop,
    error,
    isGenerating,
    setGenContext,
  } = useChangelogChat()

  // --- Refs for stale-closure avoidance ---
  const genContextRef = useRef<ChangelogGenContext>({
    changelogType: 'conventional',
    fromRef: '',
    toRef: '',
    customPrompt: '',
  })
  const isSubmittingRef = useRef(false)
  const hasSavedRef = useRef(false)
  const currentChangelogIdRef = useRef<string | null>(null)
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

  // --- When generation completes, save the changelog ---
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

      // If we already saved this cycle, UPDATE the existing changelog with latest messages
      if (hasSavedRef.current && currentChangelogIdRef.current) {
        setGeneratedChangelogs(prev =>
          prev.map(c =>
            c.id === currentChangelogIdRef.current
              ? { ...c, messages: [...messages] }
              : c,
          ),
        )
        prevStatus.current = status
        return
      }

      // First save in this cycle — create the changelog
      hasSavedRef.current = true
      isSubmittingRef.current = false
      const ctx = genContextRef.current
      const preset = CHANGELOG_PRESETS.find(p => p.id === ctx.changelogType)
      const changelogId = `changelog-${Date.now()}`
      currentChangelogIdRef.current = changelogId
      const title = buildChangelogTitle(ctx, preset?.label)

      const newChangelog: GeneratedChangelog = {
        id: changelogId,
        type: ctx.changelogType,
        title,
        messages: [...messages],
        createdAt: new Date(),
        fromRef: ctx.fromRef || undefined,
        toRef: ctx.toRef || undefined,
        customPrompt: ctx.customPrompt || undefined,
        commitData: ctx.commitData,
        maxSteps: ctx.maxSteps,
        compactionEnabled: ctx.compactionEnabled,
        activeSkills: ctx.activeSkills,
      }

      setGeneratedChangelogs(prev => [newChangelog, ...prev])
      setActiveChangelogId(changelogId)
      setShowNewChangelog(false)
    }
    prevStatus.current = status
  }, [status, messages, setGeneratedChangelogs, setActiveChangelogId, setShowNewChangelog])

  // --- Shared generation logic ---

  /**
   * Initiates a generation cycle: snapshots context, clears messages,
   * builds the prompt, and schedules the send with a short delay.
   */
  const dispatchGeneration = (
    preset: (typeof CHANGELOG_PRESETS)[number],
    fromRef: string,
    toRef: string,
    customPrompt: string,
    commitData?: string,
    maxSteps?: number,
    compactionEnabled?: boolean,
    activeSkills?: string[],
  ) => {
    const ctx: ChangelogGenContext = {
      changelogType: preset.id,
      fromRef,
      toRef,
      customPrompt,
      commitData,
      maxSteps,
      compactionEnabled: compactionEnabled ?? false,
      ...(activeSkills && activeSkills.length > 0 ? { activeSkills } : {}),
    }
    genContextRef.current = ctx
    setGenContext(ctx)
    setMessages([])

    const prompt = buildChangelogPrompt(preset, fromRef, toRef, customPrompt)

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    isSubmittingRef.current = true
    hasSavedRef.current = false
    currentChangelogIdRef.current = null
    sendTimerRef.current = setTimeout(() => {
      sendMessage({ text: prompt })
      isSubmittingRef.current = false
    }, 50)
  }

  // --- Actions ---

  const handleGenerate: ChangelogEngineReturn['handleGenerate'] = (
    preset,
    fromRef,
    toRef,
    customPrompt,
    commitData,
    maxSteps,
    compactionEnabled,
    activeSkills,
  ) => {
    if (isGenerating || isSubmittingRef.current) return
    dispatchGeneration(preset, fromRef, toRef, customPrompt, commitData, maxSteps, compactionEnabled, activeSkills)
  }

  const handleRegenerate: ChangelogEngineReturn['handleRegenerate'] = (changelog) => {
    if (isGenerating || isSubmittingRef.current) return

    const preset = CHANGELOG_PRESETS.find(p => p.id === changelog.type)
    if (!preset) return

    setShowNewChangelog(true)
    setActiveChangelogId(null)
    dispatchGeneration(
      preset,
      changelog.fromRef || '',
      changelog.toRef || '',
      changelog.customPrompt || '',
      changelog.commitData,
      changelog.maxSteps,
      changelog.compactionEnabled,
      changelog.activeSkills,
    )
  }

  const handleDeleteChangelog: ChangelogEngineReturn['handleDeleteChangelog'] = (id) => {
    setGeneratedChangelogs(prev => prev.filter(c => c.id !== id))
    if (activeChangelogId === id) {
      setActiveChangelogId(null)
      setShowNewChangelog(true)
    }
  }

  return {
    // State
    generatedChangelogs,
    messages,
    status,
    error,
    isGenerating,
    stop,
    // Actions
    handleGenerate,
    handleRegenerate,
    handleDeleteChangelog,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a display title for a generated changelog based on generation context.
 *
 * - Custom prompts use the first 50 characters of the user's prompt.
 * - All others use the preset label with the ref range appended.
 */
function buildChangelogTitle(ctx: ChangelogGenContext, presetLabel?: string): string {
  if (ctx.changelogType === 'custom' && ctx.customPrompt) {
    return ctx.customPrompt.slice(0, 50) + (ctx.customPrompt.length > 50 ? '...' : '')
  }

  const rangeLabel = ctx.fromRef && ctx.toRef
    ? ` (${ctx.fromRef}..${ctx.toRef})`
    : ''

  return (presetLabel || 'Changelog') + rangeLabel
}
