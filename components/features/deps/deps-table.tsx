"use client"

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ExternalLink, ChevronUp, ChevronDown, Search } from 'lucide-react'
import { HealthBadge } from './health-badge'
import { DownloadSparkline } from './download-sparkline'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DependencyHealth } from '@/lib/deps/types'

type SortField = 'name' | 'type' | 'current' | 'latest' | 'downloads' | 'updated' | 'cves' | 'grade'
type SortDir = 'asc' | 'desc'

const numberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' })

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

interface DepsTableProps {
  deps: DependencyHealth[]
  depTypes: Map<string, 'production' | 'dev'>
  onSelectDep: (dep: DependencyHealth) => void
  className?: string
}

interface ColumnDef {
  id: SortField
  label: string
  className?: string
}

const COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Package', className: 'min-w-[160px]' },
  { id: 'type', label: 'Type', className: 'w-[70px]' },
  { id: 'current', label: 'Installed', className: 'w-[100px]' },
  { id: 'latest', label: 'Latest', className: 'w-[100px]' },
  { id: 'downloads', label: 'Downloads', className: 'w-[160px]' },
  { id: 'updated', label: 'Updated', className: 'w-[90px]' },
  { id: 'cves', label: 'CVEs', className: 'w-[60px]' },
  { id: 'grade', label: 'Grade', className: 'w-[65px]' },
]

function getSortValue(dep: DependencyHealth, field: SortField, depTypes: Map<string, 'production' | 'dev'>): string | number {
  switch (field) {
    case 'name': return dep.packageName.toLowerCase()
    case 'type': return depTypes.get(dep.packageName) === 'dev' ? 1 : 0
    case 'current': return dep.currentVersion
    case 'latest': return dep.latestVersion
    case 'downloads': return dep.npmMeta?.weeklyDownloads ?? 0
    case 'updated': return dep.npmMeta?.lastPublish ? new Date(dep.npmMeta.lastPublish).getTime() : 0
    case 'cves': return dep.cveCount
    case 'grade': return dep.score
    default: return 0
  }
}

export function DepsTable({ deps, depTypes, onSelectDep, className }: DepsTableProps) {
  const [sortField, setSortField] = useState<SortField>('grade')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')
  const [showDev, setShowDev] = useState(true)

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredDeps = useMemo(() => {
    let result = deps
    if (!showDev) {
      result = result.filter(d => depTypes.get(d.packageName) !== 'dev')
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(d => d.packageName.toLowerCase().includes(q))
    }
    return result
  }, [deps, showDev, search, depTypes])

  const sortedDeps = useMemo(() => {
    const sorted = [...filteredDeps].sort((a, b) => {
      const aVal = getSortValue(a, sortField, depTypes)
      const bVal = getSortValue(b, sortField, depTypes)
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      const numA = aVal as number
      const numB = bVal as number
      return sortDir === 'asc' ? numA - numB : numB - numA
    })
    return sorted
  }, [filteredDeps, sortField, sortDir, depTypes])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) return null
    return sortDir === 'asc'
      ? <ChevronUp className="ml-0.5 inline h-3 w-3" />
      : <ChevronDown className="ml-0.5 inline h-3 w-3" />
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-1 pb-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter packages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-hidden focus:ring-1 focus:ring-ring"
            aria-label="Filter packages by name"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDev}
            onChange={e => setShowDev(e.target.checked)}
            className="rounded border"
          />
          Show dev deps
        </label>
        <span className="text-xs text-muted-foreground">
          {sortedDeps.length} of {deps.length}
        </span>
      </div>

      {/* Table */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`Sorted by ${COLUMNS.find(c => c.id === sortField)?.label ?? sortField}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full text-sm" role="grid">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b">
              {COLUMNS.map(col => (
                <th
                  key={col.id}
                  scope="col"
                  tabIndex={0}
                  role="columnheader"
                  className={cn(
                    'cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors',
                    col.className,
                  )}
                  onClick={() => handleSort(col.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSort(col.id)
                    }
                  }}
                  aria-sort={
                    sortField === col.id
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                >
                  {col.label}
                  <SortIcon field={col.id} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedDeps.map(dep => {
              const depType = depTypes.get(dep.packageName) ?? 'production'
              return (
                <tr
                  key={dep.packageName}
                  className={cn(
                    'cursor-pointer border-b transition-colors hover:bg-muted/50',
                    dep.isOutdated && 'bg-amber-500/3',
                  )}
                  onClick={() => onSelectDep(dep)}
                  role="row"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDep(dep) } }}
                >
                  {/* Name */}
                  <td className="px-3 py-2">
                    <span
                      className="font-medium text-foreground truncate block max-w-[200px]"
                      title={dep.packageName}
                    >
                      {dep.packageName}
                    </span>
                  </td>
                  {/* Type */}
                  <td className="px-3 py-2">
                    <Badge
                      variant={depType === 'dev' ? 'secondary' : 'outline'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {depType === 'dev' ? 'dev' : 'prod'}
                    </Badge>
                  </td>
                  {/* Installed version */}
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    {dep.currentVersion}
                  </td>
                  {/* Latest version */}
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">
                    <span className={cn(dep.isOutdated && 'text-amber-500')}>
                      {dep.latestVersion}
                    </span>
                    {dep.outdatedType === 'major' && (
                      <span className="ml-1 text-[10px] text-red-400">major</span>
                    )}
                  </td>
                  {/* Downloads */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {dep.npmMeta ? numberFormatter.format(dep.npmMeta.weeklyDownloads) : '—'}
                      </span>
                      {dep.npmMeta && dep.npmMeta.downloadTrend.length > 0 && (
                        <DownloadSparkline
                          data={dep.npmMeta.downloadTrend}
                          packageName={dep.packageName}
                          width={80}
                          height={24}
                        />
                      )}
                    </div>
                  </td>
                  {/* Updated */}
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {dep.npmMeta ? relativeTime(dep.npmMeta.lastPublish) : '—'}
                  </td>
                  {/* CVEs */}
                  <td className="px-3 py-2">
                    {dep.cveCount > 0 ? (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        {dep.cveCount}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">0</span>
                    )}
                  </td>
                  {/* Grade */}
                  <td className="px-3 py-2">
                    <HealthBadge grade={dep.grade} score={dep.score} />
                  </td>
                </tr>
              )
            })}
            {sortedDeps.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-8 text-center text-sm text-muted-foreground">
                  No dependencies match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  )
}
