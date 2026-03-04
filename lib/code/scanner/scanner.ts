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
import { FRAMEWORK_RULES } from './rules-framework'
import { COMPOSITE_RULES, scanCompositeRules } from './rules-composite'
import { scanStructuralIssues } from './structural-scanner'
import { scanSupplyChain } from './supply-chain-scanner'
import { classifyLine, computeBlockCommentLines, hasInlineSuppression, hasSanitizerNearby, computeDynamicConfidence } from './context-classifier'
import { isLikelyRealSecret } from './entropy'

// Combined rule set (all regex-based rules)
const RULES: ScanRule[] = [
  ...SECURITY_RULES,
  ...SECURITY_LANG_RULES,
  ...BAD_PRACTICE_RULES,
  ...RELIABILITY_RULES,
  ...FRAMEWORK_RULES,
]

// Rule IDs related to secrets/passwords (used for entropy & type-annotation suppression).
// Only assignment-pattern rules — high-confidence pattern-specific rules (aws-key,
// github-token) already have specific patterns that minimise FPs.
const SECRET_RULE_IDS = /secret|password/i

// Rule IDs suppressed when match is inside a string literal
const STRING_LITERAL_SUPPRESSED_IDS = new Set(['eval-usage', 'sql-injection'])

// Regex to extract a quoted value from a snippet like `key = "VALUE"` or `password: 'VALUE'`
const EXTRACT_SECRET_VALUE = /[:=]\s*["'`]([^"'`]{4,})["'`]/

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanIssues(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  changedFiles?: string[],
): ScanResults {
  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()

  const MAX_PER_RULE = 15
  const ruleOverflow = new Map<string, number>()
  let suppressionCount = 0

  const isPartialScan = changedFiles !== undefined && changedFiles.length > 0

  // Empty array → full scan (pass undefined for no files, empty array treated as "no filter")
  // Build the set of files to scan
  const filesToScan: Map<string, typeof codeIndex.files extends Map<string, infer V> ? V : never> = new Map()
  if (isPartialScan) {
    for (const changed of changedFiles!) {
      const file = codeIndex.files.get(changed)
      if (file) filesToScan.set(changed, file)
    }
  } else {
    for (const [path, file] of codeIndex.files) {
      filesToScan.set(path, file)
    }
  }

  // For partial scans we still use the full codeIndex for searchIndex (it
  // searches globally), but we filter results to only the changed files.
  const scanCodeIndex = codeIndex

  // 1. Run regex-based rules via searchIndex
  let rulesEvaluated = 0
  for (const rule of RULES) {
    if (!rule.pattern) continue

    // Skip rules for languages not present in the codebase
    if (rule.fileFilter && rule.fileFilter.length > 0) {
      const hasMatchingFile = Array.from(filesToScan.keys()).some(path => {
        const ext = '.' + (path.split('.').pop() || '')
        return rule.fileFilter!.includes(ext.toLowerCase())
      })
      if (!hasMatchingFile) continue
    }

    rulesEvaluated++
    let ruleCount = 0
    const results: SearchResult[] = searchIndex(scanCodeIndex, rule.pattern, {
      caseSensitive: rule.patternOptions?.caseSensitive ?? false,
      regex: rule.patternOptions?.regex ?? false,
      wholeWord: rule.patternOptions?.wholeWord ?? false,
    })

    const isSecurityCritical = rule.severity === 'critical' && rule.category === 'security'

    for (const result of results) {
      // Differential scan: only process files in the changed set
      if (isPartialScan && !filesToScan.has(result.file)) continue

      if (rule.fileFilter && rule.fileFilter.length > 0) {
        const ext = '.' + (result.file.split('.').pop() || '')
        if (!rule.fileFilter.includes(ext.toLowerCase())) continue
      }

      if (SKIP_VENDORED.test(result.file)) continue
      if (rule.excludeFiles && rule.excludeFiles.test(result.file)) continue

      // Get all lines for context classification
      const indexedFile = scanCodeIndex.files.get(result.file)
      const allLines = indexedFile?.lines
      // Pre-compute block comment line indices once per file (avoids O(n*m) re-scan)
      const blockCommentLines = allLines ? computeBlockCommentLines(allLines) : undefined

      for (const match of result.matches) {
        if (rule.excludePattern && rule.excludePattern.test(match.content)) continue

        // --- Context-aware suppression ---
        const ctx = classifyLine(match.content, result.file, blockCommentLines, match.line - 1)

        // Comment suppression (unless security-critical)
        if (ctx.isComment && !isSecurityCritical) continue

        // Test/generated/example file suppression (non-security only)
        if ((ctx.isTestFile || ctx.isGeneratedFile || ctx.isExampleFile) && rule.category !== 'security') continue

        // Type annotation suppression for credential patterns
        if (ctx.isTypeAnnotation && SECRET_RULE_IDS.test(rule.id)) continue

        // String literal suppression for eval/sql patterns
        if (ctx.isStringLiteral && STRING_LITERAL_SUPPRESSED_IDS.has(rule.id)) continue

        // --- Entropy check for secret/password rules ---
        // Only applies to assignment-pattern rules (hardcoded-secret, hardcoded-password).
        // High-confidence pattern-specific rules (aws-key, github-token) already have
        // specific regexes that minimise FPs — entropy is not needed for them.
        if (SECRET_RULE_IDS.test(rule.id)) {
          const valueMatch = match.content.match(EXTRACT_SECRET_VALUE)
          if (valueMatch) {
            const secretValue = valueMatch[1]
            if (!isLikelyRealSecret(secretValue)) continue
          }
        }

        // --- Inline suppression check ---
        const prevLine = allLines && match.line >= 2 ? allLines[match.line - 2] : undefined
        const requireScoped = rule.severity === 'critical'
        if (hasInlineSuppression(match.content, prevLine, rule.id, requireScoped)) {
          suppressionCount++
          continue
        }

        // --- Compute dynamic confidence ---
        let issueConfidence = computeDynamicConfidence(rule.confidence, ctx, match.content)

        // --- Sanitizer proximity detection (security rules only) ---
        let issueDescription = rule.description
        if (rule.category === 'security' && allLines) {
          if (hasSanitizerNearby(allLines, match.line - 1)) {
            issueConfidence = issueConfidence === 'high' ? 'medium'
              : issueConfidence === 'medium' ? 'low'
              : 'low'
            issueDescription += ' (sanitizer detected nearby)'
          }
        }

        // --- Dynamic confidence boost for config files (secret rules) ---
        if (SECRET_RULE_IDS.test(rule.id) && /\.(?:config|env)/i.test(result.file)) {
          // Config files are higher risk for leaked secrets — boost confidence
          if (issueConfidence === 'low') issueConfidence = 'medium'
          else if (issueConfidence === 'medium') issueConfidence = 'high'
        }

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
          description: issueDescription,
          file: result.file,
          line: match.line,
          column: match.column,
          snippet: match.content.trim(),
          suggestion: rule.suggestion,
          cwe: rule.cwe,
          owasp: rule.owasp,
          learnMoreUrl: rule.learnMoreUrl,
          confidence: issueConfidence,
          fix: rule.fix,
          fixDescription: rule.fixDescription,
        })
      }
    }
  }

  // 2. Run composite file-level rules
  const compositeIssues = scanCompositeRules(codeIndex)
  rulesEvaluated += COMPOSITE_RULES.length
  for (const issue of compositeIssues) {
    // Differential scan: only include issues from changed files
    if (isPartialScan && !filesToScan.has(issue.file)) continue
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
    if (isPartialScan && !filesToScan.has(issue.file)) continue
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      issues.push(issue)
    }
  }

  // 4. Supply chain rules (package.json, lockfiles, GitHub Actions, Python deps)
  const supplyChainIssues = scanSupplyChain(scanCodeIndex)
  const supplyChainRuleIds = new Set(supplyChainIssues.map(i => i.ruleId))
  rulesEvaluated += supplyChainRuleIds.size
  for (const issue of supplyChainIssues) {
    if (isPartialScan && !filesToScan.has(issue.file)) continue
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      issues.push(issue)
    }
  }

  // 5. Structural context cross-reference (when import graph is available)
  if (analysis) {
    for (const issue of issues) {
      const importers = analysis.graph.reverseEdges.get(issue.file)
      const importerCount = importers?.size ?? 0
      const isEntryPoint = analysis.topology.entryPoints.includes(issue.file)
      const isDead = !isEntryPoint && importerCount === 0

      // Dead code downgrade: quality/reliability issues in unused files → info
      if (isDead && issue.category !== 'security' && (issue.severity === 'warning' || issue.severity === 'critical')) {
        issue.severity = 'info'
      }

      // Entry point annotation for security issues
      if (isEntryPoint && issue.category === 'security') {
        issue.description += ' (entry point — publicly accessible)'
      }

      // High fan-in annotation
      if (importerCount >= 10) {
        issue.description += ` (high fan-in: ${importerCount} importers — changes affect many consumers)`
      }
    }
  }

  // Sort: critical first, then warning, then info. Within same severity, by file.
  const severityOrder: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  issues.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity]
    if (sev !== 0) return sev
    return a.file.localeCompare(b.file)
  })

  // ---------------------------------------------------------------------------
  // Health scoring
  // ---------------------------------------------------------------------------

  // SLOC estimate for density-based scoring
  const sloc = Array.from(filesToScan.values()).reduce((sum, f) => sum + f.lineCount, 0)
  const issuesPerKloc = (issues.length / Math.max(sloc, 1)) * 1000

  // Overall health score — absolute severity-based
  const critCount = issues.filter(i => i.severity === 'critical').length
  const warnCount = issues.filter(i => i.severity === 'warning').length
  const infoCount = issues.filter(i => i.severity === 'info').length
  const penalty = (critCount * 30) + (warnCount * 8) + (infoCount * 2)
  let healthScore = Math.max(0, Math.min(100, 100 - penalty))
  if (critCount > 0) healthScore = Math.min(healthScore, 35)
  const securityWarnings = issues.filter(i => i.severity === 'warning' && i.category === 'security').length
  if (securityWarnings > 0) healthScore = Math.min(healthScore, 89)
  healthScore = Math.round(healthScore)
  const healthGrade: HealthGrade =
    healthScore >= 90 ? 'A' :
    healthScore >= 75 ? 'B' :
    healthScore >= 60 ? 'C' :
    healthScore >= 40 ? 'D' : 'F'

  // Security grade — absolute scoring, security issues only
  const secIssues = issues.filter(i => i.category === 'security')
  const secCrit = secIssues.filter(i => i.severity === 'critical').length
  const secWarn = secIssues.filter(i => i.severity === 'warning').length
  const secInfo = secIssues.filter(i => i.severity === 'info').length
  const secPenalty = (secCrit * 30) + (secWarn * 8) + (secInfo * 2)
  let secScore = Math.max(0, Math.min(100, 100 - secPenalty))
  if (secCrit > 0) secScore = Math.min(secScore, 35)
  if (secWarn > 0) secScore = Math.min(secScore, 89)
  secScore = Math.round(secScore)
  const securityGrade: HealthGrade =
    secScore >= 90 ? 'A' :
    secScore >= 75 ? 'B' :
    secScore >= 60 ? 'C' :
    secScore >= 40 ? 'D' : 'F'

  // Quality grade — density-based scoring (issues per KLOC)
  const qualityIssues = issues.filter(i => i.category !== 'security')
  const qualityDensity = (qualityIssues.length / Math.max(sloc, 1)) * 1000
  const qualityGrade: HealthGrade =
    qualityDensity < 5 ? 'A' :
    qualityDensity < 15 ? 'B' :
    qualityDensity < 30 ? 'C' :
    qualityDensity < 50 ? 'D' : 'F'

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
    scannedFiles: isPartialScan ? filesToScan.size : codeIndex.totalFiles,
    scannedAt: new Date(),
    securityGrade,
    qualityGrade,
    issuesPerKloc,
    isPartialScan,
    suppressionCount,
  }
}
