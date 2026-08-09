"use client"

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { parseDependencies, dedupeDependencies } from '@/lib/code/scanner/cve-lookup'
import type { CveResult, PackageDependency } from '@/lib/code/scanner/cve-lookup'
import { fetchDependencyMeta } from '@/lib/deps/npm-client'
import { computeDependencyHealth } from '@/lib/deps/health-scorer'
import { compareVersions, isOutdated } from '@/lib/deps/version-checker'
import type { DependencyHealth, NpmPackageMeta } from '@/lib/deps/types'
import { cn } from '@/lib/utils'
import { Package, RefreshCw } from 'lucide-react'
import { useRepositoryActions, useRepositoryData } from '@/providers'
import { DepsSummary } from './deps-summary'
import { DepsTable } from './deps-table'
import { DepsDetailDrawer } from './deps-detail-drawer'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error' | 'empty'

interface DepsPanelProps {
  codeIndex: CodeIndex
}

export function DepsPanel({ codeIndex }: DepsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [healthData, setHealthData] = useState<DependencyHealth[]>([])
  const [depTypes, setDepTypes] = useState<Map<string, 'production' | 'dev'>>(new Map())
  const [cveResults, setCveResults] = useState<CveResult[]>([])
  const [selectedDep, setSelectedDep] = useState<DependencyHealth | null>(null)
  const { repositorySession } = useRepositoryData()
  const { getTabCache, setTabCache, isRepositorySessionCurrent } = useRepositoryActions()

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoadState('idle')
      setErrorMessage('')
      setHealthData([])
      setDepTypes(new Map())
      setCveResults([])
      setSelectedDep(null)
    })
    return () => { cancelled = true }
  }, [repositorySession])

  const loadDependencies = useCallback(async () => {
    const session = repositorySession
    if (!isRepositorySessionCurrent(session)) return
    setLoadState('loading')
    setErrorMessage('')

    try {
      // Step 1: Parse dependencies from package.json in the code index.
      // Dedupe across manifests (monorepos repeat the same package) so each
      // package yields a single row — otherwise React sees duplicate keys.
      const parsed = dedupeDependencies(parseDependencies(codeIndex))
      if (parsed.length === 0) {
        if (!isRepositorySessionCurrent(session)) return
        setLoadState('empty')
        return
      }

      // Build type map for prod/dev distinction
      const typeMap = new Map<string, 'production' | 'dev'>()
      for (const p of parsed) {
        typeMap.set(p.name, p.type)
      }
      if (!isRepositorySessionCurrent(session)) return
      setDepTypes(typeMap)

      // Step 2: Fetch npm metadata
      const packageNames = parsed.map(p => p.name)
      const metaMap = await fetchDependencyMeta(packageNames)
      if (!isRepositorySessionCurrent(session)) return

      // Step 3: Query OSV for CVEs via server-side proxy
      let cves: CveResult[] = []
      try {
        const cveResponse = await fetch('/api/deps/cve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages: parsed }),
        })
        if (!isRepositorySessionCurrent(session)) return
        if (cveResponse.ok) {
          const osvResult = (await cveResponse.json()) as { results: CveResult[]; errors: string[] }
          if (!isRepositorySessionCurrent(session)) return
          cves = osvResult.results
        }
      } catch {
        if (!isRepositorySessionCurrent(session)) return
        // CVE lookup failure is non-fatal — continue without CVE data
        console.warn('[deps-panel] CVE lookup failed, continuing without vulnerability data')
      }
      if (!isRepositorySessionCurrent(session)) return
      setCveResults(cves)

      // Step 4: Build CVE count per package
      const cveCounts = new Map<string, number>()
      for (const cve of cves) {
        cveCounts.set(cve.packageName, (cveCounts.get(cve.packageName) ?? 0) + 1)
      }

      // Step 5: Compute health for each dependency
      const results: DependencyHealth[] = parsed.map(dep => {
        const meta: NpmPackageMeta | null = metaMap.get(dep.name) ?? null
        const latestVersion = meta?.version ?? dep.version
        const cveCount = cveCounts.get(dep.name) ?? 0
        const isOutdatedFlag = meta ? isOutdated(dep.version, latestVersion) : false
        const outdatedType = meta ? compareVersions(dep.version, latestVersion) : null

        const { score, grade } = computeDependencyHealth(
          meta,
          cveCount,
          outdatedType,
        )

        return {
          packageName: dep.name,
          currentVersion: dep.version,
          latestVersion,
          npmMeta: meta,
          isOutdated: isOutdatedFlag,
          outdatedType,
          cveCount,
          score,
          grade,
          ...(meta === null && { error: 'Failed to fetch metadata' }),
        }
      })

      setHealthData(results)
      setLoadState('loaded')
      setTabCache('deps', { healthData: results, depTypes: typeMap, cveResults: cves })
    } catch (err) {
      if (!isRepositorySessionCurrent(session)) return
      const message = err instanceof Error ? err.message : String(err)
      console.error('[deps-panel] Failed to load dependencies:', message)
      setErrorMessage(message)
      setLoadState('error')
    }
  }, [codeIndex, setTabCache, repositorySession, isRepositorySessionCurrent])

  // Load on mount / codeIndex change
  useEffect(() => {
    if (codeIndex.totalFiles > 0) {
      const cached = getTabCache<{ healthData: DependencyHealth[]; depTypes: Map<string, 'production' | 'dev'>; cveResults: CveResult[] }>('deps')
      if (cached) {
        const session = repositorySession
        queueMicrotask(() => {
          if (!isRepositorySessionCurrent(session)) return
          setHealthData(cached.healthData)
          setDepTypes(cached.depTypes)
          setCveResults(cached.cveResults)
          setLoadState('loaded')
        })
        return
      }
      queueMicrotask(() => {
        if (!isRepositorySessionCurrent(repositorySession)) return
        void loadDependencies()
      })
    }
  }, [codeIndex, loadDependencies, getTabCache, repositorySession, isRepositorySessionCurrent])

  // CVEs for selected dep
  const selectedCves = useMemo(() => {
    if (!selectedDep) return []
    return cveResults.filter(c => c.packageName === selectedDep.packageName)
  }, [selectedDep, cveResults])

  // Loading state
  if (loadState === 'idle' || loadState === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin" />
          <p className="text-sm">Analyzing dependencies…</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (loadState === 'empty') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No package.json found</p>
            <p className="text-xs text-muted-foreground mt-1">
              This repository doesn&apos;t appear to have any npm dependencies.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (loadState === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="rounded-full bg-red-500/10 p-3">
            <Package className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Failed to analyze dependencies</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>
          </div>
          <button
            onClick={loadDependencies}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Loaded state
  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-auto">
      <DepsSummary deps={healthData} />
      <DepsTable
        deps={healthData}
        depTypes={depTypes}
        onSelectDep={setSelectedDep}
        className="flex-1 min-h-0"
      />
      <DepsDetailDrawer
        dep={selectedDep}
        cves={selectedCves}
        isOpen={selectedDep !== null}
        onClose={() => setSelectedDep(null)}
      />
    </div>
  )
}
