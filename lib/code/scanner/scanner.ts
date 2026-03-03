// Main scanner — orchestrates all rule scanning, computes health score,
// and produces the final ScanResults.

import type { CodeIndex, SearchResult } from '../code-index'
import { searchIndex } from '../code-index'
import type { FullAnalysis } from '../import-parser'
import type { ScanRule, CodeIssue, IssueSeverity, HealthGrade, ScanResults } from './types'
import { SKIP_VENDORED, detectLanguages } from './constants'
import { SECURITY_RULES } from './rules-security'
import { SECURITY_LANG_RULES } from './rules-security-lang'
import { BAD_PRACTICE_RULES, RELIABILITY_RULES } from './rules-quality'
import { COMPOSITE_RULES, scanCompositeRules } from './rules-composite'
import { scanStructuralIssues } from './structural-scanner'

// Combined rule set (all regex-based rules)
const RULES: ScanRule[] = [
  ...SECURITY_RULES,
  ...SECURITY_LANG_RULES,
  ...BAD_PRACTICE_RULES,
  ...RELIABILITY_RULES,
]

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanIssues(codeIndex: CodeIndex, analysis: FullAnalysis | null): ScanResults {
  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()

  const MAX_PER_RULE = 15
  const ruleOverflow = new Map<string, number>()

  // 1. Run regex-based rules via searchIndex
  let rulesEvaluated = 0
  for (const rule of RULES) {
    if (!rule.pattern) continue

    // Skip rules for languages not present in the codebase
    if (rule.fileFilter && rule.fileFilter.length > 0) {
      const hasMatchingFile = Array.from(codeIndex.files.keys()).some(path => {
        const ext = '.' + (path.split('.').pop() || '')
        return rule.fileFilter!.includes(ext.toLowerCase())
      })
      if (!hasMatchingFile) continue
    }

    rulesEvaluated++
    let ruleCount = 0
    const results: SearchResult[] = searchIndex(codeIndex, rule.pattern, {
      caseSensitive: rule.patternOptions?.caseSensitive ?? false,
      regex: rule.patternOptions?.regex ?? false,
      wholeWord: rule.patternOptions?.wholeWord ?? false,
    })

    for (const result of results) {
      if (rule.fileFilter && rule.fileFilter.length > 0) {
        const ext = '.' + (result.file.split('.').pop() || '')
        if (!rule.fileFilter.includes(ext.toLowerCase())) continue
      }

      if (SKIP_VENDORED.test(result.file)) continue
      if (rule.excludeFiles && rule.excludeFiles.test(result.file)) continue

      for (const match of result.matches) {
        if (rule.excludePattern && rule.excludePattern.test(match.content)) continue

        const issueId = `${rule.id}-${result.file}-${match.line}`
        if (seenIds.has(issueId)) continue
        seenIds.add(issueId)

        ruleCount++
        if (ruleCount > MAX_PER_RULE) {
          ruleOverflow.set(rule.id, (ruleOverflow.get(rule.id) || 0) + 1)
          continue
        }

        issues.push({
          id: issueId,
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          description: rule.description,
          file: result.file,
          line: match.line,
          column: match.column,
          snippet: match.content.trim(),
          suggestion: rule.suggestion,
          cwe: rule.cwe,
          owasp: rule.owasp,
          learnMoreUrl: rule.learnMoreUrl,
        })
      }
    }
  }

  // 2. Run composite file-level rules
  const compositeIssues = scanCompositeRules(codeIndex)
  rulesEvaluated += COMPOSITE_RULES.length
  for (const issue of compositeIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      issues.push(issue)
    }
  }

  // 3. Run structural rules
  const structuralIssues = scanStructuralIssues(codeIndex, analysis)
  const structuralRuleIds = new Set(structuralIssues.map(i => i.ruleId))
  rulesEvaluated += structuralRuleIds.size
  for (const issue of structuralIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      issues.push(issue)
    }
  }

  // Sort: critical first, then warning, then info. Within same severity, by file.
  const severityOrder: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  issues.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity]
    if (sev !== 0) return sev
    return a.file.localeCompare(b.file)
  })

  // Health score — critical issues are grade-killing, not minor deductions.
  // Any critical = maximum D. Each critical drops 30 pts FLAT (not per-kline).
  // Warnings drop 8 pts each, info drops 2 pts each. No normalization by 
  // codebase size — a single RCE in 100k lines is just as bad as in 100 lines.
  const critCount = issues.filter(i => i.severity === 'critical').length
  const warnCount = issues.filter(i => i.severity === 'warning').length
  const infoCount = issues.filter(i => i.severity === 'info').length
  const penalty = (critCount * 30) + (warnCount * 8) + (infoCount * 2)
  let healthScore = Math.max(0, Math.min(100, 100 - penalty))
  // Hard cap: any critical issue means max score is 35 (grade D)
  if (critCount > 0) healthScore = Math.min(healthScore, 35)
  // Any security warning caps at B
  const securityWarnings = issues.filter(i => i.severity === 'warning' && i.category === 'security').length
  if (securityWarnings > 0) healthScore = Math.min(healthScore, 74)
  healthScore = Math.round(healthScore)
  const healthGrade: HealthGrade =
    healthScore >= 90 ? 'A' :
    healthScore >= 75 ? 'B' :
    healthScore >= 60 ? 'C' :
    healthScore >= 40 ? 'D' : 'F'

  return {
    issues,
    summary: {
      total: issues.length,
      critical: critCount,
      warning: warnCount,
      info: infoCount,
      bySecurity: issues.filter(i => i.category === 'security').length,
      byBadPractice: issues.filter(i => i.category === 'bad-practice').length,
      byReliability: issues.filter(i => i.category === 'reliability').length,
    },
    healthGrade,
    healthScore,
    ruleOverflow,
    languagesDetected: detectLanguages(codeIndex),
    rulesEvaluated,
    scannedFiles: codeIndex.totalFiles,
    scannedAt: new Date(),
  }
}
