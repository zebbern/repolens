"use client"

import { useEffect, useCallback, useState } from "react"
import { GitCommitHorizontal, History, FileText, AlertCircle, X, RefreshCw, Loader2, Info, Lock, BarChart3 } from "lucide-react"
import { useSession } from "next-auth/react"
import { useApp, useRepositoryData, useRepositoryActions } from "@/providers"
import { useGitHistory, type GitHistoryView } from "@/hooks/use-git-history"
import { fetchFileViaProxy } from "@/lib/github/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { BlameView } from "./blame-view"
import { CommitTimeline } from "./commit-timeline"
import { FileHistoryList } from "./file-history-list"
import { CommitDetailView } from "./commit-detail-view"
import { InsightsView } from "./insights-view"
import { LoginRequiredNotice } from "./git-history-helpers"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GitHistoryPanelProps {
  navigateToFile?: string | null
}

// ---------------------------------------------------------------------------
// View mode tabs configuration
// ---------------------------------------------------------------------------

const VIEW_TABS: Array<{ id: GitHistoryView; label: string; icon: typeof History; requiresFile?: boolean }> = [
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'blame', label: 'Blame', icon: FileText, requiresFile: true },
  { id: 'file-history', label: 'File History', icon: GitCommitHorizontal, requiresFile: true },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
]

// ---------------------------------------------------------------------------
// GitHistoryPanel
// ---------------------------------------------------------------------------

