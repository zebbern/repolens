/**
 * Health scoring algorithm for npm dependencies.
 * Produces a 0-100 score and A-F grade based on weighted factors.
 */

import type { HealthGrade, HealthConfidence, HealthSignal, NpmPackageMeta } from './types'

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const WEIGHT_DOWNLOADS = 0.2
const WEIGHT_MAINTENANCE = 0.3
const WEIGHT_SECURITY = 0.3
const WEIGHT_OUTDATED = 0.2

// ---------------------------------------------------------------------------
// Sub-scores
// ---------------------------------------------------------------------------

/**
 * Score based on weekly downloads using logarithmic scaling.
 * 0 → 0, 1k → 40, 10k → 60, 100k → 80, 1M+ → 100
 */
export function calculateDownloadScore(weeklyDownloads: number): number {
  if (weeklyDownloads <= 0) return 0
  if (weeklyDownloads >= 1_000_000) return 100

  // log10 scale: log10(1000)=3 → 40, log10(10000)=4 → 60, log10(100000)=5 → 80, log10(1000000)=6 → 100
  const log = Math.log10(weeklyDownloads)
  // Map log10 range [0, 6] to score [0, 100]
  const score = Math.min(100, Math.max(0, (log / 6) * 100))
  return Math.round(score)
}

/**
 * Score based on last publish date recency and deprecation status.
 * Deprecated packages always score 0.
 * < 3 months → 100, < 6 months → 80, < 1 year → 60, < 2 years → 40, older → 20
 */
export function calculateMaintenanceScore(
  lastPublish: string,
  isDeprecated: boolean,
): number {
  if (isDeprecated) return 0

  const publishDate = new Date(lastPublish)
  if (isNaN(publishDate.getTime())) return 20 // unparseable date → assume stale

  const ageMs = Date.now() - publishDate.getTime()
  const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30.44) // average month length

  if (ageMonths < 3) return 100
  if (ageMonths < 6) return 80
  if (ageMonths < 12) return 60
  if (ageMonths < 24) return 40
  return 20
}

/**
 * Score based on CVE count.
 * 0 CVEs → 100, 1 → 60, 2 → 30, 3+ → 0
 */
export function calculateSecurityScore(cveCount: number): number {
  if (cveCount <= 0) return 100
  if (cveCount === 1) return 60
  if (cveCount === 2) return 30
  return 0
}

/**
 * Score based on how outdated the package is.
 * Up-to-date → 100, patch behind → 70, minor behind → 40, major behind → 10
 */
export function calculateOutdatedScore(
  outdatedType: 'major' | 'minor' | 'patch' | null,
): number {
  if (outdatedType === null) return 100
  if (outdatedType === 'patch') return 70
  if (outdatedType === 'minor') return 40
  return 10 // major
}

// ---------------------------------------------------------------------------
// Grade mapping
// ---------------------------------------------------------------------------

/** Map a numeric score (0-100) to a letter grade. */
export function scoreToGrade(score: number): HealthGrade {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

// ---------------------------------------------------------------------------
// Combined scorer
// ---------------------------------------------------------------------------

/**
 * Calculate the overall health score for a dependency.
 * Returns a 0-100 score and A-F grade.
 *
 * Returns null when registry metadata is incomplete; partial inputs must not
 * be presented as a complete health score.
 */
export function calculateHealthScore(
  meta: NpmPackageMeta | null,
  cveCount: number,
  outdatedType: 'major' | 'minor' | 'patch' | null,
): number | null {
  if (!meta?.lastPublish) return null
  const securityScore = calculateSecurityScore(cveCount)
  const outdatedScore = calculateOutdatedScore(outdatedType)

  const downloadScore = calculateDownloadScore(meta.weeklyDownloads)
  const maintenanceScore = calculateMaintenanceScore(meta.lastPublish, meta.deprecated)

  const score =
    downloadScore * WEIGHT_DOWNLOADS +
    maintenanceScore * WEIGHT_MAINTENANCE +
    securityScore * WEIGHT_SECURITY +
    outdatedScore * WEIGHT_OUTDATED

  return Math.round(score)
}

/**
 * Compute the full health assessment for a dependency.
 * Combines calculateHealthScore and scoreToGrade.
 */
export function computeDependencyHealth(
  meta: NpmPackageMeta | null,
  cveCount: number | HealthSignal<number>,
  outdatedType: 'major' | 'minor' | 'patch' | null | HealthSignal<'major' | 'minor' | 'patch' | null>,
): { score: number | null; grade: HealthGrade | null; confidence: HealthConfidence } {
  if (meta === null || meta.lastPublish === null) {
    return { score: null, grade: null, confidence: 'unknown' }
  }
  if (typeof cveCount !== 'number' && cveCount.status === 'unknown') {
    return { score: null, grade: null, confidence: 'unknown' }
  }
  if (outdatedType !== null && typeof outdatedType === 'object' && outdatedType.status === 'unknown') {
    return { score: null, grade: null, confidence: 'unknown' }
  }

  const knownCves = typeof cveCount === 'number'
    ? cveCount
    : cveCount.value
  const knownOutdated = outdatedType === null || typeof outdatedType === 'string'
    ? outdatedType
    : outdatedType.value
  const score = calculateHealthScore(meta, knownCves, knownOutdated)
  if (score === null) return { score: null, grade: null, confidence: 'unknown' }
  return {
    score,
    grade: scoreToGrade(score),
    confidence: 'known',
  }
}
