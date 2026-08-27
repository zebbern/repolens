"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { resolveFileContents } from '@/lib/code/code-index'
import type { CodeIssue, FixSuggestion, ValidationResult, ValidationOptions } from '@/lib/code/issue-scanner'
import type { AIProvider, ProviderModel, APIKeysState } from '@/types/types'
import type { RepositorySession } from '@/providers/repository-provider'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchProgress {
  completed: number
  total: number
  failed: number
  inProgress: boolean
  cancelled: boolean
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
  repositoryKey?: string
  repositorySession: RepositorySession | null
  isRepositorySessionCurrent: (session: RepositorySession | null) => boolean
}

const MAX_CONCURRENCY = 3
const IDLE_BATCH_PROGRESS: BatchProgress = {
  completed: 0,
  total: 0,
  failed: 0,
  inProgress: false,
  cancelled: false,
}

type BatchOperationKind = 'validation' | 'fix'

interface ActiveBatchOperation {
  id: number
  kind: BatchOperationKind
  controller: AbortController
  repositorySession: RepositorySession | null
}

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
  repositoryKey,
  repositorySession,
  isRepositorySessionCurrent,
}: BatchOperationsOptions) {
  const [validationProgress, setValidationProgress] = useState<BatchProgress>(IDLE_BATCH_PROGRESS)
  const [fixProgress, setFixProgress] = useState<BatchProgress>(IDLE_BATCH_PROGRESS)
  const mountedRef = useRef(true)
  const operationIdRef = useRef(0)
  const activeOperationRef = useRef<ActiveBatchOperation | null>(null)
  const previousRepositorySessionRef = useRef(repositorySession)
  const lifecycleGenerationRef = useRef(0)

  const setOperationProgress = useCallback((
    kind: BatchOperationKind,
    progress: React.SetStateAction<BatchProgress>,
  ) => {
    if (kind === 'validation') setValidationProgress(progress)
    else setFixProgress(progress)
  }, [])

  const cancelActiveOperation = useCallback(() => {
    const operation = activeOperationRef.current
    if (!operation) return

    operation.controller.abort()
    activeOperationRef.current = null
    setOperationProgress(operation.kind, previous => ({
      ...previous,
      inProgress: false,
      cancelled: true,
    }))
  }, [setOperationProgress])

  // Batch validation and fix generation intentionally share one global active slot.
  const beginOperation = useCallback((
    kind: BatchOperationKind,
    total: number,
    requestSession: RepositorySession | null,
  ): ActiveBatchOperation | null => {
    if (
      !mountedRef.current
      || activeOperationRef.current !== null
      || !isRepositorySessionCurrent(requestSession)
    ) return null

    const operation: ActiveBatchOperation = {
      id: ++operationIdRef.current,
      kind,
      controller: new AbortController(),
      repositorySession: requestSession,
    }
    activeOperationRef.current = operation
    setOperationProgress(kind, {
      completed: 0,
      total,
      failed: 0,
      inProgress: true,
      cancelled: false,
    })
    return operation
  }, [isRepositorySessionCurrent, setOperationProgress])

  const isOperationCurrent = useCallback((operation: ActiveBatchOperation) => (
    mountedRef.current
    && activeOperationRef.current?.id === operation.id
    && !operation.controller.signal.aborted
    && isRepositorySessionCurrent(operation.repositorySession)
  ), [isRepositorySessionCurrent])

  const finishOperation = useCallback((operation: ActiveBatchOperation) => {
    if (activeOperationRef.current?.id !== operation.id) return
    activeOperationRef.current = null
    if (!mountedRef.current) return

    setOperationProgress(operation.kind, previous => ({
      ...previous,
      inProgress: false,
      cancelled: operation.controller.signal.aborted
        || !isRepositorySessionCurrent(operation.repositorySession),
    }))
  }, [isRepositorySessionCurrent, setOperationProgress])

  // Repository replacement and final unmount cancel the single active operation.
  useEffect(() => {
    mountedRef.current = true
    const lifecycleGeneration = ++lifecycleGenerationRef.current
    if (previousRepositorySessionRef.current !== repositorySession) {
      previousRepositorySessionRef.current = repositorySession
      queueMicrotask(() => {
        if (
          !mountedRef.current
          || lifecycleGenerationRef.current !== lifecycleGeneration
          || activeOperationRef.current !== null
        ) return
        setValidationProgress(IDLE_BATCH_PROGRESS)
        setFixProgress(IDLE_BATCH_PROGRESS)
      })
    }

    return () => {
      mountedRef.current = false
      cancelActiveOperation()
    }
  }, [repositorySession, cancelActiveOperation])

  // -----------------------------------------------------------------------
  // Batch validation (async, concurrency-limited)
  // -----------------------------------------------------------------------

  const batchValidate = useCallback(async (issues: CodeIssue[]) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    if (!selectedProvider || !selectedModel) return
    const apiKey = apiKeys[selectedProvider]?.key
    if (!apiKey) return

    const criticalHigh = issues.filter(
      (i) => i.severity === 'critical' || i.severity === 'warning',
    )
    if (criticalHigh.length === 0) return

    const operation = beginOperation('validation', criticalHigh.length, requestSession)
    if (!operation) return
    if (!requestSession) return

    let completed = 0
    let failed = 0

    try {
      const uniquePaths = [...new Set(criticalHigh.map(issue => issue.file))]
      let resolvedContents = new Map<string, string>()
      let resolutionError: unknown
      try {
        resolvedContents = (await resolveFileContents(codeIndex, uniquePaths)).contents
      } catch (error) {
        resolutionError = error
      }
      if (!isOperationCurrent(operation)) return

      // Semaphore-based concurrency limiter
      const queue = [...criticalHigh]
      const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0 && isOperationCurrent(operation)) {
          const issue = queue.shift()!
          try {
            if (resolutionError) {
              throw new Error(`File content loading failed for ${issue.file}: ${resolutionError instanceof Error ? resolutionError.message : 'Unknown error'}`)
            }
            const content = resolvedContents.get(issue.file)
            if (typeof content !== 'string') {
              throw new Error(`File content unavailable for ${issue.file}`)
            }
            const result = await validateFinding(issue, content, {
              provider: selectedProvider,
              model: selectedModel.id,
              apiKey,
              repositoryKey,
              repositorySessionId: String(requestSession.id),
              signal: operation.controller.signal,
            })
            if (!isOperationCurrent(operation)) return
            setValidationResults((prev) => new Map(prev).set(issue.id, result))
          } catch (err) {
            if (!isOperationCurrent(operation)) return
            failed++
            setValidationResults((prev) =>
              new Map(prev).set(issue.id, {
                issueId: issue.id,
                verdict: 'uncertain',
                confidence: 'low',
                reasoning: err instanceof Error ? err.message : 'Validation failed',
              }),
            )
          } finally {
            if (!isOperationCurrent(operation)) return
            completed++
            setValidationProgress((prev) => ({ ...prev, completed, failed }))
          }
        }
      })

      await Promise.all(workers)
    } finally {
      finishOperation(operation)
    }
  }, [selectedProvider, selectedModel, apiKeys, codeIndex, validateFinding, setValidationResults, repositoryKey, repositorySession, isRepositorySessionCurrent, beginOperation, finishOperation, isOperationCurrent])

  // -----------------------------------------------------------------------
  // Batch fix generation (async — fetches content from contentStore)
  // -----------------------------------------------------------------------

  const batchGenerateFixes = useCallback(async (issues: CodeIssue[]) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    if (issues.length === 0) return

    const operation = beginOperation('fix', issues.length, requestSession)
    if (!operation) return

    let completed = 0
    let failed = 0

    try {
      // Pre-fetch all unique file contents in one batch
      const uniquePaths = [...new Set(issues.map(i => i.file))]
      let contentMap: Map<string, string>
      try {
        contentMap = (await resolveFileContents(codeIndex, uniquePaths)).contents
      } catch {
        contentMap = new Map()
      }
      if (!isOperationCurrent(operation)) return

      const newFixes = new Map<string, FixSuggestion | null>()
      const idsWithFix = new Set<string>()

      for (const issue of issues) {
        if (!isOperationCurrent(operation)) return
        const content = contentMap.get(issue.file)
        try {
          if (typeof content !== 'string') throw new Error('File content unavailable')
          const fix = generateFix(issue, content)
          newFixes.set(issue.id, fix)
          if (fix) idsWithFix.add(issue.id)
        } catch {
          newFixes.set(issue.id, null)
          failed++
        }
        completed++
        setFixProgress(previous => ({ ...previous, completed, failed }))
      }

      if (!isOperationCurrent(operation)) return
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
    } finally {
      finishOperation(operation)
    }
  }, [codeIndex, generateFix, setFixCache, setShowFix, repositorySession, isRepositorySessionCurrent, beginOperation, finishOperation, isOperationCurrent])

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  const cancelBatch = useCallback(() => {
    cancelActiveOperation()
  }, [cancelActiveOperation])

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
