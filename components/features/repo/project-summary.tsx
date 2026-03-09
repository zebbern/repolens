"use client"

import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Target, ChevronRight, Link2,
  FileWarning, Activity, Loader2, Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { generateProjectSummary, type ProjectSummary } from '@/lib/diagrams/diagram-data'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { CodeIndex } from '@/lib/code/code-index'
import { useRepositoryData } from '@/providers'

// ---------------------------------------------------------------------------
// Language colors + labels
// ---------------------------------------------------------------------------

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6', tsx: '#3178c6',
  javascript: '#f7df1e', jsx: '#f7df1e',
  css: '#264de4', scss: '#cf649a', html: '#e34c26',
  json: '#292929', markdown: '#083fa1',
  python: '#3776ab', rust: '#dea584', go: '#00add8',
  yaml: '#cb171e', toml: '#9c4121', sql: '#e38c00',
  graphql: '#e535ab', prisma: '#2d3748',
  csharp: '#68217a', java: '#b07219', kotlin: '#A97BFF',
  ruby: '#CC342D', php: '#4F5D95', swift: '#FA7343', dart: '#00B4AB',
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript',
  python: 'Python', go: 'Go', rust: 'Rust', php: 'PHP',
  ruby: 'Ruby', java: 'Java', kotlin: 'Kotlin',
  csharp: 'C#', swift: 'Swift', dart: 'Dart',
  css: 'CSS', html: 'HTML', json: 'JSON', yaml: 'YAML',
  unknown: 'Other',
}

function getLangColor(lang?: string): string {
  if (!lang) return '#475569'
  return LANGUAGE_COLORS[lang.toLowerCase()] || '#475569'
}

// ---------------------------------------------------------------------------
// Dashboard (pure presentation)
// ---------------------------------------------------------------------------

/**
 * Show a short disambiguated path: parent/filename for clarity.
 * Falls back to full path if only one segment.
 */
function shortPath(p: string): string {
  const parts = p.split('/')
  if (parts.length <= 1) return p
  return parts.slice(-2).join('/')
}