export function GitHistoryPanel({ navigateToFile }: GitHistoryPanelProps) {
  const { selectedFilePath } = useApp()
  const { repo } = useRepositoryData()
  const { getTabCache, setTabCache } = useRepositoryActions()
  const { data: session } = useSession()

  const {
    viewMode,
    blameData,
    commits,
    fileCommits,
    selectedCommit,
    isLoading,
    error,
    hasMore,
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
  } = useGitHistory()

  const owner = repo?.owner ?? ''
  const name = repo?.name ?? ''
  const defaultBranch = repo?.defaultBranch ?? 'main'

  // File content for blame view
  const [fileContent, setFileContent] = useState<string>('')
  const [isLoadingFile, setIsLoadingFile] = useState(false)

  // Determine the active file (prop override or from app state)
  const activeFile = navigateToFile ?? selectedFilePath

  // Reset when repo changes
  useEffect(() => {
    reset()
  }, [owner, name, reset])

  // Auto-load commits when timeline view is first loaded
  useEffect(() => {
    let cancelled = false
    if (!owner || !name) return
    if ((viewMode === 'timeline' || viewMode === 'insights') && commits.length === 0 && !isLoading) {
      const cached = getTabCache<{ commits: typeof commits; hasMore: boolean }>('gitHistory')
      if (cached && cached.commits.length > 0) {
        hydrateCommits(cached)
        return
      }
      fetchCommits(owner, name).then(() => {
        if (cancelled) return
      })
    }
    return () => { cancelled = true }
  }, [owner, name, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cache commits when they change
  useEffect(() => {
    if (commits.length > 0) {
      setTabCache('gitHistory', { commits, hasMore })
    }
  }, [commits, hasMore, setTabCache])

  // Auto-load blame & file history when file changes (or when navigated to)
  useEffect(() => {
    let cancelled = false
    if (!owner || !name || !activeFile) return

    if (viewMode === 'blame') {
      fetchBlame(owner, name, defaultBranch, activeFile)
      // Also fetch file content for the blame view
      setIsLoadingFile(true)
      fetchFileViaProxy(owner, name, defaultBranch, activeFile)
        .then((content) => {
          if (cancelled) return
          setFileContent(content)
        })
        .catch(() => {
          if (cancelled) return
          setFileContent('')
        })
        .finally(() => {
          if (cancelled) return
          setIsLoadingFile(false)
        })
    }

    if (viewMode === 'file-history') {
      fetchFileHistory(owner, name, activeFile)
    }
    return () => { cancelled = true }
  }, [activeFile, viewMode, owner, name, defaultBranch]) // eslint-disable-line react-hooks/exhaustive-deps

  // When navigateToFile is set, switch to blame view
  useEffect(() => {
    if (navigateToFile) {
      setViewMode('blame')
    }
  }, [navigateToFile, setViewMode])

  // Commit click handler
  const handleCommitClick = useCallback(
    (sha: string) => {
      if (owner && name) {
        fetchCommitDetail(owner, name, sha)
      }
    },
    [owner, name, fetchCommitDetail],
  )

  // Load more commits handler
  const handleLoadMore = useCallback(() => {
    if (owner && name) {
      loadMoreCommits(owner, name)
    }
  }, [owner, name, loadMoreCommits])

  // Back from commit detail
  const handleBackFromDetail = useCallback(() => {
    if (activeFile) {
      setViewMode('file-history')
    } else {
      setViewMode('timeline')
    }
  }, [activeFile, setViewMode])

  // View mode change handler
  const handleViewChange = useCallback(
    (mode: GitHistoryView) => {
      setViewMode(mode)
    },
    [setViewMode],
  )

  // No repo loaded
  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full py-16">
        <GitCommitHorizontal className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Connect a repository to view git history</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* View mode tabs — hide during commit detail */}
      {viewMode !== 'commit-detail' && (
        <div className="flex flex-col border-b shrink-0">
          <div className="flex items-center gap-1 px-4 py-1.5">
            <TooltipProvider delayDuration={300}>
              {VIEW_TABS.map((tab) => {
                const isDisabled = tab.requiresFile && !activeFile
                const button = (
                  <Button
                    key={tab.id}
                    variant={viewMode === tab.id ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-7 text-xs gap-1.5',
                      isDisabled && 'opacity-50 cursor-not-allowed',
                    )}
                    disabled={isDisabled}
                    onClick={() => handleViewChange(tab.id)}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {isDisabled && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </Button>
                )

                if (isDisabled) {
                  return (
                    <Tooltip key={tab.id}>
                      <TooltipTrigger asChild>
                        <span tabIndex={0}>{button}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Select a file in the Code tab first</p>
                      </TooltipContent>
                    </Tooltip>
                  )
                }

                return button
              })}
            </TooltipProvider>

            {activeFile && (
              <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
                {activeFile}
              </span>
            )}
          </div>

          {/* Hint when on timeline and no file selected */}
          {viewMode === 'timeline' && !activeFile && (
            <div className="flex items-center gap-1.5 px-4 pb-1.5 text-xs text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              <span>Select a file in Code tab to unlock File History and Blame</span>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/20 px-4 py-2 text-sm text-destructive shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={clearError}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {viewMode === 'commit-detail' && selectedCommit ? (
          <CommitDetailView
            commit={selectedCommit}
            onBack={handleBackFromDetail}
            onFileClick={undefined}
          />
        ) : viewMode === 'blame' ? (
          !activeFile ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Select a file in the Code tab to view blame
              </p>
            </div>
          ) : error?.includes('Login required') ? (
            <LoginRequiredNotice />
          ) : isLoading || isLoadingFile ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading blame data…
            </div>
          ) : blameData ? (
            <BlameView
              data={{
                blameData: blameData,
                filePath: activeFile,
                fileContent: fileContent,
                blameStats: blameStats,
              }}
              onCommitClick={handleCommitClick}
            />
          ) : null
        ) : viewMode === 'file-history' ? (
          !activeFile ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <GitCommitHorizontal className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Select a file in the Code tab to view file history
              </p>
            </div>
          ) : (
            <FileHistoryList
              commits={fileCommits}
              filePath={activeFile}
              onCommitClick={handleCommitClick}
              isLoading={isLoading}
            />
          )
        ) : viewMode === 'insights' ? (
          <InsightsView commits={commits} />
        ) : (
          /* timeline */
          <CommitTimeline
            commitGroups={commitsByDate}
            onCommitClick={handleCommitClick}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  )
}
