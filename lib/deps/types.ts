export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type HealthConfidence = 'known' | 'partial' | 'unknown'

export type HealthSignal<T> =
  | { status: 'known'; value: T }
  | { status: 'unknown'; error?: string }

export interface DownloadPoint {
  day: string
  downloads: number
}

export interface NpmPackageMeta {
  name: string
  version: string
  description: string
  license?: string
  maintainers: number
  repository?: string
  /** Null when registry metadata did not provide a trustworthy publish date. */
  lastPublish: string | null
  weeklyDownloads: number
  downloadTrend: DownloadPoint[]
  deprecated: boolean
  homepage?: string
}

export interface DependencyHealth {
  /** Stable identity. Distinct installed versions of one package have distinct keys. */
  dependencyKey: string
  packageName: string
  /** Canonical npm package name when packageName is a manifest alias. */
  registryName?: string
  /** Exact installed version when known; otherwise the original manifest range. */
  currentVersion: string
  requestedRange: string
  installedVersion: string | null
  versionSource: 'lockfile' | 'manifest'
  latestVersion: string
  npmMeta: NpmPackageMeta | null
  isOutdated: boolean
  outdatedType: 'major' | 'minor' | 'patch' | null
  outdatedStatus?: 'known' | 'unknown'
  cveCount: number | null
  score: number | null
  grade: HealthGrade | null
  confidence?: HealthConfidence
  error?: string
}

export interface DepsApiRequest {
  packages: string[]
}

export interface DepsApiResponse {
  results: Record<string, NpmPackageMeta>
  errors: string[]
}
