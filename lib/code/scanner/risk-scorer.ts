// Risk scorer — CVSS-like deterministic scoring for scanner findings.
// Assigns a 0.0–10.0 risk score to each issue and computes project-level aggregates.

import type { CodeIssue, IssueCategory, IssueSeverity } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_SEVERITY: Record<IssueSeverity, number> = {
  critical: 9.0,
  warning: 5.0,
  info: 2.0,
}

const CONFIDENCE_MULTIPLIER: Record<string, number> = {
  high: 1.0,
  medium: 0.8,
  low: 0.5,
}

const CATEGORY_BONUS: Record<IssueCategory, number> = {
  security: 1.0,
  reliability: 0.5,
  'bad-practice': 0.0,
}

const CWE_BONUS = 0.5

// ---------------------------------------------------------------------------
// Core scoring functions
// ---------------------------------------------------------------------------

/** Clamp a value to [0, 10] and round to one decimal place. */
function clampAndRound(value: number): number {
  const clamped = Math.max(0, Math.min(10, value))
  return Math.round(clamped * 10) / 10
}

/**
 * Compute a deterministic 0.0–10.0 risk score for a single issue.
 *
 * Formula: `clamp(baseSeverity * confidenceMultiplier + categoryBonus + cweBonus, 0, 10)`
 *
 * - baseSeverity: critical=9.0, warning=5.0, info=2.0
 * - confidenceMultiplier: high=1.0, medium=0.8, low=0.5
 * - categoryBonus: security=+1.0, reliability=+0.5, bad-practice=+0.0
 * - cweBonus: +0.5 if a CWE identifier is present
 */
export function scoreIssue(issue: CodeIssue): number {
  const base = BASE_SEVERITY[issue.severity]
  const confidence = issue.confidence ?? 'medium'
  const multiplier = CONFIDENCE_MULTIPLIER[confidence] ?? CONFIDENCE_MULTIPLIER.medium
  const catBonus = CATEGORY_BONUS[issue.category] ?? 0
  const cweBonus = issue.cwe ? CWE_BONUS : 0

  return clampAndRound(base * multiplier + catBonus + cweBonus)
}

/**
 * Compute a project-level risk score as a weighted average of issue scores.
 *
 * Each issue's weight equals its own risk score, so higher-risk issues
 * contribute proportionally more. Returns 0.0 when there are no issues.
 */
export function scoreProject(issues: CodeIssue[]): number {
  if (issues.length === 0) return 0.0

  let weightedSum = 0
  let totalWeight = 0

  for (const issue of issues) {
    const score = issue.riskScore ?? scoreIssue(issue)
    weightedSum += score * score // score * weight, where weight = score
    totalWeight += score
  }

  if (totalWeight === 0) return 0.0
  return clampAndRound(weightedSum / totalWeight)
}

/**
 * Map a numeric risk score to a human-readable risk band.
 *
 * - >= 8.0 → critical
 * - >= 5.0 → high
 * - >= 3.0 → medium
 * - < 3.0  → low
 */
export function getRiskBand(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 8.0) return 'critical'
  if (score >= 5.0) return 'high'
  if (score >= 3.0) return 'medium'
  return 'low'
}

/**
 * Count the number of scored issues in each risk band.
 * Issues without a `riskScore` are scored on-the-fly.
 */
export function getRiskDistribution(issues: CodeIssue[]): {
  critical: number
  high: number
  medium: number
  low: number
} {
  const dist = { critical: 0, high: 0, medium: 0, low: 0 }

  for (const issue of issues) {
    const score = issue.riskScore ?? scoreIssue(issue)
    const band = getRiskBand(score)
    dist[band]++
  }

  return dist
}

/**
 * Build a human-readable CVSS-like vector string for an issue.
 *
 * Format: `"S:<severity>/C:<confidence>/CAT:<category>[/CWE:<id>]"`
 *
 * Example: `"S:critical/C:high/CAT:security/CWE:79"`
 */
export function buildCvssVector(issue: CodeIssue): string {
  const parts = [
    `S:${issue.severity}`,
    `C:${issue.confidence ?? 'medium'}`,
    `CAT:${issue.category}`,
  ]

  if (issue.cwe) {
    // Strip "CWE-" prefix if present to keep it tidy: "CWE-79" → "79"
    const cweId = issue.cwe.replace(/^CWE-/i, '')
    parts.push(`CWE:${cweId}`)
  }

  return parts.join('/')
}
