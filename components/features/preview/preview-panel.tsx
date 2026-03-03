"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExternalLink, Maximize2, Github, Code2, Star, GitFork, Loader2, X, FileText, Network, Search, Bug } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp, useRepository } from "@/providers"
import { ProjectSummaryPanel } from "@/components/features/repo/project-summary"
import { flattenFiles } from "@/lib/code/code-index"
import { CodeBrowser } from "@/components/features/code/code-browser"
import { DocViewer } from "@/components/features/docs/doc-viewer"
import { DiagramViewer } from "@/components/features/diagrams/diagram-viewer"
import { IssuesPanel } from "@/components/features/issues/issues-panel"
import { parseShareableUrl, updateUrlState, clearUrlState } from "@/lib/export"



interface PreviewPanelProps {
  className?: string
}

const DefaultContent = () => (
  <div className="flex h-full items-center justify-center p-8 text-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <Code2 className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-medium text-muted-foreground">Preview</h2>
    </div>
  </div>
)

const ErrorContent = ({ error }: { error: string }) => (
  <div className="flex h-full items-center justify-center p-8">
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="rounded-full bg-red-100 p-4">
        <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-foreground">Error Generating Component</h2>
      <p className="text-muted-foreground max-w-md">{error}</p>
      <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
        Retry
      </Button>
    </div>
  </div>
)

const LoadingWithStatus = () => (
  <div className="flex h-full w-full items-center justify-center bg-primary-background">
    <div className="w-full max-w-xl space-y-4 p-4">
      <div className="flex items-center space-x-3 font-medium text-text-secondary">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-blue-600"></div>
        <span>Generating component...</span>
      </div>
      <p className="text-sm text-text-muted">
        This may take a few moments.
      </p>
    </div>
  </div>
)

