"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import type { CodeIssue, FixSuggestion, ValidationResult } from '@/lib/code/issue-scanner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchProgress {
  completed: number
  total: number
  failed: number
  inProgress: boolean
}

interface BatchOperationsOptions {
  codeIndex: CodeIndex
  selectedProvider: string | undefined
  selectedModel: { id: string } | undefined
  apiKeys: Record<string, { key: string } | undefined>
  generateFix: (issue: CodeIssue, fileContent: string) => FixSuggestion | null
  validateFinding: (
    issue: CodeIssue,
    fileContent: string,
    options: { provider: string; model: string; apiKey: string },
  ) => Promise<ValidationResult>
  setFixCache: React.Dispatch<React.SetStateAction<Map<string, FixSuggestion | null>>>
  setShowFix: React.Dispatch<React.SetStateAction<Set<string>>>
  setValidationResults: React.Dispatch<React.SetStateAction<Map<string, ValidationResult>>>
}

const MAX_CONCURRENCY = 3

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBatchOperations({
  codeIndex,
  selectedProvider,
  selectedModel,
  apiKeys,
  generateFix,
  validateFinding,
  setFixCache,
  setShowFix,
  setValidationResults,
}: BatchOperationsOptions) {
  const [validationProgress, setValidationProgress] = useState<BatchProgress>({
    completed: 0, total: 0, failed: 0, inProgress: false,
  })
  const [fixProgress, setFixProgress] = useState<BatchProgress>({
    completed: 0, total: 0, failed: 0, inProgress: false,
  })

  const abortRef = useRef(false)

  // Cancel in-flight work on unmount
  useEffect(() => () => { abortRef.current = true }, [])

  // -----------------------------------------------------------------------
  // Batch validation (async, concurrency-limited)
  // -----------------------------------------------------------------------

  const batchValidate = useCallback(async (issues: CodeIssue[]) => {
    if (!selectedProvider || !selectedModel) return
    const apiKey = apiKeys[selectedProvider]?.key
    if (!apiKey) return

    const criticalHigh = issues.filter(
      (i) => i.severity === 'critical' || i.severity === 'warning',
    )
    if (criticalHigh.length === 0) return

    abortRef.current = false
    setValidationProgress({ completed: 0, total: criticalHigh.length, failed: 0, inProgress: true })

    let completed = 0
    let failed = 0

    // Semaphore-based concurrency limiter
    const queue = [...criticalHigh]
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const issue = queue.shift()!
        const file = codeIndex.files.get(issue.file)
        try {
          const result = await validateFinding(issue, file?.content ?? '', {
            provider: selectedProvider,
            model: selectedModel.id,
            apiKey,
          })
          if (abortRef.current) return
          setValidationResults((prev) => new Map(prev).set(issue.id, result))
        } catch (err) {
          failed++
          if (abortRef.current) return
          setValidationResults((prev) =>
            new Map(prev).set(issue.id, {
              issueId: issue.id,
              verdict: 'uncertain',
              confidence: 'low',
              reasoning: err instanceof Error ? err.message : 'Validation failed',
            }),
          )
        } finally {
          completed++
          if (abortRef.current) return
          setValidationProgress((prev) => ({
            ...prev,
            completed,
            failed,
          }))
        }
      }
    })

    await Promise.all(workers)
    if (abortRef.current) return
    setValidationProgress((prev) => ({ ...prev, inProgress: false }))
  }, [selectedProvider, selectedModel, apiKeys, codeIndex.files, validateFinding, setValidationResults])

  // -----------------------------------------------------------------------
  // Batch fix generation (synchronous)
  // -----------------------------------------------------------------------

  const batchGenerateFixes = useCallback((issues: CodeIssue[]) => {
    if (issues.length === 0) return

    setFixProgress({ completed: 0, total: issues.length, failed: 0, inProgress: true })

    let completed = 0
    let failed = 0
    const newFixes = new Map<string, FixSuggestion | null>()
    const idsWithFix = new Set<string>()

    for (const issue of issues) {
      const file = codeIndex.files.get(issue.file)
      if (file) {
        const fix = generateFix(issue, file.content)
        newFixes.set(issue.id, fix)
        if (fix) idsWithFix.add(issue.id)
      } else {
        newFixes.set(issue.id, null)
        failed++
      }
      completed++
    }

    // Merge into state in one batch
    setFixCache((prev) => {
      const next = new Map(prev)
      for (const [id, fix] of newFixes) next.set(id, fix)
      return next
    })
    setShowFix((prev) => {
      const next = new Set(prev)
      for (const id of idsWithFix) next.add(id)
      return next
    })

    setFixProgress({ completed, total: issues.length, failed, inProgress: false })
  }, [codeIndex.files, generateFix, setFixCache, setShowFix])

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  const cancelBatch = useCallback(() => {
    abortRef.current = true
  }, [])

  // -----------------------------------------------------------------------
  // API key check
  // -----------------------------------------------------------------------

  const hasValidApiKey = Boolean(
    selectedProvider && selectedModel && apiKeys[selectedProvider]?.key,
  )

  return {
    batchValidate,
    batchGenerateFixes,
    cancelBatch,
    validationProgress,
    fixProgress,
    hasValidApiKey,
  }
}
