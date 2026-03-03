"use client"

import React from "react"
import {
  Search, ChevronRight,
  CaseSensitive, Regex, WholeWord, Replace, Filter,
  ReplaceAll, HelpCircle, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { SearchResult } from "@/lib/code/code-index"
import type { SearchOptions } from "./types"
import { SearchResultItem } from "./search-result-item"

export interface SearchSidebarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>
  searchQuery: string
  setSearchQuery: (v: string) => void
  debouncedSearchQuery: string
  replaceQuery: string
  setReplaceQuery: (v: string) => void
  showReplace: boolean
  setShowReplace: (v: boolean) => void
  searchOptions: SearchOptions
  setSearchOptions: (v: SearchOptions | ((p: SearchOptions) => SearchOptions)) => void
  fileFilter: string
  setFileFilter: (v: string) => void
  isIndexingComplete: boolean
  indexingPercent: number
  resultsContainerRef: React.RefObject<HTMLDivElement | null>
  searchResults: SearchResult[]
  goToSearchResult: (file: string, line: number) => void
  visibleResultCount: number
  setVisibleResultCount: (v: number | ((p: number) => number)) => void
  totalMatchCount: number
  confirmReplaceAll: boolean
  setConfirmReplaceAll: (v: boolean) => void
  replaceInFile: (file: string, line: number) => void
  replaceAllInFile: (file: string) => void
  replaceAllInAllFiles: () => void
  expandAllMatches: boolean
  setExpandAllMatches: (v: boolean | ((p: boolean) => boolean)) => void
}