function SummaryDashboard({ data, onNavigate }: { data: ProjectSummary; onNavigate?: (path: string) => void }) {
  const maxHubCount = data.topHubs.length > 0 ? data.topHubs[0].importerCount : 1
  const maxConsumerCount = data.topConsumers.length > 0 ? data.topConsumers[0].depCount : 1
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center gap-3 pb-2 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary tracking-tight">Project Overview</h2>
        </div>
        {data.frameworkDetected && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
            {data.frameworkDetected}
          </span>
        )}
        <span className="text-xs text-text-muted ml-auto">
          {data.totalFiles} files, {data.totalLines.toLocaleString()} lines
        </span>
      </div>

      {/* Health issues */}
      {data.healthIssues.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Health Issues ({data.healthIssues.length})
          </div>
          {data.healthIssues.map((issue, i) => (
            <p key={i} className="text-xs text-amber-300/70 pl-5">{issue}</p>
          ))}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Module Groups', value: data.clusterCount, sub: 'Isolated groups of interconnected files' },
          { label: 'Deepest Chain', value: data.maxDepth, sub: 'Longest path of file-imports-file' },
          { label: 'Circular Deps', value: data.circularDeps.length, sub: data.circularDeps.length > 0 ? 'Files that import each other' : 'No circular imports found', warn: data.circularDeps.length > 0 },
          { label: 'Unused Files', value: data.orphanFiles.length, sub: data.orphanFiles.length > 0 ? 'Not imported by any other file' : 'All files are connected', warn: data.orphanFiles.length > 5 },
        ].map(metric => (
          <div key={metric.label} className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3">
            <p className="text-xs text-text-muted">{metric.label}</p>
            <p className={cn('text-xl font-bold tabular-nums mt-0.5', metric.warn ? 'text-amber-400' : 'text-text-primary')}>
              {metric.value}
            </p>
            <p className="text-[10px] text-text-muted leading-tight">{metric.sub}</p>
          </div>
        ))}
      </div>

      {/* Language breakdown */}
      <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
        <h3 className="text-xs font-medium text-text-secondary mb-3">Language Breakdown</h3>
        <div className="h-3 rounded-full overflow-hidden flex bg-foreground/5 mb-3">
          {data.languages.filter(l => l.pct > 0.5).map(l => (
            <div
              key={l.lang}
              className="h-full transition-all"
              style={{ width: `${l.pct}%`, backgroundColor: getLangColor(l.lang) }}
              title={`${LANGUAGE_LABELS[l.lang] || l.lang}: ${l.pct}%`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.languages.slice(0, 8).map(l => (
            <div key={l.lang} className="flex items-center gap-1.5 text-xs text-text-muted">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getLangColor(l.lang) }} />
              <span className="text-text-secondary">{LANGUAGE_LABELS[l.lang] || l.lang}</span>
              <span>{l.files} files</span>
              <span className="text-text-muted/60">{l.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Folder breakdown */}
      {data.folderBreakdown && data.folderBreakdown.length > 1 && (
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-1">Where the Code Lives</h3>
          <p className="text-[10px] text-text-muted mb-3">Lines of code by top-level folder. Largest folders contain the core logic.</p>
          <div className="flex flex-col gap-2">
            {data.folderBreakdown.slice(0, 8).map(f => (
              <div key={f.folder} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-28 truncate shrink-0 font-mono" title={f.folder}>{f.folder}/</span>
                <div className="flex-1 h-2 rounded-full bg-foreground/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500/40"
                    style={{ width: `${(f.lines / data.folderBreakdown[0].lines) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-muted tabular-nums shrink-0 w-20 text-right">
                  {f.lines.toLocaleString()} lines
                </span>
                <span className="text-[10px] text-text-muted/60 tabular-nums shrink-0 w-8 text-right">
                  {f.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Most Imported + Most Dependencies */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Most Imported */}
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
            <Target className="h-3 w-3 text-amber-400" />
            Most Imported Files
          </h3>
          <p className="text-[10px] text-text-muted mb-2.5">Files that the most other files depend on. Changes here have the widest impact.</p>
          {data.topHubs.length === 0 ? (
            <p className="text-xs text-text-muted">No shared files detected</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.topHubs.slice(0, 8).map(hub => (
                <button
                  key={hub.path}
                  onClick={() => onNavigate?.(hub.path)}
                  className="flex flex-col gap-1 text-left py-1.5 px-2 rounded hover:bg-foreground/5 transition-colors group"
                  title={hub.path}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs text-text-secondary truncate mr-2 group-hover:text-text-primary transition-colors">
                      {shortPath(hub.path)}
                    </span>
                    <span className="text-[10px] text-text-muted shrink-0 tabular-nums">used by {hub.importerCount} files</span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-foreground/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500/40"
                      style={{ width: `${(hub.importerCount / maxHubCount) * 100}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Most Dependencies */}
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
            <ArrowRight className="h-3 w-3 text-blue-400" />
            Heaviest Files
          </h3>
          <p className="text-[10px] text-text-muted mb-2.5">Files that import the most other files. Complex and potentially hard to maintain.</p>
          {data.topConsumers.length === 0 ? (
            <p className="text-xs text-text-muted">No complex files detected</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.topConsumers.slice(0, 8).map(consumer => (
                <button
                  key={consumer.path}
                  onClick={() => onNavigate?.(consumer.path)}
                  className="flex flex-col gap-1 text-left py-1.5 px-2 rounded hover:bg-foreground/5 transition-colors group"
                  title={consumer.path}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs text-text-secondary truncate mr-2 group-hover:text-text-primary transition-colors">
                      {shortPath(consumer.path)}
                    </span>
                    <span className="text-[10px] text-text-muted shrink-0 tabular-nums">imports {consumer.depCount} files</span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-foreground/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/40"
                      style={{ width: `${(consumer.depCount / maxConsumerCount) * 100}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* External Dependencies */}
      {data.externalDeps && data.externalDeps.length > 0 && (
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
            <Package className="h-3 w-3 text-cyan-400" />
            External Packages ({data.externalDeps.length})
          </h3>
          <p className="text-[10px] text-text-muted mb-2.5">Third-party packages the project depends on, ranked by how many files use them.</p>
          <div className="flex flex-wrap gap-1.5">
            {(expandedSections.externalDeps ? data.externalDeps : data.externalDeps.slice(0, 8)).map(dep => (
              <div
                key={dep.pkg}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06]"
              >
                <span className="text-text-secondary font-mono text-[11px]">{dep.pkg}</span>
                <span className="text-[10px] text-text-muted tabular-nums">{dep.usedByCount} files</span>
              </div>
            ))}
            {data.externalDeps.length > 8 && (
              <button onClick={() => toggleSection('externalDeps')} className="text-[10px] text-text-muted hover:text-text-secondary px-2.5 py-1.5 transition-colors">
                {expandedSections.externalDeps ? 'Show less' : `+${data.externalDeps.length - 8} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Entry points + Connectors */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.entryPoints.length > 0 && (
          <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-emerald-400" />
              Entry Points ({data.entryPoints.length})
            </h3>
            <p className="text-[10px] text-text-muted mb-2">Starting files that nothing else imports. Often the app's main files or test runners.</p>
            <div className="flex flex-col gap-0.5">
              {(expandedSections.entryPoints ? data.entryPoints : data.entryPoints.slice(0, 6)).map(ep => (
                <button
                  key={ep}
                  onClick={() => onNavigate?.(ep)}
                  className="text-xs text-text-secondary py-1 px-2 rounded hover:bg-foreground/5 transition-colors text-left truncate hover:text-text-primary"
                  title={ep}
                >
                  {ep}
                </button>
              ))}
              {data.entryPoints.length > 6 && (
                <button onClick={() => toggleSection('entryPoints')} className="text-xs text-text-muted hover:text-text-secondary px-2 py-0.5 transition-colors">
                  {expandedSections.entryPoints ? 'Show less' : `+${data.entryPoints.length - 6} more`}
                </button>
              )}
            </div>
          </div>
        )}

        {data.connectors.length > 0 && (
          <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
              <Link2 className="h-3 w-3 text-blue-400" />
              Bridge Files ({data.connectors.length})
            </h3>
            <p className="text-[10px] text-text-muted mb-2">Critical files that connect separate parts of the codebase. Removing any would split the project into disconnected pieces.</p>
            <div className="flex flex-col gap-0.5">
              {(expandedSections.connectors ? data.connectors : data.connectors.slice(0, 6)).map(c => (
                <button
                  key={c}
                  onClick={() => onNavigate?.(c)}
                  className="text-xs text-text-secondary py-1 px-2 rounded hover:bg-foreground/5 transition-colors text-left truncate hover:text-text-primary"
                  title={c}
                >
                  {shortPath(c)}
                </button>
              ))}
              {data.connectors.length > 6 && (
                <button onClick={() => toggleSection('connectors')} className="text-xs text-text-muted hover:text-text-secondary px-2 py-0.5 transition-colors">
                  {expandedSections.connectors ? 'Show less' : `+${data.connectors.length - 6} more`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unused files */}
      {data.orphanFiles.length > 0 && (
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-1 flex items-center gap-1.5">
            <FileWarning className="h-3 w-3 text-gray-400" />
            Unused Files ({data.orphanFiles.length})
          </h3>
          <p className="text-[10px] text-text-muted mb-2">Files that don't import anything and aren't imported by other files. May be dead code, configs, or standalone scripts.</p>
          <div className="flex flex-wrap gap-1">
            {(expandedSections.orphans ? data.orphanFiles : data.orphanFiles.slice(0, 12)).map(o => (
              <button
                key={o}
                onClick={() => onNavigate?.(o)}
                className="text-[10px] text-text-muted px-2 py-1 rounded bg-foreground/[0.03] hover:bg-foreground/5 transition-colors truncate max-w-[240px]"
                title={o}
              >
                {shortPath(o)}
              </button>
            ))}
            {data.orphanFiles.length > 12 && (
              <button onClick={() => toggleSection('orphans')} className="text-[10px] text-text-muted hover:text-text-secondary px-2 py-1 transition-colors">
                {expandedSections.orphans ? 'Show less' : `+${data.orphanFiles.length - 12} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Circular deps */}
      {data.circularDeps.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h3 className="text-xs font-medium text-red-400 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            Circular Dependencies ({data.circularDeps.length})
          </h3>
          <p className="text-[10px] text-red-300/50 mb-2">These file pairs import each other, which can cause bugs and makes refactoring harder.</p>
          <div className="flex flex-col gap-1.5">
            {data.circularDeps.slice(0, 8).map(([a, b], i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-red-500/5">
                <button onClick={() => onNavigate?.(a)} className="text-red-300/70 hover:text-red-300 transition-colors truncate" title={a}>{shortPath(a)}</button>
                <span className="text-red-500/40 shrink-0">{'<->'}</span>
                <button onClick={() => onNavigate?.(b)} className="text-red-300/70 hover:text-red-300 transition-colors truncate" title={b}>{shortPath(b)}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported wrapper: runs analysis and renders summary
// ---------------------------------------------------------------------------

interface ProjectSummaryPanelProps {
  codeIndex: CodeIndex
  onNavigateToFile?: (path: string) => void
}

export function ProjectSummaryPanel({ codeIndex, onNavigateToFile }: ProjectSummaryPanelProps) {
  const { codebaseAnalysis: analysis } = useRepositoryData()

  const summaryData = useMemo<ProjectSummary | null>(() => {
    if (!analysis) return null
    const result = generateProjectSummary(analysis, codeIndex)
    return result.data
  }, [analysis, codeIndex])

  if (!summaryData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          <p className="text-xs text-text-muted">Analyzing codebase...</p>
        </div>
      </div>
    )
  }

  return <SummaryDashboard data={summaryData} onNavigate={onNavigateToFile} />
}
