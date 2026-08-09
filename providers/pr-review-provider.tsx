"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import type {
  PRMetadata,
  PRFile,
  ReviewFinding,
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
  findings: ReviewFinding[]
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
  addFinding: (finding: ReviewFinding) => void
  addFindings: (findings: ReviewFinding[]) => void
  clearFindings: () => void
  reset: () => void
}

const PRReviewActionsContext = createContext<PRReviewActionsContextType | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PRReviewProvider({ children }: { children: ReactNode }) {
  const [pr, setPr] = useState<PRMetadata | null>(null)
  const [files, setFiles] = useState<PRFile[]>([])
  const [findings, setFindings] = useState<ReviewFinding[]>([])
  const [status, setStatus] = useState<PRReviewStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [availablePRs, setAvailablePRs] = useState<PRMetadata[]>([])
  const [isFileTruncated, setIsFileTruncated] = useState(false)

  const loadPRList = useCallback(async (owner: string, name: string, state?: 'open' | 'closed' | 'all') => {
    setStatus('loading-list')
    setError(null)
    try {
      const pulls = await fetchPullsViaProxy(owner, name, {
        state: state ?? 'open',
        perPage: 30,
        sort: 'updated',
        direction: 'desc',
      })
      setAvailablePRs(pulls)
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load pull requests'
      setError(message)
      setStatus('error')
      toast.error(message)
    }
  }, [])

  const selectPR = useCallback(async (owner: string, name: string, number: number) => {
    setStatus('loading-pr')
    setError(null)
    setFindings([])

    try {
      const prData = await fetchPullRequestViaProxy(owner, name, number)
      setPr(prData)
      setStatus('loading-files')

      const prFiles = await fetchPullRequestFilesViaProxy(owner, name, number, { perPage: 100 })

      setFiles(prFiles)
      setIsFileTruncated(prFiles.length >= 100)
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load pull request'
      setError(message)
      setStatus('error')
      toast.error(message)
    }
  }, [])

  const addFinding = useCallback((finding: ReviewFinding) => {
    setFindings((prev) => [...prev, finding])
  }, [])

  const addFindings = useCallback((newFindings: ReviewFinding[]) => {
    setFindings((prev) => [...prev, ...newFindings])
  }, [])

  const clearFindings = useCallback(() => {
    setFindings([])
  }, [])

  const reset = useCallback(() => {
    setPr(null)
    setFiles([])
    setFindings([])
    setStatus('idle')
    setError(null)
    setIsFileTruncated(false)
  }, [])

  return (
    <PRReviewStateContext.Provider
      value={{ pr, files, findings, status, error, availablePRs, isFileTruncated }}
    >
      <PRReviewActionsContext.Provider
        value={{ loadPRList, selectPR, addFinding, addFindings, clearFindings, reset }}
      >
        {children}
      </PRReviewActionsContext.Provider>
    </PRReviewStateContext.Provider>
  )
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
