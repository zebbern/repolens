"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { getFileContent } from '@/lib/code/code-index'
import type { CodeIssue, FixSuggestion, ValidationResult, ValidationOptions } from '@/lib/code/issue-scanner'
import type { AIProvider, ProviderModel, APIKeysState } from '@/types/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchProgress {
  completed: number
  total: number
  failed: number
  inProgress: boolean
}

export interface BatchOperationsOptions {
  codeIndex: CodeIndex
  selectedProvider: AIProvider | null
  selectedModel: ProviderModel | null
  apiKeys: APIKeysState
  generateFix: (issue: CodeIssue, fileContent: string) => FixSuggestion | null
  validateFinding: (
    issue: CodeIssue,
    fileContent: string,
    options: ValidationOptions,
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
        try {
          const content = await getFileContent(codeIndex, issue.file) ?? ''
          const result = await validateFinding(issue, content, {
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
  }, [selectedProvider, selectedModel, apiKeys, codeIndex, validateFinding, setValidationResults])

  // -----------------------------------------------------------------------
  // Batch fix generation (async — fetches content from contentStore)
  // -----------------------------------------------------------------------

  const batchGenerateFixes = useCallback(async (issues: CodeIssue[]) => {
    if (issues.length === 0) return

    setFixProgress({ completed: 0, total: issues.length, failed: 0, inProgress: true })

    // Pre-fetch all unique file contents in one batch
    const uniquePaths = [...new Set(issues.map(i => i.file))]
    const contentMap = await codeIndex.contentStore.getBatch(uniquePaths)

    let completed = 0
    let failed = 0
    const newFixes = new Map<string, FixSuggestion | null>()
    const idsWithFix = new Set<string>()

    for (const issue of issues) {
      const content = codeIndex.files.get(issue.file)?.content ?? contentMap.get(issue.file) ?? null
      if (content) {
        const fix = generateFix(issue, content)
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
  }, [codeIndex, generateFix, setFixCache, setShowFix])

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
