"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { parseDependenciesAsyncWithCoverage, dedupeDependencies, dependencyIdentityKey } from '@/lib/code/scanner/cve-lookup'
import type { CveResult, DependencyParseCoverage, PackageDependency } from '@/lib/code/scanner/cve-lookup'
import { parseCveProxyResponse } from '@/lib/code/cve-proxy-client'
import { fetchDependencyMeta } from '@/lib/deps/npm-client'
import {
  MAX_DEPENDENCY_API_BATCH,
  MAX_DEPENDENCY_PACKAGES_PER_WINDOW,
} from '@/lib/deps/constants'
import { computeDependencyHealth } from '@/lib/deps/health-scorer'
import { compareVersions, isOutdated } from '@/lib/deps/version-checker'
import type { DependencyHealth, NpmPackageMeta } from '@/lib/deps/types'
import { Package, RefreshCw } from 'lucide-react'
import { useRepositoryActions, useRepositoryData } from '@/providers'
import { DepsSummary } from './deps-summary'
import { DepsTable } from './deps-table'
import { DepsDetailDrawer } from './deps-detail-drawer'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error' | 'empty' | 'no-dependencies'

interface DepsPanelProps {
  codeIndex: CodeIndex
}

interface DepsTabCache {
  codeIndex: CodeIndex
  contentRevision: number
  healthData: DependencyHealth[]
  depTypes: Map<string, 'production' | 'dev'>
  cveResults: CveResult[]
  dependencyCoverage?: DependencyParseCoverage
}

interface DepsPublicationSource {
  codeIndex: CodeIndex
  repositorySession: unknown
  contentRevision: number
}

function packageDependencyKey(dep: PackageDependency): string {
  return dependencyIdentityKey(dep)
}

function packageRegistryName(dep: PackageDependency): string {
  return dep.registryName ?? dep.name
}

function cveResultKey(packageName: string, version: string): string {
  return `${packageName}\u0000${version}`
}

