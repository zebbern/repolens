"use client"

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react"
import { cn } from "@/lib/utils"
import { useApp, useRepositoryData, useRepositoryActions, useRepositoryProgress, useAPIKeys, useGitHubToken } from "@/providers"
import { LoadingProgress } from "@/components/features/loading/loading-progress"
import { ProjectSummaryPanel } from "@/components/features/repo/project-summary"
import { flattenFiles } from "@/lib/code/code-index"
import { parseShareableUrl, updateUrlState, clearUrlState } from "@/lib/export"
import { LandingPage } from "@/components/features/landing/landing-page"
import { DefaultContent } from "./default-content"
import { PREVIEW_TABS } from "./tab-config"
import { GlobalSearchOverlay } from "./global-search-overlay"
import { PreviewRepoHeader } from "./preview-repo-header"
import { PreviewTabBar } from "./preview-tab-bar"
import { AIFeatureEmptyState } from "./ai-feature-empty-state"
import { RepositoryCoverageBanner } from "./repository-coverage-banner"
import {
  IssuesTabSkeleton,
  DocsTabSkeleton,
  DiagramTabSkeleton,
  CodeTabSkeleton,
  DepsTabSkeleton,
  ChangelogTabSkeleton,
  GitHistoryTabSkeleton,
  PRReviewTabSkeleton,
  ToursTabSkeleton,
} from "@/components/features/loading/tab-skeleton"
import { RepositoryScopedPRReviewProvider } from "@/providers/pr-review-provider"
import { FeatureErrorBoundary } from "@/components/ui/feature-error-boundary"
import { AlertCircle, FileQuestion } from "lucide-react"

// Lazy-loaded heavy tab components (code-split per tab)
const CodeBrowser = lazy(() =>
  import("@/components/features/code/code-browser").then(m => ({ default: m.CodeBrowser }))
)
const DocViewer = lazy(() =>
  import("@/components/features/docs/doc-viewer").then(m => ({ default: m.DocViewer }))
)
const DiagramViewer = lazy(() =>
  import("@/components/features/diagrams/diagram-viewer").then(m => ({ default: m.DiagramViewer }))
)
const IssuesPanel = lazy(() =>
  import("@/components/features/issues/issues-panel").then(m => ({ default: m.IssuesPanel }))
)
const DepsPanel = lazy(() =>
  import("@/components/features/deps/deps-panel").then(m => ({ default: m.DepsPanel }))
)
const ChangelogViewer = lazy(() =>
  import("@/components/features/changelog/changelog-viewer").then(m => ({ default: m.ChangelogViewer }))
)
const GitHistoryPanel = lazy(() =>
  import("@/components/features/git-history/git-history-panel").then(m => ({ default: m.GitHistoryPanel }))
)
const ToursPanel = lazy(() =>
  import("@/components/features/tours/tours-panel").then(m => ({ default: m.ToursPanel }))
)
const PRReviewPanel = lazy(() =>
  import("@/components/features/pr-review/pr-review-panel").then(m => ({ default: m.PRReviewPanel }))
)

const SOURCE_REQUIRED_TABS = new Set(["issues", "docs", "diagram", "code", "deps", "tours"])

