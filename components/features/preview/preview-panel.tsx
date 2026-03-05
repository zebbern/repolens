"use client"

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react"
import { cn } from "@/lib/utils"
import { useApp, useRepository } from "@/providers"
import { LoadingProgress } from "@/components/features/loading/loading-progress"
import { ProjectSummaryPanel } from "@/components/features/repo/project-summary"
import { flattenFiles } from "@/lib/code/code-index"
import { parseShareableUrl, updateUrlState, clearUrlState } from "@/lib/export"
import { LandingPage } from "@/components/features/landing/landing-page"
import { DefaultContent } from "./default-content"
import { LoadingWithStatus } from "./loading-with-status"
import { PREVIEW_TABS } from "./tab-config"
import { GlobalSearchOverlay } from "./global-search-overlay"
import { PreviewRepoHeader } from "./preview-repo-header"
import { PreviewTabBar } from "./preview-tab-bar"
import {
  IssuesTabSkeleton,
  DocsTabSkeleton,
  DiagramTabSkeleton,
  CodeTabSkeleton,
  DepsTabSkeleton,
  ChangelogTabSkeleton,
  GitHistoryTabSkeleton,
} from "@/components/features/loading/tab-skeleton"
import { FeatureErrorBoundary } from "@/components/ui/feature-error-boundary"

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

export function PreviewPanel({ className }: { className?: string }) {
  const { previewUrl, isGenerating: isLoading } = useApp()
  const {
    repo, files, isLoading: isConnecting, error: repoError,
    connectRepository, disconnectRepository, codeIndex,
    loadingStage, indexingProgress, isCacheHit,
  } = useRepository()
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  // Show "Ready!" state briefly before transitioning to loaded view
  const [showReadyState, setShowReadyState] = useState(false)
  useEffect(() => {
    if (loadingStage === 'ready' || loadingStage === 'cached') {
      setShowReadyState(true)
      const timer = setTimeout(() => setShowReadyState(false), 1500)
      return () => clearTimeout(timer)
    }
    setShowReadyState(false)
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
    if (hasAutoLoaded.current || repo) return
    const shared = parseShareableUrl()
    if (!shared) return
    hasAutoLoaded.current = true
    setRepoUrl(shared.repoUrl)
    connectRepository(shared.repoUrl)
    if (shared.view) setActiveTab(shared.view)
  }, [repo, connectRepository])

  // Shareable URL: sync URL bar when repo or tab changes
  useEffect(() => {
    if (repo) {
      updateUrlState({ repoUrl: repo.url, view: activeTab as 'repo' | 'issues' | 'docs' | 'diagram' | 'code' | 'deps' | 'changelog' | 'git-history' })
    } else if (!isConnecting) {
      clearUrlState()
    }
  }, [repo, activeTab, isConnecting])


  const handleConnect = async () => {
    if (!repoUrl.trim()) return
    await connectRepository(repoUrl)
  }

  const handleDisconnect = () => {
    disconnectRepository()
    setRepoUrl("")
  }

  // Global file search
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState("")
  const allFlatFiles = useMemo(() => files.length > 0 ? flattenFiles(files) : [], [files])
  const globalSearchResults = useMemo(() => {
    if (!globalSearchQuery.trim() || allFlatFiles.length === 0) return []
    const q = globalSearchQuery.toLowerCase()
    return allFlatFiles
      .filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 12)
  }, [globalSearchQuery, allFlatFiles])

  // Keyboard shortcut: Ctrl/Cmd+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowGlobalSearch(prev => !prev)
      }
      if (e.key === 'Escape' && showGlobalSearch) {
        setShowGlobalSearch(false)
        setGlobalSearchQuery("")
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showGlobalSearch])

  const handleGlobalSearchSelect = (path: string) => {
    setShowGlobalSearch(false)
    setGlobalSearchQuery("")
    handleNavigateToFile(path)
  }

  // Navigate to a file from diagrams — switch to code tab
  const [pendingNavigateFile, setPendingNavigateFile] = useState<string | null>(null)
  const handleNavigateToFile = (path: string) => {
    setPendingNavigateFile(path)
    setActiveTab("code")
  }
  const handleNavigateComplete = useCallback(() => {
    setPendingNavigateFile(null)
  }, [])

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
      />

      <div className="flex-1 bg-background overflow-hidden">
        {activeTab === "repo" ? (
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
          <FeatureErrorBoundary featureName="Documentation">
            <Suspense fallback={<DocsTabSkeleton />}>
              <DocViewer />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "diagram" ? (
          <FeatureErrorBoundary featureName="Diagram Viewer">
            <Suspense fallback={<DiagramTabSkeleton />}>
              <DiagramViewer files={files} codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "code" ? (
          <FeatureErrorBoundary featureName="Code Browser">
            <Suspense fallback={<CodeTabSkeleton />}>
              <CodeBrowser key="code-browser" navigateToFile={pendingNavigateFile} onNavigateComplete={handleNavigateComplete} />
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
          <FeatureErrorBoundary featureName="Changelog">
            <Suspense fallback={<ChangelogTabSkeleton />}>
              <ChangelogViewer />
            </Suspense>
          </FeatureErrorBoundary>
        ) : activeTab === "git-history" ? (
          <FeatureErrorBoundary featureName="Git History">
            <Suspense fallback={<GitHistoryTabSkeleton />}>
              <GitHistoryPanel navigateToFile={pendingNavigateFile} />
            </Suspense>
          </FeatureErrorBoundary>
        ) : (
          <DefaultContent />
        )}
      </div>

      {/* Global file search overlay */}
      {showGlobalSearch && (
        <GlobalSearchOverlay
          query={globalSearchQuery}
          onQueryChange={setGlobalSearchQuery}
          results={globalSearchResults}
          totalFileCount={allFlatFiles.length}
          onSelect={handleGlobalSearchSelect}
          onClose={() => { setShowGlobalSearch(false); setGlobalSearchQuery("") }}
        />
      )}
    </div>
  )
}