export function PreviewPanel({ className }: { className?: string }) {
  const { previewUrl, isGenerating: isLoading } = useApp()
  const { repo, files, isLoading: isConnecting, error: repoError, connectRepository, disconnectRepository, codeIndex } = useRepository()
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  // Sync local state with global state
  useEffect(() => {
    if (previewUrl && previewUrl !== localPreviewUrl) {
      const timer = setTimeout(() => {
        setLocalPreviewUrl(previewUrl)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [previewUrl, localPreviewUrl])

  const tabs = [
    { id: "repo", label: "Repo", icon: Github },
    { id: "issues", label: "Issues", icon: Bug },
    { id: "docs", label: "Docs", icon: FileText },
    { id: "diagram", label: "Diagram", icon: Network },
    { id: "code", label: "Code", icon: Code2 },
  ]
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
  const globalSearchRef = useRef<HTMLInputElement>(null)
  const allFlatFiles = useMemo(() => files.length > 0 ? flattenFiles(files) : [], [files])
  const globalSearchResults = useMemo(() => {
    if (!globalSearchQuery.trim() || allFlatFiles.length === 0) return []
    const q = globalSearchQuery.toLowerCase()
    return allFlatFiles
      .filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 12)
  }, [globalSearchQuery, allFlatFiles])

  useEffect(() => {
    if (showGlobalSearch) globalSearchRef.current?.focus()
  }, [showGlobalSearch])

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
      <div className="flex h-11 items-center justify-between border-b border-foreground/[0.06] px-4 bg-card">
        <div className="flex items-center h-full gap-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 h-full px-3 text-xs font-medium transition-colors",
                  isActive
                    ? "text-text-primary after:absolute after:bottom-0 after:inset-x-3 after:h-px after:bg-foreground"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1">
          {/* Global file search trigger */}
          {repo && allFlatFiles.length > 0 && (
            <button
              onClick={() => setShowGlobalSearch(true)}
              className="flex items-center gap-2 h-7 px-2.5 rounded-md text-xs text-text-muted hover:text-text-secondary bg-foreground/[0.03] border border-foreground/[0.06] hover:border-foreground/10 transition-colors"
              title="Search files (Ctrl+K)"
            >
              <Search className="h-3 w-3" />
              <span className="hidden sm:inline">Search files</span>
              <kbd className="hidden sm:inline text-[10px] text-text-muted/60 bg-foreground/[0.04] px-1 py-0.5 rounded font-mono leading-none">{'⌘K'}</kbd>
            </button>
          )}
          {localPreviewUrl && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
                onClick={() => window.open(localPreviewUrl, "_blank")}
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
                title="Fullscreen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 bg-background overflow-hidden">
        {activeTab === "repo" ? (
          repo ? (
            // Connected repository view
            <div className="flex h-full flex-col">
              {/* Repo header */}
              <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground/5">
                    <Github className="h-4 w-4 text-text-secondary" />
                  </div>
                  <div>
                    <a 
                      href={repo.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-text-primary hover:underline"
                    >
                      {repo.fullName}
                    </a>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      {repo.language && <span>{repo.language}</span>}
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {repo.stars.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="h-3 w-3" />
                        {repo.forks.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  className="text-text-muted hover:text-status-error"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Project summary */}
              <div className="flex-1 overflow-auto px-4 py-3">
                {codeIndex && codeIndex.totalFiles > 0 ? (
                  <ProjectSummaryPanel codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
                ) : (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Connect repository form
            <div className="flex h-full flex-col items-center justify-center p-8">
              <div className="flex flex-col items-center gap-6 w-full max-w-md">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5 border border-foreground/10">
                    <Github className="h-6 w-6 text-text-secondary" />
                  </div>
                  <h2 className="text-lg font-medium text-text-primary">Explore Any GitHub Repository</h2>
                  <p className="text-sm text-text-secondary text-center">Paste a GitHub URL to get AI-powered code analysis, documentation, and insights instantly</p>
                </div>
                <div className="w-full space-y-3">
                  <Input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/username/repo"
                    className="h-10 bg-foreground/5 border-foreground/10 text-text-primary placeholder:text-text-muted focus:border-foreground/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  />
                  {repoError && (
                    <p className="text-sm text-status-error">{repoError}</p>
                  )}
                  <Button 
                    className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                    disabled={!repoUrl.trim() || isConnecting}
                    onClick={handleConnect}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Connecting...
                      </>
                    ) : (
                      "Connect Repository"
                    )}
                  </Button>
                  <p className="text-xs text-text-muted text-center">
                    Tip: Add <span className="font-medium text-text-secondary">m</span> before github.com — e.g. <span className="font-medium text-text-secondary">mgithub.com/owner/repo</span>
                  </p>
                </div>
              </div>
            </div>
          )
        ) : activeTab === "issues" ? (
          codeIndex && codeIndex.totalFiles > 0 ? (
            <IssuesPanel codeIndex={codeIndex} onNavigateToFile={handleNavigateToFile} />
          ) : repo ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3 text-text-muted">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Indexing codebase...</p>
              </div>
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
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15%]" onClick={() => { setShowGlobalSearch(false); setGlobalSearchQuery("") }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-popover border border-foreground/10 rounded-lg shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 border-b border-foreground/[0.06]">
              <Search className="h-4 w-4 text-text-muted shrink-0" />
              <input
                ref={globalSearchRef}
                value={globalSearchQuery}
                onChange={e => setGlobalSearchQuery(e.target.value)}
                placeholder="Search files by name or path..."
                className="flex-1 h-10 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setShowGlobalSearch(false); setGlobalSearchQuery("") }
                  if (e.key === 'Enter' && globalSearchResults.length > 0) handleGlobalSearchSelect(globalSearchResults[0].path)
                }}
              />
              <kbd className="text-[10px] text-text-muted/50 bg-foreground/[0.04] px-1.5 py-0.5 rounded font-mono">ESC</kbd>
            </div>
            {globalSearchQuery.trim() && (
              <div className="max-h-72 overflow-y-auto py-1">
                {globalSearchResults.length > 0 ? (
                  globalSearchResults.map(f => (
                    <button
                      key={f.path}
                      onClick={() => handleGlobalSearchSelect(f.path)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-foreground/5 transition-colors group"
                    >
                      <Code2 className="h-3.5 w-3.5 text-text-muted shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-text-primary truncate group-hover:text-white">{f.name}</span>
                        <span className="text-[10px] text-text-muted truncate">{f.path}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-xs text-text-muted">No files found</div>
                )}
              </div>
            )}
            {!globalSearchQuery.trim() && (
              <div className="px-3 py-4 text-center text-xs text-text-muted">Type to search across {allFlatFiles.length} files</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
