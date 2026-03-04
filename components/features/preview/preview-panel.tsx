"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { cn } from "@/lib/utils"
import { useApp, useRepository } from "@/providers"
import { LoadingProgress } from "@/components/features/loading/loading-progress"
import { ProjectSummaryPanel } from "@/components/features/repo/project-summary"
import { flattenFiles } from "@/lib/code/code-index"
import { CodeBrowser } from "@/components/features/code/code-browser"
import { DocViewer } from "@/components/features/docs/doc-viewer"
import { DiagramViewer } from "@/components/features/diagrams/diagram-viewer"
import { IssuesPanel } from "@/components/features/issues/issues-panel"
import { parseShareableUrl, updateUrlState, clearUrlState } from "@/lib/export"
import { LandingPage } from "@/components/features/landing/landing-page"
import { DefaultContent } from "./default-content"
import { LoadingWithStatus } from "./loading-with-status"
import { PREVIEW_TABS } from "./tab-config"
import { GlobalSearchOverlay } from "./global-search-overlay"
import { PreviewRepoHeader } from "./preview-repo-header"
import { PreviewTabBar } from "./preview-tab-bar"

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
      updateUrlState({ repoUrl: repo.url, view: activeTab as 'repo' | 'issues' | 'docs' | 'diagram' | 'code' })
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
          codeIndex && codeIndex.totalFiles > 0 ? (
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
          )
        ) : activeTab === "docs" ? (
          <DocViewer />
        ) : activeTab === "diagram" ? (
          <DiagramViewer files={files} codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
        ) : activeTab === "code" ? (
          <CodeBrowser key="code-browser" navigateToFile={pendingNavigateFile} onNavigateComplete={handleNavigateComplete} />
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
