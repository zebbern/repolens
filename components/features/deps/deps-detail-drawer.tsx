"use client"

import { cn } from '@/lib/utils'
import { ExternalLink, Shield, Clock, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { HealthBadge } from './health-badge'
import { DownloadSparkline } from './download-sparkline'
import type { DependencyHealth } from '@/lib/deps/types'
import type { CveResult } from '@/lib/code/scanner/cve-lookup'
import {
  calculateDownloadScore,
  calculateMaintenanceScore,
  calculateSecurityScore,
  calculateOutdatedScore,
} from '@/lib/deps/health-scorer'

const numberFormatter = new Intl.NumberFormat('en-US')

interface DepsDetailDrawerProps {
  dep: DependencyHealth | null
  cves: CveResult[]
  isOpen: boolean
  onClose: () => void
}

interface ScoreBarProps {
  label: string
  value: number
  icon: React.ReactNode
}

function ScoreBar({ label, value, icon }: ScoreBarProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-28 text-xs text-muted-foreground shrink-0">
        {icon}
        {label}
      </div>
      <Progress value={value} className="h-2 flex-1" />
      <span className="text-xs font-medium tabular-nums w-8 text-right">{value}</span>
    </div>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400',
  high: 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400',
  medium: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-400',
  low: 'bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400',
}

export function DepsDetailDrawer({ dep, cves, isOpen, onClose }: DepsDetailDrawerProps) {
  if (!dep) return null

  const downloadScore = dep.npmMeta
    ? calculateDownloadScore(dep.npmMeta.weeklyDownloads)
    : 0
  const maintenanceScore = dep.npmMeta
    ? calculateMaintenanceScore(dep.npmMeta.lastPublish, dep.npmMeta.deprecated)
    : 0
  const securityScore = calculateSecurityScore(dep.cveCount)
  const outdatedScore = calculateOutdatedScore(dep.isOutdated ? dep.outdatedType : null)

  const npmUrl = `https://www.npmjs.com/package/${dep.packageName}`

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[420px] p-0">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base font-semibold truncate">
                  {dep.packageName}
                </SheetTitle>
                <HealthBadge grade={dep.grade} score={dep.score} />
              </div>
              <SheetDescription className="text-xs">
                {dep.npmMeta?.description || 'No description available.'}
              </SheetDescription>
            </SheetHeader>

            {/* Version info */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Version</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Installed</span>
                  <p className="font-mono text-xs">{dep.currentVersion}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Latest</span>
                  <p className={cn(
                    'font-mono text-xs',
                    dep.isOutdated && 'text-amber-500',
                  )}>
                    {dep.latestVersion}
                    {dep.outdatedType && (
                      <span className="ml-1 text-[10px]">({dep.outdatedType} behind)</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Score breakdown */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Score Breakdown ({dep.score}/100)
              </h4>
              <ScoreBar
                label="Downloads"
                value={downloadScore}
                icon={<TrendingUp className="h-3 w-3" />}
              />
              <ScoreBar
                label="Maintenance"
                value={maintenanceScore}
                icon={<Clock className="h-3 w-3" />}
              />
              <ScoreBar
                label="Security"
                value={securityScore}
                icon={<Shield className="h-3 w-3" />}
              />
              <ScoreBar
                label="Up-to-date"
                value={outdatedScore}
                icon={<CheckCircle className="h-3 w-3" />}
              />
            </div>

            {/* Download sparkline */}
            {dep.npmMeta && dep.npmMeta.downloadTrend.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Weekly Downloads
                </h4>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold tabular-nums">
                    {numberFormatter.format(dep.npmMeta.weeklyDownloads)}
                  </span>
                  <DownloadSparkline data={dep.npmMeta.downloadTrend} packageName={dep.packageName} width={180} height={48} />
                </div>
              </div>
            )}

            {/* CVE list */}
            {cves.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Vulnerabilities ({cves.length})
                </h4>
                <div className="space-y-2">
                  {cves.map(cve => (
                    <div key={cve.cveId} className="rounded-md border p-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge className={cn(
                          'text-[10px] px-1.5 py-0',
                          SEVERITY_STYLES[cve.severity] ?? '',
                        )}>
                          {cve.severity}
                        </Badge>
                        <span className="text-xs font-mono font-medium">{cve.cveId}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{cve.summary}</p>
                      {cve.fixedVersion && (
                        <p className="text-[10px] text-emerald-500">Fixed in {cve.fixedVersion}</p>
                      )}
                      {cve.referenceUrl && (
                        <a
                          href={cve.referenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          Details <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata & links */}
            {dep.npmMeta && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Info</h4>
                <div className="space-y-1 text-xs">
                  {dep.npmMeta.license && (
                    <p><span className="text-muted-foreground">License:</span> {dep.npmMeta.license}</p>
                  )}
                  <p><span className="text-muted-foreground">Maintainers:</span> {dep.npmMeta.maintainers}</p>
                  {dep.npmMeta.deprecated && (
                    <p className="text-red-400 font-medium">⚠ This package is deprecated</p>
                  )}
                </div>
              </div>
            )}

            {/* Links */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <a
                href={npmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
              >
                npm <ExternalLink className="h-3 w-3" />
              </a>
              {dep.npmMeta?.repository && (
                <a
                  href={dep.npmMeta.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
                >
                  Repository <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {dep.npmMeta?.homepage && dep.npmMeta.homepage !== dep.npmMeta.repository && (
                <a
                  href={dep.npmMeta.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
                >
                  Homepage <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
