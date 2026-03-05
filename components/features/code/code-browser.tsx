"use client"

import React, { useState, useEffect, useMemo, useCallback } from "react"
import { Code2 } from "lucide-react"
import { useRepository, useAPIKeys } from "@/providers"
import type { CodeBrowserProps, SidebarMode, SymbolRange, InlineActionType } from "./types"
import { useFileOperations } from "./hooks/use-file-operations"
import { useSearch } from "./hooks/use-search"
import { useReplace } from "./hooks/use-replace"
import { useDownloads } from "./hooks/use-downloads"
import { scanIssues } from "@/lib/code/issue-scanner"
import type { CodeIssue } from "@/lib/code/issue-scanner"
import type { FileIssueCounts } from "./file-tree-node"
import { SearchSidebar } from "./search-sidebar"
import { SymbolOutline } from "./symbol-outline"
import { useSymbolExtraction } from "./hooks/use-symbol-extraction"
import { useSymbolRanges } from "./hooks/use-symbol-ranges"
import { useInlineActions } from "./hooks/use-inline-actions"
import { useSearchStateDispatchers } from "./hooks/use-search-state-dispatchers"
import { CodeActivityBar } from "./code-activity-bar"
import { CodeEditorContent } from "./code-editor-content"
import { CodeTabBar, CodeBreadcrumb } from "./code-tab-bar"
import { CodeExplorerSidebar } from "./code-explorer-sidebar"
import { InlineActionPanel } from "./inline-action-panel"

export function CodeBrowser({ navigateToFile, onNavigateComplete }: CodeBrowserProps) {
  const { repo, files, codeIndex, updateCodeIndex, indexingProgress: sharedIndexingProgress, modifiedContents, setModifiedContents, getFileContent, codebaseAnalysis } = useRepository()

  // Sidebar state
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('explorer')

  // Search state – persisted at provider level
  const { searchState, setSearchState } = useRepository()
  const {
    searchQuery, setSearchQuery, debouncedSearchQuery, setDebouncedSearchQuery,
    replaceQuery, setReplaceQuery, showReplace, setShowReplace,
    fileFilter, setFileFilter, searchOptions, setSearchOptions,
  } = useSearchStateDispatchers(searchState, setSearchState)

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

  // --- Inline Actions ---
  const lineCount = activeTab?.content ? activeTab.content.split('\n').length : 0
  const symbolRanges = useSymbolRanges(outlineSymbols, lineCount)
  const { result: inlineResult, triggerAction, dismissAction } = useInlineActions(codeIndex)
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const hasApiKey = getValidProviders().length > 0 && selectedModel !== null
  const [hoveredSymbolRange, setHoveredSymbolRange] = useState<SymbolRange | null>(null)
  const isPanelOpen = inlineResult !== null

  const onLineHover = useCallback(
    (lineNumber: number) => {
      if (symbolRanges.length === 0) {
        setHoveredSymbolRange(null)
        return
      }
      // Find the most specific (innermost) symbol range containing this line
      let best: SymbolRange | null = null
      for (const range of symbolRanges) {
        if (lineNumber >= range.startLine && lineNumber <= range.endLine) {
          if (!best || (range.endLine - range.startLine) < (best.endLine - best.startLine)) {
            best = range
          }
        }
      }
      setHoveredSymbolRange(best)
    },
    [symbolRanges],
  )

  const onLineLeave = useCallback(() => {
    setHoveredSymbolRange(null)
  }, [])

  const onAction = useCallback(
    (type: InlineActionType) => {
      if (!hoveredSymbolRange || !activeTab?.content || !activeTab?.path) return
      const provider = selectedModel?.provider ?? ''
      const model = selectedModel?.id ?? ''
      const key = provider ? (apiKeys[provider as keyof typeof apiKeys]?.key ?? '') : ''
      triggerAction(
        type,
        hoveredSymbolRange,
        activeTab.content,
        activeTab.path,
        activeTab.language ?? '',
        key,
        provider,
        model,
      )
    },
    [hoveredSymbolRange, activeTab, selectedModel, apiKeys, triggerAction],
  )

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

  // Reset inline action panel and hovered symbol when switching files
  useEffect(() => {
    dismissAction()
    setHoveredSymbolRange(null)
  }, [activeTabPath]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-text-muted animate-in fade-in duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
            <Code2 className="h-6 w-6 text-text-secondary" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-text-secondary">No repository connected</p>
            <p className="text-xs text-center max-w-[260px]">Connect a GitHub repository to browse, search, and edit source code</p>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex h-full bg-background">
      {/* Activity Bar */}
      <CodeActivityBar sidebarMode={sidebarMode} onModeChange={setSidebarMode} />
      
      {/* Sidebar */}
      <div className="w-60 shrink-0 bg-background border-r border-foreground/[0.06] flex flex-col">
        {sidebarMode === 'explorer' ? (
          <CodeExplorerSidebar
            files={files}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onFileSelect={openFile}
            onDownloadFile={downloadExplorerFile}
            onDownloadFolder={downloadExplorerFolder}
            onDownloadFullProject={downloadFullProject}
            activeFilePath={activeTabPath}
            codeIndex={codeIndex}
            issueCountByFile={issueCountByFile}
            modifiedTabs={modifiedTabs}
            onDownloadAllModified={downloadAllModified}
            onRevertFile={revertFile}
            onDownloadFile2={downloadFile}
          />
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
        <CodeTabBar
          openTabs={openTabs}
          activeTabPath={activeTabPath}
          onTabSelect={setActiveTabPath}
          onTabClose={closeTab}
          onRevertFile={revertFile}
        />
        {activeTab && (
          <CodeBreadcrumb
            path={activeTab.path}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onSwitchToExplorer={() => setSidebarMode('explorer')}
          />
        )}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-auto min-w-0">
            <CodeEditorContent
              isIndexingComplete={isIndexingComplete}
              indexingPercent={indexingPercent}
              indexingCurrent={indexingProgress.current}
              indexingTotal={indexingProgress.total}
              activeTab={activeTab ? {
                path: activeTab.path,
                content: activeTab.content,
                language: activeTab.language,
                isLoading: activeTab.isLoading,
                error: activeTab.error,
              } : null}
              highlightedLine={highlightedLine}
              onHighlightComplete={() => setHighlightedLine(null)}
              searchQuery={debouncedSearchQuery}
              searchOptions={searchOptions}
              sidebarMode={sidebarMode}
              issues={activeFileIssues}
              symbolRanges={symbolRanges}
              onLineHover={onLineHover}
              onLineLeave={onLineLeave}
              hoveredSymbolRange={hoveredSymbolRange}
              onAction={onAction}
              hasApiKey={hasApiKey}
            />
          </div>
          <InlineActionPanel
            result={inlineResult}
            onClose={dismissAction}
            isOpen={isPanelOpen}
          />
        </div>
      </div>
    </div>
  )
}
