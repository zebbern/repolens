"use client"

import { useState, useMemo, useCallback } from "react"
import type { BlameData, CommitDetail } from "@/types/git-history"
import type { GitHubCommit } from "@/types/repository"
import type { RepositorySession } from '@/providers/repository-provider'
import {
  fetchBlameViaProxy,
  fetchCommitsViaProxy,
  fetchFileCommitsViaProxy,
  fetchCommitDetailViaProxy,
} from "@/lib/github/client"
import {
  groupCommitsByDate,
  computeBlameStats,
  type CommitGroup,
  type BlameAuthorStats,
} from "@/lib/git-history"

export type GitHistoryView = 'timeline' | 'blame' | 'file-history' | 'commit-detail' | 'insights'

const PER_PAGE = 30

interface UseGitHistoryReturn {
  /** Current view mode */
  viewMode: GitHistoryView
  /** Blame data for current file */
  blameData: BlameData | null
  /** Repo-wide commit list */
  commits: GitHubCommit[]
  commitsSession: RepositorySession | null
  /** Commits for a specific file */
  fileCommits: GitHubCommit[]
  /** Expanded commit detail */
  selectedCommit: CommitDetail | null
  /** Loading state */
  isLoading: boolean
  /** Error message */
  error: string | null
  /** Whether more commits can be loaded */
  hasMore: boolean
  /** Current pagination page */
  currentPage: number
  /** Commits grouped by date */
  commitsByDate: CommitGroup[]
  /** Per-author blame stats */
  blameStats: BlameAuthorStats[]

  /** Fetch blame data for a file */
  fetchBlame: (owner: string, name: string, ref: string, path: string) => Promise<void>
  /** Fetch repo-wide commits */
  fetchCommits: (owner: string, name: string, opts?: { sha?: string }) => Promise<void>
  /** Fetch commits for a specific file */
  fetchFileHistory: (owner: string, name: string, path: string) => Promise<void>
  /** Fetch detailed commit information */
  fetchCommitDetail: (owner: string, name: string, sha: string) => Promise<void>
  /** Load next page of commits */
  loadMoreCommits: (owner: string, name: string) => Promise<void>
  /** Switch view mode */
  setViewMode: (mode: GitHistoryView) => void
  /** Clear error state */
  clearError: () => void
  /** Reset all state */
  reset: () => void
  /** Hydrate commits from cached data */
  hydrateCommits: (data: { commits: GitHubCommit[]; hasMore: boolean }) => void
}