export function SearchSidebar({
  searchInputRef,
  searchQuery,
  setSearchQuery,
  debouncedSearchQuery,
  replaceQuery,
  setReplaceQuery,
  showReplace,
  setShowReplace,
  searchOptions,
  setSearchOptions,
  fileFilter,
  setFileFilter,
  isIndexingComplete,
  indexingPercent,
  resultsContainerRef,
  searchResults,
  goToSearchResult,
  visibleResultCount,
  setVisibleResultCount,
  totalMatchCount,
  confirmReplaceAll,
  setConfirmReplaceAll,
  replaceInFile,
  replaceAllInFile,
  replaceAllInAllFiles,
  expandAllMatches,
  setExpandAllMatches,
}: SearchSidebarProps) {
  return (
    <>
      {/* Search Header */}
      <div className="h-9 flex items-center px-4 text-xs font-medium text-text-muted uppercase tracking-wide">
        Search
      </div>

      {/* Search Input */}
      <div className="px-2 pb-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search (Ctrl+Shift+F)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-2 text-sm bg-[#3c3c3c] border-transparent focus:border-[#007fd4]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchResults.length > 0) {
                const firstResult = searchResults[0]
                if (firstResult.matches.length > 0) {
                  goToSearchResult(firstResult.file, firstResult.matches[0].line)
                }
              }
            }}
          />
        </div>

        {/* Replace Input */}
        {showReplace && (
          <div className="relative">
            <Replace className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <Input
              type="text"
              placeholder="Replace"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              className="h-7 pl-8 pr-2 text-sm bg-[#3c3c3c] border-transparent focus:border-[#007fd4]"
            />
            {searchOptions.regex && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="absolute right-2 top-1/2 -translate-y-1/2">
                      <HelpCircle className="h-3 w-3 text-text-muted hover:text-text-primary" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] bg-[#252526] border-white/10 text-xs text-text-secondary">
                    <p className="font-medium text-text-primary mb-1">Regex Replace</p>
                    <p>{'Use $1, $2, etc. for capture group backreferences.'}</p>
                    <p className="mt-1 text-text-muted">{'Example: (.+) -> $1_suffix'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}

        {/* Search Options */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", searchOptions.caseSensitive ? "bg-white/20 text-text-primary" : "text-text-muted")}
            onClick={() => setSearchOptions(p => ({ ...p, caseSensitive: !p.caseSensitive }))}
            title="Match Case"
          >
            <CaseSensitive className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", searchOptions.wholeWord ? "bg-white/20 text-text-primary" : "text-text-muted")}
            onClick={() => setSearchOptions(p => ({ ...p, wholeWord: !p.wholeWord }))}
            title="Match Whole Word"
          >
            <WholeWord className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", searchOptions.regex ? "bg-white/20 text-text-primary" : "text-text-muted")}
            onClick={() => setSearchOptions(p => ({ ...p, regex: !p.regex }))}
            title="Use Regular Expression"
          >
            <Regex className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", showReplace ? "bg-white/20 text-text-primary" : "text-text-muted")}
            onClick={() => setShowReplace(!showReplace)}
            title="Toggle Replace (Ctrl+H)"
          >
            <Replace className="h-3.5 w-3.5" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6", fileFilter ? "bg-white/20 text-text-primary" : "text-text-muted")}
                title="Filter Files"
              >
                <Filter className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-[#252526] border-white/10" align="start">
              <div className="space-y-2">
                <p className="text-xs text-text-muted">Files to include</p>
                <Input
                  type="text"
                  placeholder="*.tsx, src/*"
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  className="h-7 text-xs bg-[#3c3c3c] border-transparent focus:border-[#007fd4]"
                />
                <p className="text-[10px] text-text-muted">
                  Comma separated. Examples: *.tsx, src/*, components
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Search Results */}
      <div className="flex-1 overflow-auto" ref={resultsContainerRef}>
        {!isIndexingComplete ? (
          <div className="px-4 py-8 text-center">
            <div className="relative w-12 h-12 mx-auto mb-3">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="none" />
                <circle
                  cx="24" cy="24" r="20"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - indexingPercent / 100)}`}
                  className="transition-all duration-300"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-text-primary">
                {indexingPercent}%
              </span>
            </div>
            <p className="text-xs text-text-muted">Indexing...</p>
          </div>
        ) : searchQuery && searchResults.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No results found
          </div>
        ) : searchResults.length > 0 ? (
          <div className="px-2">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-text-muted">
                {totalMatchCount} results in {searchResults.length} files
              </span>
              <div className="flex items-center gap-1">
                {showReplace && (
                  confirmReplaceAll ? (
                    <div className="flex items-center gap-1 bg-[#3c3c3c] rounded px-1.5 py-0.5">
                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                      <span className="text-[10px] text-text-secondary">Replace all?</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 px-1 text-[10px] text-status-success hover:bg-white/10"
                        onClick={replaceAllInAllFiles}
                      >
                        Yes
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 px-1 text-[10px] text-text-muted hover:bg-white/10"
                        onClick={() => setConfirmReplaceAll(false)}
                      >
                        No
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-text-muted hover:text-text-primary gap-1"
                      onClick={() => setConfirmReplaceAll(true)}
                      title="Replace All in All Files"
                    >
                      <ReplaceAll className="h-3 w-3" />
                      Replace All
                    </Button>
                  )
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-text-muted hover:text-text-primary"
                  onClick={() => setExpandAllMatches(prev => !prev)}
                >
                  {expandAllMatches ? 'Collapse' : 'Expand All'}
                </Button>
              </div>
            </div>
            {searchResults.slice(0, visibleResultCount).map((result) => (
              <SearchResultItem
                key={result.file}
                result={result}
                query={debouncedSearchQuery}
                replaceQuery={replaceQuery}
                searchOptions={searchOptions}
                showReplace={showReplace}
                expandAllMatches={expandAllMatches}
                onGoTo={goToSearchResult}
                onReplace={replaceInFile}
                onReplaceAll={replaceAllInFile}
              />
            ))}
            {visibleResultCount < searchResults.length && (
              <div className="px-2 py-2 text-center">
                <button
                  className="text-xs text-text-muted hover:text-text-secondary"
                  onClick={() => setVisibleResultCount(prev => Math.min(prev + 50, searchResults.length))}
                >
                  Showing {visibleResultCount} of {searchResults.length} files - click to load more
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