export function DepsPanel({ codeIndex }: DepsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [healthData, setHealthData] = useState<DependencyHealth[]>([])
  const [depTypes, setDepTypes] = useState<Map<string, 'production' | 'dev'>>(new Map())
  const [cveResults, setCveResults] = useState<CveResult[]>([])
  const [dependencyCoverage, setDependencyCoverage] = useState<DependencyParseCoverage | null>(null)
  const [selectedDep, setSelectedDep] = useState<DependencyHealth | null>(null)
  const [publicationSource, setPublicationSource] = useState<DepsPublicationSource | null>(null)
  const [, requestRevisionRestart] = useState(0)
  const { repositorySession } = useRepositoryData()
  const { getTabCache, setTabCache, isRepositorySessionCurrent } = useRepositoryActions()
  const loadGenerationRef = useRef(0)
  const loadControllerRef = useRef<AbortController | null>(null)
  const contentRevision = codeIndex.contentStore?.contentRevision ?? 0

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoadState('idle')
      setErrorMessage('')
      setHealthData([])
      setDepTypes(new Map())
      setCveResults([])
      setDependencyCoverage(null)
      setSelectedDep(null)
      setPublicationSource(null)
    })
    return () => { cancelled = true }
  }, [repositorySession, codeIndex, contentRevision])

  const loadDependencies = useCallback(async () => {
    const session = repositorySession
    if (!isRepositorySessionCurrent(session)) return
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    const generation = ++loadGenerationRef.current
    let acceptedContentRevision = codeIndex.contentStore?.contentRevision ?? contentRevision
    loadControllerRef.current = controller
    const sessionSignal = session?.signal
    const abortForSession = () => controller.abort(sessionSignal?.reason)
    if (sessionSignal?.aborted) abortForSession()
    else sessionSignal?.addEventListener('abort', abortForSession, { once: true })
    const isOperationCurrent = () => (
      loadGenerationRef.current === generation
      && loadControllerRef.current === controller
      && !controller.signal.aborted
      && isRepositorySessionCurrent(session)
    )
    const isLoadCurrent = () => (
      isOperationCurrent()
      && (codeIndex.contentStore?.contentRevision ?? 0) === acceptedContentRevision
    )
    const shouldStopLoad = () => {
      if (!isOperationCurrent()) return true
      if ((codeIndex.contentStore?.contentRevision ?? 0) === acceptedContentRevision) return false
      requestRevisionRestart(revision => revision + 1)
      return true
    }
    if (!isLoadCurrent()) {
      sessionSignal?.removeEventListener('abort', abortForSession)
      if (loadControllerRef.current === controller) loadControllerRef.current = null
      return
    }
    setLoadState('loading')
    setErrorMessage('')
    setSelectedDep(null)
    setPublicationSource(null)

    try {
      // Step 1: Parse dependencies from package.json in the code index.
      // Dedupe repeated manifest entries so each workspace/package/version
      // identity yields a single row — otherwise React sees duplicate keys.
      const parseResult = await parseDependenciesAsyncWithCoverage(codeIndex, controller.signal)
      // Lazy stores increment their revision while hydrating manifests. That
      // hydration is part of this load, so subsequent stale-result checks must
      // compare against the resulting source snapshot.
      acceptedContentRevision = codeIndex.contentStore?.contentRevision ?? 0
      const parsed = dedupeDependencies(parseResult.dependencies)
      if (shouldStopLoad()) return
      if (parsed.length === 0) {
        setPublicationSource({
          codeIndex,
          repositorySession: session,
          contentRevision: acceptedContentRevision,
        })
        setDependencyCoverage(parseResult)
        if (parseResult.status === 'missing') {
          setLoadState('empty')
        } else if (parseResult.status === 'complete') {
          setLoadState('no-dependencies')
        } else {
          const details = [...parseResult.manifests, ...(parseResult.lockfiles ?? [])]
            .filter(manifest => manifest.status !== 'loaded')
            .map(manifest => `${manifest.path}: ${manifest.error ?? 'unavailable'}`)
            .join('; ')
          setErrorMessage(details || 'No readable package manifest was found')
          setLoadState('error')
        }
        return
      }

      // Build type map for prod/dev distinction
      const typeMap = new Map<string, 'production' | 'dev'>()
      for (const p of parsed) {
        typeMap.set(packageDependencyKey(p), p.type)
      }
      if (shouldStopLoad()) return

      // Step 2: Fetch npm metadata
      const packageNames = Array.from(new Set(parsed.map(packageRegistryName)))
      const metadataPackages = packageNames.slice(0, MAX_DEPENDENCY_PACKAGES_PER_WINDOW)
      const metadataLimitedPackages = new Set(
        packageNames.slice(MAX_DEPENDENCY_PACKAGES_PER_WINDOW),
      )
      const metadataErrors = new Map<string, string>()
      const metaMap = await fetchDependencyMeta(metadataPackages, {
        signal: controller.signal,
        onError: (packageName, message) => metadataErrors.set(packageName, message),
      })
      if (shouldStopLoad()) return

      // Step 3: Query OSV for CVEs via server-side proxy
      const cves: CveResult[] = []
      const cveLookupErrors = new Map<string, string>()
      const exactPackages = parsed.filter(
        (dep): dep is PackageDependency & { installedVersion: string } => Boolean(dep.installedVersion),
      )
      const uniqueExactPackages = Array.from(new Map(
        exactPackages.map(dep => [cveResultKey(packageRegistryName(dep), dep.installedVersion), dep]),
      ).values())
      const cvePackages = uniqueExactPackages.slice(0, MAX_DEPENDENCY_PACKAGES_PER_WINDOW)
      const markBatchError = (
        batch: Array<PackageDependency & { installedVersion: string }>,
        message: string,
      ) => {
        for (const dep of batch) {
          cveLookupErrors.set(cveResultKey(packageRegistryName(dep), dep.installedVersion), message)
        }
      }
      if (cvePackages.length > 0) {
        for (let index = 0; index < cvePackages.length; index += MAX_DEPENDENCY_API_BATCH) {
          const batch = cvePackages.slice(index, index + MAX_DEPENDENCY_API_BATCH)
          try {
            const cveResponse = await fetch('/api/deps/cve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                packages: batch.map(dep => ({
                  name: packageRegistryName(dep),
                  version: dep.installedVersion,
                  type: dep.type,
                })),
              }),
              signal: controller.signal,
            })
            if (shouldStopLoad()) return
            if (cveResponse.ok) {
              const osvResult = parseCveProxyResponse(
                await cveResponse.json(),
                batch.map(dep => ({
                  name: packageRegistryName(dep),
                  version: dep.installedVersion,
                })),
              )
              if (shouldStopLoad()) return
              if (!osvResult) {
                markBatchError(batch, 'CVE proxy returned a malformed response')
              } else {
                cves.push(...osvResult.results)
                const batchErrors = [...osvResult.errors]
                if (osvResult.scannedPackages < batch.length) {
                  batchErrors.push(
                    `CVE proxy returned an incomplete response (${osvResult.scannedPackages}/${batch.length} packages scanned)`,
                  )
                }
                if (batchErrors.length > 0) {
                  markBatchError(batch, batchErrors.join('; '))
                }
              }
            } else {
              markBatchError(batch, `CVE lookup returned ${cveResponse.status}`)
            }
          } catch (error) {
            if (shouldStopLoad()) return
            const message = error instanceof Error ? error.message : String(error)
            markBatchError(batch, message)
            console.warn(`[deps-panel] CVE lookup failed, continuing without vulnerability data: ${message}`)
          }
        }
      }
      for (const dep of uniqueExactPackages.slice(MAX_DEPENDENCY_PACKAGES_PER_WINDOW)) {
        cveLookupErrors.set(
          cveResultKey(packageRegistryName(dep), dep.installedVersion),
          'CVE query limit reached for this analysis',
        )
      }
      if (shouldStopLoad()) return
      setCveResults(cves)

      // Step 4: Build CVE count per package
      const cveCounts = new Map<string, number>()
      for (const cve of cves) {
        const key = cveResultKey(cve.packageName, cve.version)
        cveCounts.set(key, (cveCounts.get(key) ?? 0) + 1)
      }

      // Step 5: Compute health for each dependency
      const results: DependencyHealth[] = parsed.map(dep => {
        const registryName = packageRegistryName(dep)
        const meta: NpmPackageMeta | null = metaMap.get(registryName) ?? null
        const installedVersion = dep.installedVersion ?? null
        const requestedRange = dep.requestedRange ?? dep.version
        const currentVersion = installedVersion ?? requestedRange
        const latestVersion = meta?.version ?? 'Unknown'
        const cveCount = installedVersion
          ? cveCounts.get(cveResultKey(registryName, installedVersion)) ?? 0
          : null
        const cveLookupError = installedVersion
          ? cveLookupErrors.get(cveResultKey(registryName, installedVersion))
          : undefined
        const cveSignal = installedVersion && cveLookupError === undefined
          ? { status: 'known' as const, value: cveCount ?? 0 }
          : {
              status: 'unknown' as const,
              error: installedVersion ? cveLookupError ?? undefined : 'Installed version unresolved',
            }
        const canCompareVersions = installedVersion !== null && meta !== null
        const isOutdatedFlag = canCompareVersions ? isOutdated(installedVersion, latestVersion) : false
        const outdatedType = canCompareVersions ? compareVersions(installedVersion, latestVersion) : null
        const outdatedSignal = canCompareVersions
          ? { status: 'known' as const, value: outdatedType }
          : {
              status: 'unknown' as const,
              error: installedVersion ? 'npm metadata unavailable' : 'Installed version unresolved',
            }

        const { score, grade, confidence } = computeDependencyHealth(
          meta,
          cveSignal,
          outdatedSignal,
        )

        const errors = [
          metadataErrors.get(registryName),
          cveLookupError,
          meta === null && metadataLimitedPackages.has(registryName)
            ? 'Metadata query limit reached for this analysis'
            : undefined,
          meta === null && !metadataErrors.has(registryName) && !metadataLimitedPackages.has(registryName)
            ? 'Failed to fetch metadata'
            : undefined,
        ].filter((message): message is string => Boolean(message))

        return {
          dependencyKey: packageDependencyKey(dep),
          packageName: dep.name,
          ...(dep.registryName && { registryName: dep.registryName }),
          currentVersion,
          requestedRange,
          installedVersion,
          versionSource: installedVersion ? 'lockfile' as const : 'manifest' as const,
          latestVersion,
          npmMeta: meta,
          isOutdated: isOutdatedFlag,
          outdatedType,
          outdatedStatus: canCompareVersions ? 'known' as const : 'unknown' as const,
          cveCount: cveSignal.status === 'unknown' ? null : cveCount,
          score,
          grade,
          confidence,
          ...(errors.length > 0 && { error: errors.join('; ') }),
        }
      })

      if (shouldStopLoad()) return
      setPublicationSource({
        codeIndex,
        repositorySession: session,
        contentRevision: acceptedContentRevision,
      })
      setDependencyCoverage(parseResult)
      setDepTypes(typeMap)
      setHealthData(results)
      setLoadState('loaded')
      setTabCache('deps', {
        codeIndex,
        contentRevision: acceptedContentRevision,
        healthData: results,
        depTypes: typeMap,
        cveResults: cves,
        dependencyCoverage: parseResult,
      } satisfies DepsTabCache)
    } catch (err) {
      if (shouldStopLoad()) return
      const message = err instanceof Error ? err.message : String(err)
      console.error('[deps-panel] Failed to load dependencies:', message)
      setPublicationSource({
        codeIndex,
        repositorySession: session,
        contentRevision: acceptedContentRevision,
      })
      setErrorMessage(message)
      setLoadState('error')
    } finally {
      sessionSignal?.removeEventListener('abort', abortForSession)
      if (loadControllerRef.current === controller) loadControllerRef.current = null
    }
  }, [codeIndex, contentRevision, setTabCache, repositorySession, isRepositorySessionCurrent])

  // Load on mount / codeIndex change
  useEffect(() => {
    let cancelled = false
    const generationRef = loadGenerationRef
    const controllerRef = loadControllerRef
    if (codeIndex.totalFiles > 0) {
      const cached = getTabCache<DepsTabCache>('deps')
      if (cached?.codeIndex === codeIndex && cached.contentRevision === contentRevision) {
        const session = repositorySession
        queueMicrotask(() => {
          if (cancelled || !isRepositorySessionCurrent(session)) return
          setHealthData(cached.healthData)
          setDepTypes(cached.depTypes)
          setCveResults(cached.cveResults)
          setDependencyCoverage(cached.dependencyCoverage ?? null)
          setPublicationSource({ codeIndex, repositorySession: session, contentRevision })
          setLoadState('loaded')
        })
      } else {
        queueMicrotask(() => {
          if (cancelled || !isRepositorySessionCurrent(repositorySession)) return
          void loadDependencies()
        })
      }
    }
    return () => {
      cancelled = true
      generationRef.current++
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [codeIndex, contentRevision, loadDependencies, getTabCache, repositorySession, isRepositorySessionCurrent])

  // CVEs for selected dep
  const selectedCves = useMemo(() => {
    if (!selectedDep?.installedVersion) return []
    return cveResults.filter(c => (
      c.packageName === (selectedDep.registryName ?? selectedDep.packageName)
      && c.version === selectedDep.installedVersion
    ))
  }, [selectedDep, cveResults])

  const hasCurrentPublication = publicationSource?.codeIndex === codeIndex
    && publicationSource.repositorySession === repositorySession
    && publicationSource.contentRevision === contentRevision

  // Loading state
  if (!hasCurrentPublication || loadState === 'idle' || loadState === 'loading') {
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
  if (loadState === 'empty' || loadState === 'no-dependencies') {
    const manifestIsEmpty = loadState === 'no-dependencies'
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              {manifestIsEmpty ? 'No dependencies found' : 'No package.json found'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {manifestIsEmpty
                ? 'The package manifest does not declare npm dependencies.'
                : 'This repository doesn\'t appear to have any npm dependencies.'}
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
      {dependencyCoverage && dependencyCoverage.status !== 'complete' && (
        <div role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-xs font-medium text-amber-400">Dependency coverage incomplete</p>
          {dependencyCoverage.manifests.filter(manifest => manifest.status !== 'loaded').map(manifest => (
            <p key={manifest.path} className="text-[10px] text-amber-400/70">
              {manifest.path}: {manifest.status === 'malformed' ? 'manifest is malformed' : 'content is unavailable'}.
            </p>
          ))}
          {(dependencyCoverage.lockfiles ?? []).filter(lockfile => lockfile.status !== 'loaded').map(lockfile => (
            <p key={lockfile.path} className="text-[10px] text-amber-400/70">
              {lockfile.path}: {lockfile.status === 'malformed' ? 'lockfile is malformed' : 'content is unavailable'}.
            </p>
          ))}
        </div>
      )}
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