export function useGitHistory(
  repositorySession: RepositorySession | null = null,
  isRepositorySessionCurrent: (session: RepositorySession | null) => boolean = () => true,
): UseGitHistoryReturn {
  const [viewMode, setViewMode] = useState<GitHistoryView>('timeline')
  const [blameData, setBlameData] = useState<BlameData | null>(null)
  const [commits, setCommits] = useState<GitHubCommit[]>([])
  const [commitsSession, setCommitsSession] = useState<RepositorySession | null>(null)
  const [fileCommits, setFileCommits] = useState<GitHubCommit[]>([])
  const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const commitsByDate = useMemo(
    () => groupCommitsByDate(commits),
    [commits],
  )

  const blameStats = useMemo(
    () => (blameData ? computeBlameStats(blameData.ranges) : []),
    [blameData],
  )

  const fetchBlame = useCallback(async (
    owner: string,
    name: string,
    ref: string,
    path: string,
  ) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchBlameViaProxy(owner, name, ref, path)
      if (!isRepositorySessionCurrent(requestSession)) return
      setBlameData(data)
    } catch (err) {
      if (!isRepositorySessionCurrent(requestSession)) return
      const message = err instanceof Error ? err.message : 'Failed to load blame data'
      // Detect auth errors
      if (message.includes('401') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('authentication')) {
        setError('Login required to view blame data. Blame uses the GitHub GraphQL API which requires authentication.')
      } else {
        setError(message)
      }
    } finally {
      if (isRepositorySessionCurrent(requestSession)) setIsLoading(false)
    }
  }, [repositorySession, isRepositorySessionCurrent])

  const fetchCommits = useCallback(async (
    owner: string,
    name: string,
    opts?: { sha?: string },
  ) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchCommitsViaProxy(owner, name, {
        sha: opts?.sha,
        perPage: PER_PAGE,
      })
      if (!isRepositorySessionCurrent(requestSession)) return
      if (opts?.sha) {
        // Paginated load — append (skip first since it's the sha itself)
        setCommits(prev => [...prev, ...data.slice(1)])
      } else {
        setCommits(data)
      }
      setHasMore(data.length >= PER_PAGE)
      setCommitsSession(requestSession)
    } catch (err) {
      if (!isRepositorySessionCurrent(requestSession)) return
      setError(err instanceof Error ? err.message : 'Failed to load commits')
    } finally {
      if (isRepositorySessionCurrent(requestSession)) setIsLoading(false)
    }
  }, [repositorySession, isRepositorySessionCurrent])

  const fetchFileHistory = useCallback(async (
    owner: string,
    name: string,
    path: string,
  ) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchFileCommitsViaProxy(owner, name, path, { perPage: PER_PAGE })
      if (!isRepositorySessionCurrent(requestSession)) return
      setFileCommits(data)
    } catch (err) {
      if (!isRepositorySessionCurrent(requestSession)) return
      setError(err instanceof Error ? err.message : 'Failed to load file history')
    } finally {
      if (isRepositorySessionCurrent(requestSession)) setIsLoading(false)
    }
  }, [repositorySession, isRepositorySessionCurrent])

  const fetchCommitDetail = useCallback(async (
    owner: string,
    name: string,
    sha: string,
  ) => {
    const requestSession = repositorySession
    if (!isRepositorySessionCurrent(requestSession)) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchCommitDetailViaProxy(owner, name, sha)
      if (!isRepositorySessionCurrent(requestSession)) return
      setSelectedCommit(data)
      setViewMode('commit-detail')
    } catch (err) {
      if (!isRepositorySessionCurrent(requestSession)) return
      setError(err instanceof Error ? err.message : 'Failed to load commit details')
    } finally {
      if (isRepositorySessionCurrent(requestSession)) setIsLoading(false)
    }
  }, [repositorySession, isRepositorySessionCurrent])

  const loadMoreCommits = useCallback(async (
    owner: string,
    name: string,
  ) => {
    if (!isRepositorySessionCurrent(repositorySession)) return
    if (commits.length === 0 || !hasMore) return
    const lastSha = commits[commits.length - 1].sha
    setCurrentPage(prev => prev + 1)
    await fetchCommits(owner, name, { sha: lastSha })
  }, [commits, hasMore, fetchCommits, repositorySession, isRepositorySessionCurrent])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setViewMode('timeline')
    setBlameData(null)
    setCommits([])
    setCommitsSession(null)
    setFileCommits([])
    setSelectedCommit(null)
    setIsLoading(false)
    setError(null)
    setHasMore(false)
    setCurrentPage(1)
  }, [])

  const hydrateCommits = useCallback((data: { commits: GitHubCommit[]; hasMore: boolean }) => {
    if (!isRepositorySessionCurrent(repositorySession)) return
    setCommits(data.commits)
    setHasMore(data.hasMore)
    setCommitsSession(repositorySession)
  }, [repositorySession, isRepositorySessionCurrent])

  return {
    viewMode,
    blameData,
    commits,
    commitsSession,
    fileCommits,
    selectedCommit,
    isLoading,
    error,
    hasMore,
    currentPage,
    commitsByDate,
    blameStats,
    fetchBlame,
    fetchCommits,
    fetchFileHistory,
    fetchCommitDetail,
    loadMoreCommits,
    setViewMode,
    clearError,
    reset,
    hydrateCommits,
  }
}
