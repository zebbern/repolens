"use client"

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import {
  Search, X, File, Folder, ChevronRight,
  Code2, FileText, Loader2, Download,
  Undo2, FolderDown, ListTree
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useRepository } from "@/providers"
import type { CodeBrowserProps, SidebarMode } from "./types"
import { useFileOperations } from "./hooks/use-file-operations"
import { useSearch } from "./hooks/use-search"
import { useReplace } from "./hooks/use-replace"
import { useDownloads } from "./hooks/use-downloads"
import { FileTreeNode, type FileIssueCounts } from "./file-tree-node"
import { scanIssues } from "@/lib/code/issue-scanner"
import type { CodeIssue } from "@/lib/code/issue-scanner"
import { CodeEditor } from "./code-editor"
import { SearchResultItem } from "./search-result-item"
import { SearchSidebar } from "./search-sidebar"
import { SymbolOutline } from "./symbol-outline"
import { useSymbolExtraction } from "./hooks/use-symbol-extraction"

export function CodeBrowser({ navigateToFile, onNavigateComplete }: CodeBrowserProps) {
  const { repo, files, codeIndex, updateCodeIndex, indexingProgress: sharedIndexingProgress, modifiedContents, setModifiedContents, getFileContent, codebaseAnalysis } = useRepository()

  // Sidebar state
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('explorer')

  // Search state – persisted at provider level
  const { searchState, setSearchState } = useRepository()
  const searchQuery = searchState.searchQuery
  const setSearchQuery = useCallback((v: string) => setSearchState(prev => ({ ...prev, searchQuery: v })), [setSearchState])
  const debouncedSearchQuery = searchState.debouncedSearchQuery
  const setDebouncedSearchQuery = useCallback((v: string) => setSearchState(prev => ({ ...prev, debouncedSearchQuery: v })), [setSearchState])
  const replaceQuery = searchState.replaceQuery
  const setReplaceQuery = useCallback((v: string) => setSearchState(prev => ({ ...prev, replaceQuery: v })), [setSearchState])
  const showReplace = searchState.showReplace
  const setShowReplace = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setSearchState(prev => ({ ...prev, showReplace: typeof v === 'function' ? v(prev.showReplace) : v }))
  }, [setSearchState])
  const fileFilter = searchState.fileFilter
  const setFileFilter = useCallback((v: string) => setSearchState(prev => ({ ...prev, fileFilter: v })), [setSearchState])
  const searchOptions = searchState.searchOptions
  const setSearchOptions = useCallback((v: typeof searchState.searchOptions | ((p: typeof searchState.searchOptions) => typeof searchState.searchOptions)) => {
    setSearchState(prev => ({ ...prev, searchOptions: typeof v === 'function' ? v(prev.searchOptions) : v }))
  }, [setSearchState])

  // Refs
  const editorRef = useRef<HTMLDivElement>(null)

  // Indexing state
  const indexingProgress = sharedIndexingProgress
  const isIndexingComplete = sharedIndexingProgress.isComplete
  const indexingPercent = indexingProgress.total > 0
    ? Math.round((indexingProgress.current / indexingProgress.total) * 100)
    : 0

  // --- Custom Hooks ---

  const {
    openTabs,
    setOpenTabs,
    activeTab,
    activeTabPath,
    setActiveTabPath,
    expandedFolders,
    openFile,
    closeTab,
    toggleFolder,
  } = useFileOperations({
    repo,
    files,
    codeIndex,
    modifiedContents,
    navigateToFile,
    onNavigateComplete,
  })

  const {
    searchResults,
    goToSearchResult,
    highlightedLine,
    setHighlightedLine,
    expandAllMatches,
    setExpandAllMatches,
    visibleResultCount,
    setVisibleResultCount,
    totalMatchCount,
    searchInputRef,
    resultsContainerRef,
  } = useSearch({
    codeIndex,
    isIndexingComplete,
    debouncedSearchQuery,
    searchOptions,
    fileFilter,
    files,
    openFile,
    sidebarMode,
  })

  const {
    confirmReplaceAll,
    setConfirmReplaceAll,
    replaceInFile,
    replaceAllInFile,
    replaceAllInAllFiles,
    revertFile,
  } = useReplace({
    codeIndex,
    updateCodeIndex,
    setModifiedContents,
    getFileContent,
    debouncedSearchQuery,
    searchOptions,
    replaceQuery,
    searchResults,
    modifiedContents,
    setOpenTabs,
  })

  const {
    modifiedTabs,
    downloadFile,
    downloadAllModified,
    downloadExplorerFile,
    downloadExplorerFolder,
    downloadFullProject,
  } = useDownloads({
    modifiedContents,
    openTabs,
    codeIndex,
    files,
    getFileContent,
    repo,
  })

  // Symbol extraction for outline sidebar
  const outlineSymbols = useSymbolExtraction(activeTab?.content, activeTab?.language)

  // Compute scan results: issue-count-by-file map for tree badges + full issue list for editor
  const { issueCountByFile, allIssues } = useMemo<{ issueCountByFile: Map<string, FileIssueCounts>; allIssues: CodeIssue[] }>(() => {
    const map = new Map<string, FileIssueCounts>()
    if (codeIndex.totalFiles === 0 || !codebaseAnalysis) return { issueCountByFile: map, allIssues: [] }
    try {
      const results = scanIssues(codeIndex, codebaseAnalysis)
      for (const issue of results.issues) {
        const existing = map.get(issue.file) ?? { critical: 0, warning: 0, info: 0 }
        existing[issue.severity] += 1
        map.set(issue.file, existing)
      }
      return { issueCountByFile: map, allIssues: results.issues }
    } catch (err) {
      // Scanner failure should not break the tree
      console.warn('[code-browser] Scanner failed during issue analysis', err)
    }
    return { issueCountByFile: map, allIssues: [] }
  }, [codeIndex, codebaseAnalysis])

  // Filter issues for the currently active file (for editor gutter markers)
  const activeFileIssues = useMemo<CodeIssue[]>(() => {
    if (!activeTab?.path || allIssues.length === 0) return []
    return allIssues.filter(issue => issue.file === activeTab.path)
  }, [allIssues, activeTab?.path])

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
      setVisibleResultCount(50)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery, setDebouncedSearchQuery, setVisibleResultCount])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + F to open search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setSidebarMode('search')
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
      // Escape to close search or clear
      if (e.key === 'Escape' && sidebarMode === 'search') {
        if (searchQuery) {
          setSearchQuery('')
          setDebouncedSearchQuery('')
        } else {
          setSidebarMode('explorer')
        }
      }
      // Cmd/Ctrl + H to toggle replace
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault()
        if (sidebarMode !== 'search') {
          setSidebarMode('search')
        }
        setShowReplace((prev: boolean) => !prev)
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarMode, searchQuery, setSearchQuery, setDebouncedSearchQuery, setShowReplace, searchInputRef])

  // Render editor content
  const renderEditorContent = () => {
    // Show loading while indexing
    if (!isIndexingComplete && indexingProgress.total > 0) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-6 w-full max-w-xs">
            {/* Circular Progress */}
            <div className="relative">
              <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="6"
                  fill="none"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="url(#progressGradient)"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - indexingPercent / 100)}`}
                  className="transition-all duration-300 ease-out"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-semibold text-text-primary">{indexingPercent}%</span>
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-text-primary">Indexing Repository</p>
              <p className="text-xs text-text-muted">
                {indexingProgress.current} of {indexingProgress.total} files
              </p>
            </div>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )
    }

    if (activeTab) {
      if (activeTab.isLoading) {
        return (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
          </div>
        )
      }
      if (activeTab.error) {
        return (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-status-error">{activeTab.error}</p>
          </div>
        )
      }
      if (activeTab.content) {
        return (
          <CodeEditor 
            ref={editorRef}
            content={activeTab.content} 
            language={activeTab.language}
            highlightedLine={highlightedLine?.path === activeTab.path ? highlightedLine.line : undefined}
            searchQuery={sidebarMode === 'search' ? debouncedSearchQuery : ''}
            searchOptions={searchOptions}
            onHighlightComplete={() => setHighlightedLine(null)}
            issues={activeFileIssues}
          />
        )
      }
    }
    
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-muted">Select a file to view</p>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center text-text-secondary">
          <Code2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Connect a repository to browse code</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex h-full bg-background">
      {/* Activity Bar */}
      <div className="w-12 shrink-0 bg-background border-r border-foreground/[0.06] flex flex-col items-center py-2 gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-10 w-10",
            sidebarMode === 'explorer' 
              ? "text-text-primary bg-foreground/10" 
              : "text-text-muted hover:text-text-primary"
          )}
          onClick={() => setSidebarMode('explorer')}
          title="Explorer"
        >
          <FileText className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-10 w-10",
            sidebarMode === 'search' 
              ? "text-text-primary bg-foreground/10" 
              : "text-text-muted hover:text-text-primary"
          )}
          onClick={() => setSidebarMode('search')}
          title="Search"
        >
          <Search className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-10 w-10",
            sidebarMode === 'outline' 
              ? "text-text-primary bg-foreground/10" 
              : "text-text-muted hover:text-text-primary"
          )}
          onClick={() => setSidebarMode('outline')}
          title="Outline"
        >
          <ListTree className="h-5 w-5" />
        </Button>
      </div>
      
      {/* Sidebar */}
      <div className="w-60 shrink-0 bg-background border-r border-foreground/[0.06] flex flex-col">
        {sidebarMode === 'explorer' ? (
          <>
            {/* Explorer Header */}
            <div className="h-9 flex items-center justify-between px-4 text-xs font-medium text-text-muted uppercase tracking-wide">
              <span>Explorer</span>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={downloadFullProject}
                      disabled={files.length === 0}
                      className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-foreground/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <FolderDown className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Download full project as ZIP</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            {/* File Tree */}
            <div className="flex-1 overflow-auto">
              <div className="px-2 py-1">
                <FileTreeNode 
                  nodes={files} 
                  expandedFolders={expandedFolders}
                  onToggleFolder={toggleFolder}
                  onFileSelect={openFile}
                  onDownloadFile={downloadExplorerFile}
                  onDownloadFolder={downloadExplorerFolder}
                  activeFilePath={activeTabPath}
                  depth={0}
                  codeIndex={codeIndex}
                  issueCountByFile={issueCountByFile}
                />
              </div>
            </div>
            
            {/* Modified Files Section */}
            {modifiedTabs.length > 0 && (
              <div className="border-t border-foreground/[0.06] p-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-text-muted uppercase">
                    Modified ({modifiedTabs.length})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1 text-text-muted hover:text-text-primary"
                    onClick={downloadAllModified}
                    title="Download all modified files as ZIP"
                  >
                    <Download className="h-3 w-3" />
                    Download All
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {modifiedTabs.map((tab) => (
                    <div
                      key={tab.path}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-foreground/5 group"
                    >
                      <File className="h-3.5 w-3.5 text-text-muted shrink-0" />
                      <span className="text-xs text-text-secondary truncate flex-1">{tab.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={() => revertFile(tab.path)}
                        title="Revert to original"
                      >
                        <Undo2 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={() => downloadFile(tab)}
                        title="Download file"
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : sidebarMode === 'search' ? (
          <SearchSidebar
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            debouncedSearchQuery={debouncedSearchQuery}
            replaceQuery={replaceQuery}
            setReplaceQuery={setReplaceQuery}
            showReplace={showReplace}
            setShowReplace={(v) => setShowReplace(v)}
            searchOptions={searchOptions}
            setSearchOptions={setSearchOptions}
            fileFilter={fileFilter}
            setFileFilter={setFileFilter}
            isIndexingComplete={isIndexingComplete}
            indexingPercent={indexingPercent}
            resultsContainerRef={resultsContainerRef}
            searchResults={searchResults}
            goToSearchResult={goToSearchResult}
            visibleResultCount={visibleResultCount}
            setVisibleResultCount={setVisibleResultCount}
            totalMatchCount={totalMatchCount}
            confirmReplaceAll={confirmReplaceAll}
            setConfirmReplaceAll={setConfirmReplaceAll}
            replaceInFile={replaceInFile}
            replaceAllInFile={replaceAllInFile}
            replaceAllInAllFiles={replaceAllInAllFiles}
            expandAllMatches={expandAllMatches}
            setExpandAllMatches={setExpandAllMatches}
          />
        ) : (
          <SymbolOutline
            symbols={outlineSymbols}
            onSymbolClick={(line) => {
              if (activeTab) {
                setHighlightedLine({ path: activeTab.path, line })
              }
            }}
            activeSymbol={highlightedLine?.path === activeTab?.path ? highlightedLine?.line : undefined}
          />
        )}
      </div>
      
      {/* Editor Area */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Tab Bar */}
        {openTabs.length > 0 && (
          <div className="h-9 flex items-end bg-muted border-b border-foreground/[0.06] overflow-x-auto">
            {openTabs.map((tab) => (
              <div
                key={tab.path}
                className={cn(
                  "h-full flex items-center gap-2 px-3 border-r border-foreground/[0.06] cursor-pointer group",
                  tab.path === activeTabPath 
                    ? "bg-background text-text-primary" 
                    : "bg-surface-secondary text-text-secondary hover:bg-surface"
                )}
                onClick={() => setActiveTabPath(tab.path)}
              >
                <File className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="text-sm truncate max-w-[120px]">{tab.name}</span>
                {/* Revert button on modified tabs */}
                {tab.isModified && (
                  <button
                    className="h-4 w-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      revertFile(tab.path)
                    }}
                    title="Revert changes"
                  >
                    <Undo2 className="h-3 w-3 text-amber-400" />
                  </button>
                )}
                <button
                  className="h-4 w-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100"
                  onClick={(e) => closeTab(tab.path, e)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Breadcrumb */}
        {activeTab && (
          <div className="h-6 flex items-center px-4 bg-background border-b border-foreground/[0.06]">
            <div className="flex items-center gap-1 text-xs text-text-muted">
              {activeTab.path.split('/').map((part, i, arr) => {
                const isFile = i === arr.length - 1
                return (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3" />}
                    {isFile ? (
                      <span className="text-text-primary">
                        <File className="h-3 w-3 inline mr-1" />
                        {part}
                      </span>
                    ) : (
                      <button
                        className="hover:text-text-primary"
                        onClick={() => {
                          const segments = arr.slice(0, i + 1)
                          for (let s = 1; s <= segments.length; s++) {
                            const folderPath = segments.slice(0, s).join('/')
                            if (!expandedFolders.has(folderPath)) {
                              toggleFolder(folderPath)
                            }
                          }
                          setSidebarMode('explorer')
                        }}
                      >
                        {i === 0 ? <Folder className="h-3 w-3 inline mr-1" /> : null}
                        {part}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Editor Content */}
        <div className="flex-1 overflow-auto">
          {renderEditorContent()}
        </div>
      </div>
    </div>
  )
}
