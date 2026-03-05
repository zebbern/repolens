'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { searchIndex } from '@/lib/code/code-index'
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

/**
 * Format find-usages search results into markdown.
 */
function formatFindUsagesResult(
  symbolName: string,
  searchResults: ReturnType<typeof searchIndex>,
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
export function useInlineActions(codeIndex: CodeIndex): UseInlineActionsReturn {
  const [activeSymbol, setActiveSymbol] = useState<SymbolRange | null>(null)
  const [activeAction, setActiveAction] = useState<InlineActionType | null>(null)
  const [result, setResult] = useState<InlineActionResult | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Abort any in-flight stream
  const abort = useCallback(() => {
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

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
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
      // Abort any previous stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }

      setActiveSymbol(symbolRange)
      setActiveAction(action)

      // Find Usages: client-side only
      if (action === 'find-usages') {
        const searchResults = searchIndex(codeIndex, symbolRange.symbol.name)
        const content = formatFindUsagesResult(symbolRange.symbol.name, searchResults)
        setResult({
          type: 'find-usages',
          symbolName: symbolRange.symbol.name,
          content,
          isStreaming: false,
        })
        setIsStreaming(false)
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
          if (!response.ok) {
            const errorData = await response.json().catch(() => null)
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
            if (done) break

            accumulated += decoder.decode(value, { stream: true })
            setResult((prev) =>
              prev ? { ...prev, content: accumulated, isStreaming: true } : null,
            )
          }

          setResult((prev) =>
            prev ? { ...prev, content: accumulated, isStreaming: false } : null,
          )
          setIsStreaming(false)
          abortControllerRef.current = null
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') {
            // User-initiated abort — don't treat as error
            return
          }
          const errorMsg = error instanceof Error ? error.message : 'An error occurred'
          setResult((prev) =>
            prev ? { ...prev, isStreaming: false, error: errorMsg } : null,
          )
          setIsStreaming(false)
          abortControllerRef.current = null
        })
    },
    [codeIndex],
  )

  return {
    activeSymbol,
    activeAction,
    result,
    isStreaming,
    triggerAction,
    dismissAction,
    abort,
  }
}