export function PreviewPanel({ className }: { className?: string }) {
  const { previewUrl } = useApp()
  const { repo, files, codeIndex, isCacheHit, coverage } = useRepositoryData()
  const { connectRepository, disconnectRepository, renameFiles } = useRepositoryActions()
  const { isLoading: isConnecting, error: repoError, loadingStage, indexingProgress } = useRepositoryProgress()
  const { getValidProviders, isHydrated } = useAPIKeys()
  const hasApiKey = isHydrated && getValidProviders().length > 0
  const { isHydrated: isTokenHydrated } = useGitHubToken()
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  // Show "Ready!" state briefly before transitioning to loaded view
  const [showReadyState, setShowReadyState] = useState(false)
  const prevStageRef = useRef(loadingStage)
  useEffect(() => {
    const wasReady = prevStageRef.current === 'ready' || prevStageRef.current === 'cached'
    const isReady = loadingStage === 'ready' || loadingStage === 'cached'
    prevStageRef.current = loadingStage

    // Only animate on transition TO ready, not if already ready on mount/remount
    if (isReady && !wasReady) {
      setShowReadyState(true)
      const timer = setTimeout(() => setShowReadyState(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [loadingStage])

  // Sync local state with global state
  useEffect(() => {
    if (previewUrl && previewUrl !== localPreviewUrl) {
      const timer = setTimeout(() => {
        setLocalPreviewUrl(previewUrl)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [previewUrl, localPreviewUrl])

  const tabs = PREVIEW_TABS
  const [activeTab, setActiveTab] = useState("repo")
  const [repoUrl, setRepoUrl] = useState("")

  // Shareable URL: auto-connect from URL params on mount
  const hasAutoLoaded = useRef(false)
  useEffect(() => {
    if (!isTokenHydrated || hasAutoLoaded.current || repo) return
    const shared = parseShareableUrl()
    if (!shared) return
    hasAutoLoaded.current = true
    queueMicrotask(() => {
      setRepoUrl(shared.repoUrl)
      if (shared.view) setActiveTab(shared.view)
    })
    connectRepository(shared.repoUrl)
  }, [isTokenHydrated, repo, connectRepository])

  // Shareable URL: sync URL bar when repo or tab changes
  useEffect(() => {
    if (repo) {
      updateUrlState({ repoUrl: repo.url, view: activeTab as 'repo' | 'issues' | 'docs' | 'diagram' | 'code' | 'deps' | 'changelog' | 'git-history' | 'tours' })
    } else if (!isConnecting && isTokenHydrated) {
      clearUrlState()
    }
  }, [repo, activeTab, isConnecting, isTokenHydrated])


  const handleConnect = async () => {
    if (!repoUrl.trim()) return
    await connectRepository(repoUrl)
  }

  const handleDisconnect = () => {
    disconnectRepository()
    setRepoUrl("")
  }

  const handleOpenSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-settings", { detail: { tab: "openai" } }))
  }, [])

  // Global file search
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const allFlatFiles = useMemo(() => files.length > 0 ? flattenFiles(files) : [], [files])
  const allFilesForOverlay = useMemo(() => {
    return Array.from(codeIndex.files.values()).map(file => ({
      path: file.path,
      name: file.name,
      lineCount: file.lineCount,
    }))
  }, [codeIndex])

  // Keyboard shortcut: Ctrl/Cmd+Shift+F for file search (Ctrl+K is now command palette)
  useEffect(() => {
    const handleOpenFileSearch = () => setShowGlobalSearch(true)
    const handleSwitchTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: string }>).detail?.tab
      if (tab) setActiveTab(tab)
    }
    window.addEventListener('open-file-search', handleOpenFileSearch)
    window.addEventListener('switch-tab', handleSwitchTab)
    return () => {
      window.removeEventListener('open-file-search', handleOpenFileSearch)
      window.removeEventListener('switch-tab', handleSwitchTab)
    }
  }, [])

  // Navigate to a file from diagrams — switch to code tab
  const [pendingNavigateFile, setPendingNavigateFile] = useState<string | null>(null)
  const [pendingNavigateLine, setPendingNavigateLine] = useState<number | null>(null)
  const handleNavigateToFile = useCallback((path: string, line?: number) => {
    if (!codeIndex.files.has(path)) {
      setPendingNavigateFile(null)
      setPendingNavigateLine(null)
      return
    }
    setPendingNavigateFile(path)
    setPendingNavigateLine(line ?? null)
    setActiveTab("code")
  }, [codeIndex])
  const handleGlobalSearchSelect = useCallback((path: string, line?: number) => {
    setShowGlobalSearch(false)
    handleNavigateToFile(path, line)
  }, [handleNavigateToFile])
  const handleNavigateComplete = useCallback(() => {
    setPendingNavigateFile(null)
    setPendingNavigateLine(null)
  }, [])

  const isSettled = loadingStage === "ready" || loadingStage === "cached"
  const hasNoSupportedFiles = Boolean(
    repo
    && coverage
    && isSettled
    && (
      coverage.supportedFiles.discovered === 0
      || codeIndex.totalFiles === 0
    ),
  )
  const centralTerminalState = activeTab !== "repo" && !repo ? (
    <RepositoryTerminalState
      title="No repository connected"
      description="Connect a GitHub repository from the Repo tab to use this view."
    />
  ) : SOURCE_REQUIRED_TABS.has(activeTab) && hasNoSupportedFiles ? (
    <RepositoryTerminalState
      title="No supported files found"
      description="This repository has no files that RepoLens can load for this feature. Git History, Changelog, and Pull Requests may still be available."
    />
  ) : SOURCE_REQUIRED_TABS.has(activeTab) && repoError && codeIndex.totalFiles === 0 ? (
    <RepositoryTerminalState title="Repository content could not be loaded" description={repoError} isError />
  ) : null

  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      <PreviewTabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasRepo={!!repo}
        fileCount={allFlatFiles.length}
        onOpenSearch={() => setShowGlobalSearch(true)}
        localPreviewUrl={localPreviewUrl}
        hasApiKey={hasApiKey}
      />

      {repo && <RepositoryCoverageBanner coverage={coverage} loadingStage={loadingStage} error={repoError} />}

      <div
        id="preview-tabpanel"
        role="tabpanel"
        aria-labelledby={`preview-tab-${activeTab}`}
        tabIndex={0}
        className="flex-1 bg-background overflow-hidden"
      >
        {centralTerminalState ?? (activeTab === "repo" ? (
          repo ? (
            // Connected repository view
            <div className="flex h-full flex-col">
              <PreviewRepoHeader repo={repo} onDisconnect={handleDisconnect} />
              
              {/* Project summary */}
              <div className="flex-1 overflow-auto px-4 py-3">
                {showReadyState || (codeIndex.totalFiles === 0 && (loadingStage !== 'idle')) ? (
                  <div className="flex items-center justify-center h-32">
                    <LoadingProgress
                      stage={loadingStage}
                      progress={indexingProgress}
                      isCacheHit={isCacheHit}
                      error={repoError}
                      repoName={repo?.fullName}
                    />
                  </div>
                ) : codeIndex && codeIndex.totalFiles > 0 ? (
                  <ProjectSummaryPanel codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
                ) : hasNoSupportedFiles ? (
                  <RepositoryTerminalState
                    title="No supported files found"
                    description="Repository metadata is available, but RepoLens found no supported source files to summarize."
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <LandingPage
              repoUrl={repoUrl}
              onRepoUrlChange={setRepoUrl}
              onConnect={handleConnect}
              onConnectWithUrl={connectRepository}
              isConnecting={isConnecting}
              error={repoError}
            />
          )
        ) : activeTab === "issues" ? (
          <FeatureErrorBoundary featureName="Issues Scanner">
            <Suspense fallback={<IssuesTabSkeleton />}>
              {codeIndex && codeIndex.totalFiles > 0 ? (
                <IssuesPanel codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
              ) : repo ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingProgress
                    stage={loadingStage}
                    progress={indexingProgress}
                    isCacheHit={isCacheHit}
                    error={repoError}
                    repoName={repo.fullName}
                  />
                </div>
              ) : (
                <IssuesPanel codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
              )}
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "docs" ? (
          hasApiKey ? (
            <FeatureErrorBoundary featureName="Documentation">
              <Suspense fallback={<DocsTabSkeleton />}>
                <DocViewer />
              </Suspense>
            </FeatureErrorBoundary>
          ) : (
            <AIFeatureEmptyState tabId="docs" onOpenSettings={handleOpenSettings} />
          )
        ) : activeTab === "diagram" ? (
          <FeatureErrorBoundary featureName="Diagram Viewer">
            <Suspense fallback={<DiagramTabSkeleton />}>
              <DiagramViewer files={files} codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "code" ? (
          <FeatureErrorBoundary featureName="Code Browser">
            <Suspense fallback={<CodeTabSkeleton />}>
              <CodeBrowser key="code-browser" navigateToFile={pendingNavigateFile} navigateToLine={pendingNavigateLine} onNavigateComplete={handleNavigateComplete} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "deps" ? (
          <FeatureErrorBoundary featureName="Dependency Health">
            <Suspense fallback={<DepsTabSkeleton />}>
              {codeIndex && codeIndex.totalFiles > 0 ? (
                <DepsPanel codeIndex={codeIndex} />
              ) : repo ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingProgress
                    stage={loadingStage}
                    progress={indexingProgress}
                    isCacheHit={isCacheHit}
                    error={repoError}
                    repoName={repo.fullName}
                  />
                </div>
              ) : (
                <DepsPanel codeIndex={codeIndex} />
              )}
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "changelog" ? (
          hasApiKey ? (
            <FeatureErrorBoundary featureName="Changelog">
              <Suspense fallback={<ChangelogTabSkeleton />}>
                <ChangelogViewer />
              </Suspense>
            </FeatureErrorBoundary>
          ) : (
            <AIFeatureEmptyState tabId="changelog" onOpenSettings={handleOpenSettings} />
          )
        ) : activeTab === "git-history" ? (
          <FeatureErrorBoundary featureName="Git History">
            <Suspense fallback={<GitHistoryTabSkeleton />}>
              <GitHistoryPanel navigateToFile={pendingNavigateFile} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "pr-review" ? (
          <FeatureErrorBoundary featureName="Pull Requests">
            <RepositoryScopedPRReviewProvider repositoryKey={repo?.fullName ?? "no-repository"}>
              <Suspense fallback={<PRReviewTabSkeleton />}>
                <PRReviewPanel />
              </Suspense>
            </RepositoryScopedPRReviewProvider>
          </FeatureErrorBoundary>
        ) : activeTab === "tours" ? (
          <FeatureErrorBoundary featureName="Tours">
            <Suspense fallback={<ToursTabSkeleton />}>
              <ToursPanel onNavigateToFile={handleNavigateToFile} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : (
          <DefaultContent />
        ))}
      </div>

      {/* Global search overlay */}
      {showGlobalSearch && (
        <GlobalSearchOverlay
          codeIndex={codeIndex}
          allFiles={allFilesForOverlay}
          onSelect={handleGlobalSearchSelect}
          onClose={() => setShowGlobalSearch(false)}
          onRename={renameFiles}
        />
      )}
    </div>
  )
}

function RepositoryTerminalState({
  title,
  description,
  isError = false,
}: {
  title: string
  description: string
  isError?: boolean
}) {
  const Icon = isError ? AlertCircle : FileQuestion
  return (
    <div
      className="flex h-full items-center justify-center p-8 text-center"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <div className="flex max-w-sm flex-col items-center gap-3">
        <Icon className={cn("h-8 w-8", isError ? "text-status-error" : "text-text-muted")} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="text-xs leading-relaxed text-text-muted">{description}</p>
      </div>
    </div>
  )
}
