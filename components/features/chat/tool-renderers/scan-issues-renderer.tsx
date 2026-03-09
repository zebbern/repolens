"use client"

import { useState } from "react"
import { Shield, ChevronDown, ChevronRight } from "lucide-react"
import { parseToolResult } from "./parse-result"
import type { ToolRendererProps } from "./index"

interface Issue {
  line?: number
  severity?: string
  message?: string
  ruleId?: string
  confidence?: string
  fix?: string
}

interface ScanIssuesResult {
  path?: string
  issueCount?: number
  issues?: Issue[]
  error?: string
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", label: "Critical" },
  error: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", label: "Error" },
  warning: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", label: "Warning" },
  info: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", label: "Info" },
  suggestion: { color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10", label: "Suggestion" },
}

function getSeverityConfig(severity?: string) {
  if (!severity) return SEVERITY_CONFIG.info
  return SEVERITY_CONFIG[severity.toLowerCase()] ?? SEVERITY_CONFIG.info
}

export default function ScanIssuesRenderer({ result }: ToolRendererProps) {
  const data = parseToolResult<ScanIssuesResult>(result)
  if (!data || data.error) {
    return (
      <div className="text-[11px] font-mono text-red-500">
        {data?.error ?? "Failed to parse result"}
      </div>
    )
  }

  const issues = data.issues ?? []

  // Group by severity
  const grouped = issues.reduce<Record<string, Issue[]>>((acc, issue) => {
    const key = (issue.severity ?? "info").toLowerCase()
    ;(acc[key] ??= []).push(issue)
    return acc
  }, {})

  const severityOrder = ["critical", "error", "warning", "info", "suggestion"]
  const sortedGroups = severityOrder.filter((s) => grouped[s]?.length)

  return (
    <div className="rounded border border-foreground/6 bg-surface-elevated overflow-hidden max-h-75 overflow-y-auto">
      {/* Summary header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-foreground/6 bg-foreground/3 sticky top-0">
        <Shield className="h-3 w-3 text-text-muted shrink-0" />
        <span className="text-[11px] text-text-secondary truncate">{data.path}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {sortedGroups.map((sev) => {
            const cfg = getSeverityConfig(sev)
            return (
              <span key={sev} className={`text-[10px] font-medium ${cfg.color}`}>
                {grouped[sev].length} {cfg.label.toLowerCase()}
              </span>
            )
          })}
        </span>
      </div>

      {issues.length === 0 ? (
        <div className="px-2 py-2 text-[11px] text-green-600 dark:text-green-400">
          ✓ No issues found
        </div>
      ) : (
        <div className="divide-y divide-foreground/6">
          {issues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </div>
      )}
    </div>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = getSeverityConfig(issue.severity)
  const hasFix = issue.fix != null && issue.fix.length > 0

  return (
    <div className="px-2 py-1">
      <button
        onClick={() => hasFix && setExpanded(!expanded)}
        className="flex items-start gap-1.5 w-full text-left"
        disabled={!hasFix}
      >
        {hasFix && (
          expanded
            ? <ChevronDown className="h-3 w-3 mt-0.5 text-text-muted shrink-0" />
            : <ChevronRight className="h-3 w-3 mt-0.5 text-text-muted shrink-0" />
        )}
        <span className={`text-[10px] font-medium shrink-0 px-1 rounded ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
        {issue.line != null && (
          <span className="text-[10px] text-text-muted shrink-0">L{issue.line}</span>
        )}
        <span className="text-[11px] text-text-secondary">{issue.message}</span>
        {issue.ruleId && (
          <span className="ml-auto text-[10px] text-text-muted font-mono shrink-0">{issue.ruleId}</span>
        )}
      </button>
      {expanded && issue.fix && (
        <pre className="mt-1 ml-5 text-[11px] font-mono text-green-600 dark:text-green-400 whitespace-pre-wrap bg-green-500/5 rounded px-2 py-1">
          {issue.fix}
        </pre>
      )}
    </div>
  )
}
