"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react"
import type {
  PRMetadata,
  PRFile,
  PRReviewStatus,
} from "@/types/pr-review"
import {
  fetchPullsViaProxy,
  fetchPullRequestViaProxy,
  fetchPullRequestFilesViaProxy,
} from "@/lib/github/client"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// State context (infrequently changing)
// ---------------------------------------------------------------------------

interface PRReviewStateContextType {
  pr: PRMetadata | null
  files: PRFile[]
  status: PRReviewStatus
  error: string | null
  availablePRs: PRMetadata[]
  isFileTruncated: boolean
}

const PRReviewStateContext = createContext<PRReviewStateContextType | null>(null)

// ---------------------------------------------------------------------------
// Actions context (stable callbacks)
// ---------------------------------------------------------------------------

interface PRReviewActionsContextType {
  loadPRList: (owner: string, name: string, state?: 'open' | 'closed' | 'all') => Promise<void>
  selectPR: (owner: string, name: string, number: number) => Promise<void>
  reset: () => void
}

const PRReviewActionsContext = createContext<PRReviewActionsContextType | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PRReviewProvider({ children }: { children: ReactNode }) {
  const [pr, setPr] = useState<PRMetadata | null>(null)
  const [files, setFiles] = useState<PRFile[]>([])
  const [status, setStatus] = useState<PRReviewStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [availablePRs, setAvailablePRs] = useState<PRMetadata[]>([])
  const [isFileTruncated, setIsFileTruncated] = useState(false)
  const operationRef = useRef<{ generation: number; controller: AbortController } | null>(null)
  const generationRef = useRef(0)

  const beginOperation = useCallback(() => {
    operationRef.current?.controller.abort()
    const operation = { generation: ++generationRef.current, controller: new AbortController() }
    operationRef.current = operation
    return operation
  }, [])

  const isCurrent = useCallback((operation: { generation: number; controller: AbortController }) => (
    operationRef.current === operation && !operation.controller.signal.aborted
  ), [])

  const loadPRList = useCallback(async (owner: string, name: string, state?: 'open' | 'closed' | 'all') => {
    const operation = beginOperation()
    setPr(null)
    setFiles([])
    setAvailablePRs([])
    setIsFileTruncated(false)
    setStatus('loading-list')
    setError(null)
    try {
      const pulls = await fetchPullsViaProxy(owner, name, {
        state: state ?? 'open',
        perPage: 30,
        sort: 'updated',
        direction: 'desc',
        signal: operation.controller.signal,
      })
      if (!isCurrent(operation)) return
      setAvailablePRs(pulls)
      setStatus('idle')
    } catch (err) {
      if (!isCurrent(operation)) return
      const message = err instanceof Error ? err.message : 'Failed to load pull requests'
      setError(message)
      setStatus('error')
      toast.error(message)
    }
  }, [beginOperation, isCurrent])

  const selectPR = useCallback(async (owner: string, name: string, number: number) => {
    const operation = beginOperation()
    setPr(null)
    setFiles([])
    setIsFileTruncated(false)
    setStatus('loading-pr')
    setError(null)

    try {
      const prData = await fetchPullRequestViaProxy(owner, name, number, {
        signal: operation.controller.signal,
      })
      if (!isCurrent(operation)) return
      setPr(prData)
      setStatus('loading-files')

      const prFiles = await fetchPullRequestFilesViaProxy(owner, name, number, {
        perPage: 100,
        signal: operation.controller.signal,
      })
      if (!isCurrent(operation)) return

      setFiles(prFiles)
      setIsFileTruncated(prFiles.length >= 100)
      setStatus('idle')
    } catch (err) {
      if (!isCurrent(operation)) return
      const message = err instanceof Error ? err.message : 'Failed to load pull request'
      setError(message)
      setStatus('error')
      toast.error(message)
    }
  }, [beginOperation, isCurrent])

  const reset = useCallback(() => {
    operationRef.current?.controller.abort()
    operationRef.current = null
    generationRef.current += 1
    setPr(null)
    setFiles([])
    setStatus('idle')
    setError(null)
    setIsFileTruncated(false)
  }, [])

  return (
    <PRReviewStateContext.Provider
      value={{ pr, files, status, error, availablePRs, isFileTruncated }}
    >
      <PRReviewActionsContext.Provider
        value={{ loadPRList, selectPR, reset }}
      >
        {children}
      </PRReviewActionsContext.Provider>
    </PRReviewStateContext.Provider>
  )
}

export function RepositoryScopedPRReviewProvider({
  repositoryKey,
  children,
}: {
  repositoryKey: string
  children: ReactNode
}) {
  return <PRReviewProvider key={repositoryKey}>{children}</PRReviewProvider>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePRReviewState() {
  const context = useContext(PRReviewStateContext)
  if (context === null) {
    throw new Error("usePRReviewState must be used within a PRReviewProvider")
  }
  return context
}

export function usePRReviewActions() {
  const context = useContext(PRReviewActionsContext)
  if (context === null) {
    throw new Error("usePRReviewActions must be used within a PRReviewProvider")
  }
  return context
}
