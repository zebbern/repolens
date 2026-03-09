"use client"

import { Info } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface ProjectOverviewResult {
  totalFiles?: number
  totalLines?: number
  languages?: [string, number][]
  topFolders?: [string, number][]
  hasTests?: boolean
  hasConfig?: boolean
  entryPoints?: string[]
  repoMeta?: {
    stars?: number
    forks?: number
    description?: string
    topics?: string[]
    license?: string
    language?: string
  }
  error?: string
}

const LANG_COLORS: Record<string, string> = {
  ts: "bg-blue-500",
  tsx: "bg-blue-400",
  js: "bg-yellow-400",
  jsx: "bg-yellow-300",
  py: "bg-green-500",
  rs: "bg-orange-500",
  go: "bg-cyan-500",
  java: "bg-red-400",
  css: "bg-purple-400",
  scss: "bg-pink-400",
  json: "bg-gray-400",
  md: "bg-gray-500",
  html: "bg-orange-400",
}

export default function ProjectOverviewRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ProjectOverviewResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const languages = data.languages ?? []
  const totalLangFiles = languages.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3">
        <Info className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] text-text-secondary font-medium">Project Overview</span>
      </div>

      <div className="p-2 space-y-2">
        {/* Key stats */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          {data.totalFiles != null && (
            <div>
              <span className="text-text-muted">Files</span>
              <span className="ml-1.5 text-text-primary font-medium">{data.totalFiles.toLocaleString()}</span>
            </div>
          )}
          {data.totalLines != null && (
            <div>
              <span className="text-text-muted">Lines</span>
              <span className="ml-1.5 text-text-primary font-medium">{data.totalLines.toLocaleString()}</span>
            </div>
          )}
          {data.repoMeta?.stars != null && (
            <div>
              <span className="text-text-muted">Stars</span>
              <span className="ml-1.5 text-text-primary font-medium">{data.repoMeta.stars.toLocaleString()}</span>
            </div>
          )}
          {data.repoMeta?.license && (
            <div>
              <span className="text-text-muted">License</span>
              <span className="ml-1.5 text-text-primary font-medium">{data.repoMeta.license}</span>
            </div>
          )}
        </div>

        {/* Badges */}
        <div className="flex gap-1 flex-wrap">
          {data.hasTests && (
            <span className="text-[10px] px-1.5 py-px rounded bg-green-500/10 text-green-600 dark:text-green-400">
              Has tests
            </span>
          )}
          {data.hasConfig && (
            <span className="text-[10px] px-1.5 py-px rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
              Configured
            </span>
          )}
          {data.repoMeta?.topics?.slice(0, 5).map((topic) => (
            <span key={topic} className="text-[10px] px-1.5 py-px rounded bg-foreground/5 text-text-muted">
              {topic}
            </span>
          ))}
        </div>

        {/* Language distribution bar */}
        {languages.length > 0 && (
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Languages</div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-foreground/5">
              {languages.slice(0, 8).map(([lang, count]) => {
                const pct = totalLangFiles > 0 ? (count / totalLangFiles) * 100 : 0
                if (pct < 1) return null
                return (
                  <div
                    key={lang}
                    className={`${LANG_COLORS[lang] ?? "bg-gray-400"}`}
                    style={{ width: `${pct}%` }}
                    title={`${lang}: ${count} files (${pct.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0 mt-0.5">
              {languages.slice(0, 6).map(([lang, count]) => (
                <span key={lang} className="flex items-center gap-0.5 text-[10px] text-text-muted">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${LANG_COLORS[lang] ?? "bg-gray-400"}`} />
                  {lang}
                  <span className="text-text-muted/60">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Entry points */}
        {data.entryPoints && data.entryPoints.length > 0 && (
          <div>
            <div className="text-[10px] text-text-muted mb-0.5">Entry points</div>
            <div className="space-y-px">
              {data.entryPoints.slice(0, 5).map((ep) => (
                <div key={ep} className="text-[11px] font-mono text-blue-500 truncate">{ep}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
