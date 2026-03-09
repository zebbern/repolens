"use client"

import type { CategoryFilterKey, FilterMode, FilteredSummary } from './issue-types'
import { CATEGORY_COUNT_KEY } from './issue-types'
import { CATEGORY_CONFIG } from './constants'
import { cn } from '@/lib/utils'

interface IssueFiltersProps {
  filter: FilterMode
  setFilter: React.Dispatch<React.SetStateAction<FilterMode>>
  filteredSummary: FilteredSummary
  hideInfo: boolean
  setHideInfo: React.Dispatch<React.SetStateAction<boolean>>
  hideLowConfidence: boolean
  setHideLowConfidence: React.Dispatch<React.SetStateAction<boolean>>
  totalIssueCount: number
}

export function IssueFilters({
  filter, setFilter, filteredSummary,
  hideInfo, setHideInfo, hideLowConfidence, setHideLowConfidence,
  totalIssueCount,
}: IssueFiltersProps) {
  return (
    <>
      {/* Summary severity badges */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] text-text-muted">Issues by Severity</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {filteredSummary.critical > 0 && (
          <button
            onClick={() => setFilter(f => f === 'critical' ? 'all' : 'critical')}
            aria-pressed={filter === 'critical'}
            className={cn(
              'rounded-lg border p-2 text-left transition-colors',
              filter === 'critical' ? 'border-red-500/40 bg-red-500/15' : 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
            )}
          >
            <p className="text-lg font-bold text-red-400 tabular-nums">{filteredSummary.critical}</p>
            <p className="text-[10px] text-red-400/70">Critical</p>
          </button>
        )}
        {filteredSummary.warning > 0 && (
          <button
            onClick={() => setFilter(f => f === 'warning' ? 'all' : 'warning')}
            aria-pressed={filter === 'warning'}
            className={cn(
              'rounded-lg border p-2 text-left transition-colors',
              filter === 'warning' ? 'border-amber-500/40 bg-amber-500/15' : 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
            )}
          >
            <p className="text-lg font-bold text-amber-400 tabular-nums">{filteredSummary.warning}</p>
            <p className="text-[10px] text-amber-400/70">Warnings</p>
          </button>
        )}
        {filteredSummary.info > 0 && (
          <button
            onClick={() => setFilter(f => f === 'info' ? 'all' : 'info')}
            aria-pressed={filter === 'info'}
            className={cn(
              'rounded-lg border p-2 text-left transition-colors',
              filter === 'info' ? 'border-blue-500/40 bg-blue-500/15' : 'border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10'
            )}
          >
            <p className="text-lg font-bold text-blue-400 tabular-nums">{filteredSummary.info}</p>
            <p className="text-[10px] text-blue-400/70">Info</p>
          </button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
            filter === 'all'
              ? 'bg-foreground/10 border-foreground/20 text-text-primary'
              : 'border-foreground/6 text-text-muted hover:text-text-secondary hover:bg-foreground/5'
          )}
        >
          All ({filteredSummary.total})
        </button>
        {(Object.keys(CATEGORY_CONFIG) as CategoryFilterKey[]).map(cat => {
          const count = filteredSummary[CATEGORY_COUNT_KEY[cat]]
          if (count === 0) return null
          const cfg = CATEGORY_CONFIG[cat]
          return (
            <button
              key={cat}
              onClick={() => setFilter(f => f === cat ? 'all' : cat)}
              aria-pressed={filter === cat}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1',
                filter === cat
                  ? 'bg-foreground/10 border-foreground/20 text-text-primary'
                  : 'border-foreground/6 text-text-muted hover:text-text-secondary hover:bg-foreground/5'
              )}
            >
              <cfg.icon className="h-2.5 w-2.5" />
              {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Visibility toggles */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-foreground/4">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!hideInfo}
            onChange={() => setHideInfo(h => !h)}
            className="h-3 w-3 rounded border-foreground/20 accent-blue-500"
          />
          <span className="text-[10px] text-text-muted">Show info</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!hideLowConfidence}
            onChange={() => setHideLowConfidence(h => !h)}
            className="h-3 w-3 rounded border-foreground/20 accent-blue-500"
          />
          <span className="text-[10px] text-text-muted">Show low confidence</span>
        </label>
        {(hideInfo || hideLowConfidence) && filteredSummary.total < totalIssueCount && (
          <span className="text-[9px] text-text-muted/60 ml-auto">
            {totalIssueCount - filteredSummary.total} hidden
          </span>
        )}
      </div>
    </>
  )
}
