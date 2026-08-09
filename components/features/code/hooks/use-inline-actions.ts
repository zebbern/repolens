'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { searchIndexAsync, type SearchResult } from '@/lib/code/code-index'
import type { RepositorySession } from '@/providers/repository-provider'
import type { InlineActionType, InlineActionResult, SymbolRange } from '../types'

interface UseInlineActionsReturn {
  activeSymbol: SymbolRange | null
  activeAction: InlineActionType | null
  result: InlineActionResult | null
  isStreaming: boolean
  triggerAction: (
    action: InlineActionType,
    symbolRange: SymbolRange,
    fileContent: string,
    filePath: string,
    language: string,
    apiKey: string,
    provider: string,
    model: string,
  ) => void
  dismissAction: () => void
  abort: () => void
}

interface InlineActionSessionGuard {
  repositorySession: RepositorySession | null
  isRepositorySessionCurrent: (session: RepositorySession | null) => boolean
}

/**
 * Format find-usages search results into markdown.
 */
function formatFindUsagesResult(
  symbolName: string,
  searchResults: SearchResult[],
): string {
  if (searchResults.length === 0) {
    return `No usages of \`${symbolName}\` found in the codebase.`
  }

  const totalMatches = searchResults.reduce((sum, r) => sum + r.matches.length, 0)
  let md = `Found **${totalMatches}** usage${totalMatches === 1 ? '' : 's'} of \`${symbolName}\` across **${searchResults.length}** file${searchResults.length === 1 ? '' : 's'}:\n\n`

  for (const fileResult of searchResults) {
    md += `### \`${fileResult.file}\`\n`
    for (const match of fileResult.matches) {
      md += `- **Line ${match.line}**: \`${match.content.trim()}\`\n`
    }
    md += '\n'
  }

  return md
}

/**
 * Hook managing inline code action state, streaming, and abort.
 *
 * - For 'find-usages': searches the CodeIndex client-side (no AI call)
 * - For 'explain', 'refactor', 'complexity': streams AI response from /api/inline-actions
 */
export function useInlineActions(
  codeIndex: CodeIndex,
  sessionGuard?: InlineActionSessionGuard,
): UseInlineActionsReturn {
  const [activeSymbol, setActiveSymbol] = useState<SymbolRange | null>(null)
  const [activeAction, setActiveAction] = useState<InlineActionType | null>(null)
  const [result, setResult] = useState<InlineActionResult | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [stateSession, setStateSession] = useState<RepositorySession | null>(sessionGuard?.repositorySession ?? null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const actionGenerationRef = useRef(0)
  const mountedRef = useRef(true)

  // Abort any in-flight stream
  const abort = useCallback(() => {
    actionGenerationRef.current += 1
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
  }, [])

  // Dismiss: abort + clear state
  const dismissAction = useCallback(() => {
    abort()
    setActiveSymbol(null)
    setActiveAction(null)
    setResult(null)
  }, [abort])

  // Invalidate work from the previous repository session.
  useEffect(() => {
    actionGenerationRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [sessionGuard?.repositorySession])

  // Clean up on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      actionGenerationRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  const triggerAction = useCallback(
    (
      action: InlineActionType,
      symbolRange: SymbolRange,
      fileContent: string,
      filePath: string,
      language: string,
      apiKey: string,
      provider: string,
      model: string,
    ) => {
      const actionGeneration = actionGenerationRef.current + 1
      actionGenerationRef.current = actionGeneration
      const actionSession = sessionGuard?.repositorySession ?? null
      setStateSession(actionSession)
      const canCommit = () => (
        mountedRef.current
        && actionGenerationRef.current === actionGeneration
        && (!sessionGuard || sessionGuard.isRepositorySessionCurrent(actionSession))
      )

      // Abort any previous stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }

      setActiveSymbol(symbolRange)
      setActiveAction(action)

      // Find Usages: client-side only
      if (action === 'find-usages') {
        setIsStreaming(true)
        void searchIndexAsync(codeIndex, symbolRange.symbol.name)
          .then(searchResults => {
            if (!canCommit()) return
            const content = formatFindUsagesResult(symbolRange.symbol.name, searchResults)
            setResult({
              type: 'find-usages',
              symbolName: symbolRange.symbol.name,
              content,
              isStreaming: false,
            })
          })
          .catch(error => {
            if (!canCommit()) return
            setResult({
              type: 'find-usages',
              symbolName: symbolRange.symbol.name,
              content: '',
              isStreaming: false,
              error: error instanceof Error ? error.message : 'Search failed',
            })
          })
          .finally(() => {
            if (canCommit()) setIsStreaming(false)
          })
        return
      }

      // AI actions: stream from API
      const controller = new AbortController()
      abortControllerRef.current = controller

      // Extract symbol source code from file content
      const lines = fileContent.split('\n')
      const symbolCode = lines
        .slice(symbolRange.startLine - 1, symbolRange.endLine)
        .join('\n')

      setResult({
        type: action,
        symbolName: symbolRange.symbol.name,
        content: '',
        isStreaming: true,
      })
      setIsStreaming(true)

      const body = JSON.stringify({
        action,
        symbolCode,
        symbolName: symbolRange.symbol.name,
        symbolKind: symbolRange.symbol.kind,
        filePath,
        language,
        provider,
        model,
        apiKey,
      })

      fetch('/api/inline-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!canCommit()) return
          if (!response.ok) {
            const errorData = await response.json().catch(() => null)
            if (!canCommit()) return
            const errorMsg = errorData?.error?.message ?? `Request failed (${response.status})`
            setResult((prev) =>
              prev ? { ...prev, content: '', isStreaming: false, error: errorMsg } : null,
            )
            setIsStreaming(false)
            return
          }

          const reader = response.body?.getReader()
          if (!reader) {
            setResult((prev) =>
              prev ? { ...prev, isStreaming: false, error: 'No response stream' } : null,
            )
            setIsStreaming(false)
            return
          }

          const decoder = new TextDecoder()
          let accumulated = ''

          while (true) {
            const { done, value } = await reader.read()
            if (!canCommit()) return
            if (done) break

            accumulated += decoder.decode(value, { stream: true })
            setResult((prev) =>
              prev ? { ...prev, content: accumulated, isStreaming: true } : null,
            )
          }

          setResult((prev) =>
            prev ? { ...prev, content: accumulated, isStreaming: false } : null,
          )
        })
        .catch((error: unknown) => {
          if (!canCommit()) return
          if (error instanceof Error && error.name === 'AbortError') {
            // User-initiated abort — don't treat as error
            return
          }
          const errorMsg = error instanceof Error ? error.message : 'An error occurred'
          setResult((prev) =>
            prev ? { ...prev, isStreaming: false, error: errorMsg } : null,
          )
        })
        .finally(() => {
          if (!canCommit()) return
          setIsStreaming(false)
          if (abortControllerRef.current === controller) abortControllerRef.current = null
        })
    },
    [codeIndex, sessionGuard],
  )

  const stateBelongsToCurrentSession = !sessionGuard
    || sessionGuard.isRepositorySessionCurrent(stateSession)

  return {
    activeSymbol: stateBelongsToCurrentSession ? activeSymbol : null,
    activeAction: stateBelongsToCurrentSession ? activeAction : null,
    result: stateBelongsToCurrentSession ? result : null,
    isStreaming: stateBelongsToCurrentSession && isStreaming,
    triggerAction,
    dismissAction,
    abort,
  }
}
