"use client"

import { BarChart3 } from "lucide-react"
import { useComparison } from "@/providers/comparison-provider"
import type { ComparisonRepo } from "@/types/comparison"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** Palette for up to 5 repos */
const REPO_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
] as const

/** Well-known language colors (GitHub-style) */
const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1e05a",
  python: "#3572A5",
  java: "#b07219",
  go: "#00ADD8",
  rust: "#dea584",
  ruby: "#701516",
  php: "#4F5D95",
  csharp: "#178600",
  cpp: "#f34b7d",
  c: "#555555",
  swift: "#F05138",
  kotlin: "#A97BFF",
  html: "#e34c26",
  css: "#563d7c",
  scss: "#c6538c",
  sass: "#a53b70",
  less: "#1d365d",
  vue: "#41b883",
  svelte: "#ff3e00",
  shell: "#89e051",
  markdown: "#083fa1",
  json: "#292929",
  yaml: "#cb171e",
  sql: "#e38c00",
  graphql: "#e10098",
  dockerfile: "#384d54",
}

const FALLBACK_LANGUAGE_COLOR = "#6b7280"

/** Format large numbers compactly: 1200 -> "1.2K" */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Format a date string as relative time (e.g., "2 days ago") */
function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  if (diffMonths < 12) return `${diffMonths}mo ago`
  return `${diffYears}y ago`
}

interface BarChartMetric {
  label: string
  getValue: (r: ComparisonRepo) => number
  format: (n: number) => string
}

const BAR_CHART_METRICS: BarChartMetric[] = [
  { label: "Stars", getValue: (r) => r.metrics?.stars ?? 0, format: formatCount },
  { label: "Forks", getValue: (r) => r.metrics?.forks ?? 0, format: formatCount },
  { label: "Open Issues", getValue: (r) => r.metrics?.openIssues ?? 0, format: formatCount },
  { label: "Files", getValue: (r) => r.metrics?.totalFiles ?? 0, format: formatCount },
  { label: "Lines (est.)", getValue: (r) => r.metrics?.totalLines ?? 0, format: formatCount },
]

interface TextMetric {
  label: string
  getValue: (r: ComparisonRepo) => string
}

const TEXT_METRICS: TextMetric[] = [
  {
    label: "Primary Language",
    getValue: (r) => r.metrics?.primaryLanguage ?? "—",
  },
  {
    label: "License",
    getValue: (r) => r.metrics?.license ?? "—",
  },
  {
    label: "Last Active",
    getValue: (r) =>
      r.metrics?.pushedAt ? formatRelativeTime(r.metrics.pushedAt) : "—",
  },
]

export function ComparisonTable() {
  const { getRepoList } = useComparison()
  const repos = getRepoList()
  const readyRepos = repos.filter((r) => r.status === "ready")

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-foreground/20 px-6 py-12 text-center">
        <BarChart3 className="mb-3 h-8 w-8 text-text-secondary" />
        <p className="text-sm font-medium text-text-primary">
          No repositories to compare
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Add at least two repositories above to see comparison metrics.
        </p>
      </div>
    )
  }

  if (readyRepos.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Bar chart metrics */}
      {BAR_CHART_METRICS.map((metric) => (
        <MetricBarChart
          key={metric.label}
          metric={metric}
          repos={readyRepos}
        />
      ))}

      {/* Language breakdown bars */}
      <LanguageBreakdownSection repos={readyRepos} />

      {/* Text-based metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        {TEXT_METRICS.map((metric) => (
          <TextMetricCard
            key={metric.label}
            metric={metric}
            repos={readyRepos}
          />
        ))}
      </div>
    </div>
  )
}

function MetricBarChart({
  metric,
  repos,
}: {
  metric: BarChartMetric
  repos: ComparisonRepo[]
}) {
  const values = repos.map((r) => metric.getValue(r))
  const maxVal = Math.max(...values, 1)

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-secondary">{metric.label}</h4>
      <div className="space-y-1.5">
        {repos.map((r, i) => {
          const value = values[i]
          const widthPct = (value / maxVal) * 100
          const color = REPO_COLORS[i % REPO_COLORS.length]

          return (
            <div key={r.id} className="flex items-center gap-3">
              <span className="w-[140px] shrink-0 truncate text-xs text-text-secondary md:w-[180px]">
                {r.id}
              </span>
              <div className="relative flex-1">
                <div className="h-2 w-full rounded-full bg-foreground/6">
                  <div
                    className="h-2 rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.max(widthPct, 1)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
              <span className="w-[60px] shrink-0 text-right text-xs font-medium tabular-nums">
                {metric.format(value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LanguageBreakdownSection({
  repos,
}: {
  repos: ComparisonRepo[]
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-secondary">Languages</h4>
      <div className="space-y-2">
        {repos.map((r) => (
          <LanguageBar key={r.id} repo={r} />
        ))}
      </div>
    </div>
  )
}

function LanguageBar({ repo }: { repo: ComparisonRepo }) {
  const entries = Object.entries(repo.metrics?.languageBreakdown ?? {}).filter(
    ([l]) => l !== "other"
  )

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-[140px] shrink-0 truncate text-xs text-text-secondary md:w-[180px]">
          {repo.id}
        </span>
        <span className="text-xs text-text-secondary">No languages detected</span>
      </div>
    )
  }

  const total = entries.reduce((s, [, c]) => s + c, 0)
  entries.sort((a, b) => b[1] - a[1])

  return (
    <div className="flex items-center gap-3">
      <span className="w-[140px] shrink-0 truncate text-xs text-text-secondary md:w-[180px]">
        {repo.id}
      </span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-foreground/6">
        {entries.map(([lang, count]) => {
          const pct = (count / total) * 100
          const color =
            LANGUAGE_COLORS[lang.toLowerCase()] ?? FALLBACK_LANGUAGE_COLOR

          return (
            <div
              key={lang}
              className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${pct}%`,
                backgroundColor: color,
                minWidth: pct > 0 ? "2px" : "0",
              }}
              title={`${lang} — ${Math.round(pct)}%`}
            />
          )
        })}
      </div>
    </div>
  )
}

function TextMetricCard({
  metric,
  repos,
}: {
  metric: TextMetric
  repos: ComparisonRepo[]
}) {
  return (
    <div className="rounded-lg border border-foreground/10 px-4 py-3">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-secondary">
        {metric.label}
      </h4>
      <div className="space-y-1">
        {repos.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2">
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: REPO_COLORS[i % REPO_COLORS.length],
              }}
            />
            <span className="truncate text-xs text-text-secondary">
              {r.id.split("/")[1]}
            </span>
            <span className={cn("ml-auto text-sm font-medium", "tabular-nums")}>
              {metric.getValue(r)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
