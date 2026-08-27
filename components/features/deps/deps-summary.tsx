"use client"

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Package, Shield, AlertTriangle, TrendingUp } from 'lucide-react'
import type { DependencyHealth, HealthGrade } from '@/lib/deps/types'

const GRADE_PILL_STYLES: Record<HealthGrade, string> = {
  A: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  B: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  C: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  D: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  F: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

interface DepsSummaryProps {
  deps: DependencyHealth[]
  className?: string
}

export function DepsSummary({ deps, className }: DepsSummaryProps) {
  const stats = useMemo(() => {
    const gradeDistribution: Record<HealthGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
    let totalCves = 0
    let unknownCves = 0
    let unknownGrades = 0
    let outdatedMajor = 0
    let outdatedMinor = 0
    let outdatedPatch = 0
    let unknownOutdated = 0

    for (const d of deps) {
      if (d.grade) gradeDistribution[d.grade]++
      else unknownGrades++
      if (d.cveCount === null) unknownCves++
      else totalCves += d.cveCount
      if (d.outdatedStatus === 'unknown') unknownOutdated++
      else if (d.outdatedType === 'major') outdatedMajor++
      else if (d.outdatedType === 'minor') outdatedMinor++
      else if (d.outdatedType === 'patch') outdatedPatch++
    }

    const totalOutdated = outdatedMajor + outdatedMinor + outdatedPatch

    return {
      total: deps.length,
      gradeDistribution,
      totalCves,
      unknownCves,
      unknownGrades,
      totalOutdated,
      unknownOutdated,
      outdatedMajor,
      outdatedMinor,
      outdatedPatch,
    }
  }, [deps])

  return (
    <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {/* Total deps */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-md bg-primary/10 p-2">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dependencies</p>
            <p className="text-xl font-bold tabular-nums">{stats.total}</p>
          </div>
        </CardContent>
      </Card>

      {/* Grade distribution */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Health Grades</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['A', 'B', 'C', 'D', 'F'] as HealthGrade[]).map(grade => {
              const count = stats.gradeDistribution[grade]
              if (count === 0) return null
              return (
                <span
                  key={grade}
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    GRADE_PILL_STYLES[grade],
                  )}
                >
                  {grade}: {count}
                </span>
              )
            })}
            {stats.unknownGrades > 0 && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                ?: {stats.unknownGrades}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* CVEs */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn(
            'rounded-md p-2',
            stats.totalCves > 0
              ? 'bg-red-500/10'
              : stats.unknownCves > 0
                ? 'bg-muted'
                : 'bg-emerald-500/10',
          )}>
            <Shield className={cn(
              'h-4 w-4',
              stats.totalCves > 0
                ? 'text-red-500'
                : stats.unknownCves > 0
                  ? 'text-muted-foreground'
                  : 'text-emerald-500',
            )} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vulnerability occurrences</p>
            <p className="text-xl font-bold tabular-nums">{stats.totalCves}</p>
            {stats.unknownCves > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {stats.unknownCves} vulnerability status unknown
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Outdated */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn(
            'rounded-md p-2',
            stats.totalOutdated > 0
              ? 'bg-amber-500/10'
              : stats.unknownOutdated > 0
                ? 'bg-muted'
                : 'bg-emerald-500/10',
          )}>
            <AlertTriangle className={cn(
              'h-4 w-4',
              stats.totalOutdated > 0
                ? 'text-amber-500'
                : stats.unknownOutdated > 0
                  ? 'text-muted-foreground'
                  : 'text-emerald-500',
            )} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Outdated</p>
            <p className="text-xl font-bold tabular-nums">{stats.totalOutdated}</p>
            {stats.totalOutdated > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {stats.outdatedMajor > 0 && <span className="text-red-400">{stats.outdatedMajor} major</span>}
                {stats.outdatedMajor > 0 && stats.outdatedMinor > 0 && ' · '}
                {stats.outdatedMinor > 0 && <span className="text-amber-400">{stats.outdatedMinor} minor</span>}
                {(stats.outdatedMajor > 0 || stats.outdatedMinor > 0) && stats.outdatedPatch > 0 && ' · '}
                {stats.outdatedPatch > 0 && <span className="text-blue-400">{stats.outdatedPatch} patch</span>}
              </p>
            )}
            {stats.unknownOutdated > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {stats.unknownOutdated} version status unknown
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
