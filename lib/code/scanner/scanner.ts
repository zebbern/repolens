// Main scanner — orchestrates all rule scanning, computes health score,
// and produces the final ScanResults.
//
// NOTE: scanIssues() is memoized by codeIndex reference to avoid redundant
// O(n) scans when multiple components (code-browser, issues-panel) call it
// with the same index.

import type { CodeIndex, IndexedFile } from '../code-index'
import { buildSearchRegex, getFileLines } from '../code-index'
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
import { getAST, analyzeAST, AST_LANGUAGES, clearASTCache } from './ast-analyzer'
import { trackTaint, taintFlowsToIssues } from './taint-tracker'
import { scoreIssue, scoreProject, getRiskDistribution, buildCvssVector } from './risk-scorer'
import { scanWithTreeSitter } from './tree-sitter-scanner'

const MAX_PER_RULE = 15

/** File entry type extracted from CodeIndex. */
type FileEntry = CodeIndex['files'] extends Map<string, infer V> ? V : never

// Combined rule set (all regex-based rules)
const RULES: ScanRule[] = [
  ...SECURITY_RULES,
  ...SECURITY_LANG_RULES,
  ...BAD_PRACTICE_RULES,
  ...RELIABILITY_RULES,
  ...FRAMEWORK_RULES,
]

/** Returns the full set of regex-based scan rules. */
export function getAllRules(): ScanRule[] {
  return RULES
}

/** Compute summary counts from an issues array. */
export function computeScanSummary(issues: CodeIssue[]) {
  return {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    bySecurity: issues.filter(i => i.category === 'security').length,
    byBadPractice: issues.filter(i => i.category === 'bad-practice').length,
    byReliability: issues.filter(i => i.category === 'reliability').length,
  }
}

// Rule IDs related to secrets/passwords (used for type-annotation suppression).
// Only assignment-pattern rules — high-confidence pattern-specific rules (aws-key,
// github-token) already have specific patterns that minimise FPs.
const SECRET_RULE_IDS = /secret|password/i

// Subset of secret rules that benefit from entropy filtering.
// Password rules are excluded: passwords are inherently low-entropy
// ("admin123", "password1") but still represent real security risks.
const ENTROPY_CHECKED_RULE_IDS = /secret/i

// Rule IDs suppressed when match is inside a string literal
const STRING_LITERAL_SUPPRESSED_IDS = new Set(['eval-usage', 'sql-injection', 'innerhtml-xss'])

// Regex to extract a quoted value from a snippet like `key = "VALUE"` or `password: 'VALUE'`
const EXTRACT_SECRET_VALUE = /[:=]\s*["'`]([^"'`]{4,})["'`]/

// ---------------------------------------------------------------------------
// Scan memoization — avoids redundant O(n) scans when multiple components
// (code-browser + issues-panel) call scanIssues with the same codeIndex.
// ---------------------------------------------------------------------------

let lastScanRef: WeakRef<CodeIndex> | null = null
let lastScanAnalysis: FullAnalysis | null = null
let lastScanResult: ScanResults | null = null

// In-flight async scan dedup — prevents concurrent scans for the same index.
let pendingScan: Promise<ScanResults | null> | null = null
let pendingScanIndex: WeakRef<CodeIndex> | null = null

/** Clear the scan cache, e.g. for testing. */
export function clearScanCache(): void {
  lastScanRef = null
  lastScanAnalysis = null
  lastScanResult = null
  pendingScan = null
  pendingScanIndex = null
  clearASTCache()
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

/** Shared context for scan helper functions. */
interface ScanContext {
  filesToScan: Map<string, IndexedFile>
  scanCodeIndex: CodeIndex
  isPartialScan: boolean
  blockCommentCache: Map<string, Set<number> | undefined>
  presentExtensions: Set<string>
  filesByExtension: Map<string, Map<string, IndexedFile>>
}

/** Result returned by runRegexRules helper. */
interface RegexRulesResult {
  issues: CodeIssue[]
  rulesEvaluated: number
  suppressionCount: number
  ruleOverflow: Map<string, number>
}

// ---------------------------------------------------------------------------
// D3: Regex rule scanning helper (single-pass architecture)
// ---------------------------------------------------------------------------

/** Pre-compiled rule with its regex ready for matching. */
interface CompiledRule {
  rule: ScanRule
  regex: RegExp
  isSecurityCritical: boolean
}

/**
 * Compile all RULES into RegExp objects upfront, grouped by applicable
 * file extension.  Rules with no `fileFilter` go into `universalRules`.
 */
function buildCompiledRuleIndex(presentExtensions: Set<string>): {
  /** Rules keyed by lowercased extension (e.g. ".ts") */
  rulesForExtension: Map<string, CompiledRule[]>
  /** Rules that apply to every file (no fileFilter) */
  universalRules: CompiledRule[]
  /** Total unique rules that were compiled */
  rulesEvaluated: number
} {
  const rulesForExtension = new Map<string, CompiledRule[]>()
  const universalRules: CompiledRule[] = []
  let rulesEvaluated = 0

  for (const rule of RULES) {
    if (!rule.pattern) continue

    // Skip rules whose file filters don't match any extension in the codebase
    if (rule.fileFilter && rule.fileFilter.length > 0) {
      const hasMatchingFile = rule.fileFilter.some(ext => presentExtensions.has(ext.toLowerCase()))
      if (!hasMatchingFile) continue
    }

    const compiled = buildSearchRegex(rule.pattern, {
      caseSensitive: rule.patternOptions?.caseSensitive ?? false,
      regex: rule.patternOptions?.regex ?? false,
      wholeWord: rule.patternOptions?.wholeWord ?? false,
    })
    if (!compiled) continue

    rulesEvaluated++
    const entry: CompiledRule = {
      rule,
      regex: compiled,
      isSecurityCritical: rule.severity === 'critical' && rule.category === 'security',
    }

    if (rule.fileFilter && rule.fileFilter.length > 0) {
      for (const ext of rule.fileFilter) {
        const key = ext.toLowerCase()
        let list = rulesForExtension.get(key)
        if (!list) {
          list = []
          rulesForExtension.set(key, list)
        }
        list.push(entry)
      }
    } else {
      universalRules.push(entry)
    }
  }

  return { rulesForExtension, universalRules, rulesEvaluated }
}

function runRegexRules(ctx: ScanContext): RegexRulesResult {
  const { filesToScan, scanCodeIndex, isPartialScan, blockCommentCache, presentExtensions } = ctx
  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()
  let suppressionCount = 0
  const ruleOverflow = new Map<string, number>()
  const ruleCounts = new Map<string, number>()

  // --- Phase 1: Single-pass over files --------------------------------

  const { rulesForExtension, universalRules, rulesEvaluated } =
    buildCompiledRuleIndex(presentExtensions)

  for (const [path, file] of filesToScan) {
    if (!file.content) continue
    if (SKIP_VENDORED.test(path)) continue

    const ext = '.' + (path.split('.').pop() || '').toLowerCase()

    // Merge universal rules with extension-specific rules for this file
    const extRules = rulesForExtension.get(ext)
    const applicableRules = extRules
      ? [...universalRules, ...extRules]
      : universalRules
    if (applicableRules.length === 0) continue

    const lines = getFileLines(file)

    // Compute block comments once per file
    if (!blockCommentCache.has(path)) {
      blockCommentCache.set(path, computeBlockCommentLines(lines))
    }
    const blockCommentLines = blockCommentCache.get(path)

    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i]
      const lineNum = i + 1

      for (const { rule, regex, isSecurityCritical } of applicableRules) {
        // Per-rule file exclusion
        if (rule.excludeFiles && rule.excludeFiles.test(path)) continue

        // Test compiled regex against the line
        regex.lastIndex = 0
        if (!regex.test(lineContent)) continue

        // Per-rule line exclusion
        if (rule.excludePattern && rule.excludePattern.test(lineContent)) continue

        // --- Context-aware suppression ---
        const lineCtx = classifyLine(lineContent, path, blockCommentLines, i)

        if (lineCtx.isComment && !isSecurityCritical && rule.id !== 'todo-fixme') continue
        if ((lineCtx.isTestFile || lineCtx.isGeneratedFile || lineCtx.isExampleFile) && rule.category !== 'security') continue
        if (lineCtx.isTypeAnnotation && SECRET_RULE_IDS.test(rule.id)) continue
        if (lineCtx.isStringLiteral && STRING_LITERAL_SUPPRESSED_IDS.has(rule.id)) continue

        // --- Entropy check for secret rules ---
        if (ENTROPY_CHECKED_RULE_IDS.test(rule.id)) {
          const valueMatch = lineContent.match(EXTRACT_SECRET_VALUE)
          if (valueMatch) {
            const secretValue = valueMatch[1]
            if (!isLikelyRealSecret(secretValue)) continue
          }
        }

        // --- Inline suppression check ---
        const prevLine = lineNum >= 2 ? lines[i - 1] : undefined
        const requireScoped = rule.severity === 'critical'
        if (hasInlineSuppression(lineContent, prevLine, rule.id, requireScoped)) {
          suppressionCount++
          continue
        }

        // --- Compute dynamic confidence ---
        let issueConfidence = computeDynamicConfidence(rule.confidence, lineCtx, lineContent)

        // --- Sanitizer proximity detection (security rules only) ---
        let issueDescription = rule.description
        if (rule.category === 'security') {
          if (hasSanitizerNearby(lines, i)) {
            issueConfidence = issueConfidence === 'high' ? 'medium'
              : issueConfidence === 'medium' ? 'low'
              : 'low'
            issueDescription += ' (sanitizer detected nearby)'
          }
        }

        // --- Dynamic confidence boost for config files (secret rules) ---
        if (SECRET_RULE_IDS.test(rule.id) && /\.(?:config|env)/i.test(path)) {
          if (issueConfidence === 'low') issueConfidence = 'medium'
          else if (issueConfidence === 'medium') issueConfidence = 'high'
        }

        // --- Dedup ---
        const issueId = `${rule.id}-${path}-${lineNum}`
        if (seenIds.has(issueId)) continue
        seenIds.add(issueId)

        // --- Per-rule cap ---
        const ruleCount = (ruleCounts.get(rule.id) || 0) + 1
        ruleCounts.set(rule.id, ruleCount)
        if (ruleCount > MAX_PER_RULE) {
          ruleOverflow.set(rule.id, (ruleOverflow.get(rule.id) || 0) + 1)
          continue
        }

        // --- Compute column from match position ---
        regex.lastIndex = 0
        const matchResult = regex.exec(lineContent)
        const column = matchResult ? matchResult.index : 0

        issues.push({
          id: issueId,
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          description: issueDescription,
          file: path,
          line: lineNum,
          column,
          snippet: lineContent.trim(),
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

  // ---------------------------------------------------------------------------
  // Phase 2: Multi-line scanning pass — catch patterns spanning 2-3 lines
  // ---------------------------------------------------------------------------
  const MULTILINE_RULE_IDS = new Set([
    'sql-injection',
    'python-subprocess-shell',
    'jwt-weak-secret',
    'error-stack-exposure',
    'django-raw-sql',
    'command-injection-exec-direct',
  ])

  for (const rule of RULES) {
    if (!rule.pattern || !MULTILINE_RULE_IDS.has(rule.id)) continue

    // Respect file-filter: skip if no matching extensions present
    if (rule.fileFilter && rule.fileFilter.length > 0) {
      const hasMatchingFile = rule.fileFilter.some(ext => presentExtensions.has(ext.toLowerCase()))
      if (!hasMatchingFile) continue
    }

    const flags = (rule.patternOptions?.caseSensitive ?? false) ? 'g' : 'gi'
    let multilineRegex: RegExp
    try {
      multilineRegex = new RegExp(rule.pattern, flags)
    } catch {
      continue
    }

    const isSecurityCritical = rule.severity === 'critical' && rule.category === 'security'

    for (const [path, file] of filesToScan) {
      if (isPartialScan && !filesToScan.has(path)) continue
      if (rule.fileFilter && rule.fileFilter.length > 0) {
        const ext = '.' + (path.split('.').pop() || '')
        if (!rule.fileFilter.includes(ext.toLowerCase())) continue
      }
      if (SKIP_VENDORED.test(path)) continue
      if (rule.excludeFiles && rule.excludeFiles.test(path)) continue

      const lines = getFileLines(file)
      if (!blockCommentCache.has(path)) {
        blockCommentCache.set(path, lines ? computeBlockCommentLines(lines) : undefined)
      }
      const blockCommentLines = blockCommentCache.get(path)

      for (let i = 0; i < lines.length - 1; i++) {
        const lineNum = i + 1
        const issueId = `${rule.id}-${path}-${lineNum}`
        if (seenIds.has(issueId)) continue

        const joined = i + 2 < lines.length
          ? lines[i] + ' ' + lines[i + 1] + ' ' + lines[i + 2]
          : lines[i] + ' ' + lines[i + 1]

        multilineRegex.lastIndex = 0
        if (!multilineRegex.test(joined)) continue

        // Exclusions
        if (rule.excludePattern && rule.excludePattern.test(joined)) continue

        // Context-aware suppression on the first line
        const lineCtx = classifyLine(lines[i], path, blockCommentLines, i)
        if (lineCtx.isComment && !isSecurityCritical && rule.id !== 'todo-fixme') continue
        if ((lineCtx.isTestFile || lineCtx.isGeneratedFile || lineCtx.isExampleFile) && rule.category !== 'security') continue
        if (lineCtx.isTypeAnnotation && SECRET_RULE_IDS.test(rule.id)) continue
        if (lineCtx.isStringLiteral && STRING_LITERAL_SUPPRESSED_IDS.has(rule.id)) continue

        // Inline suppression
        const prevLine = i >= 1 ? lines[i - 1] : undefined
        if (hasInlineSuppression(lines[i], prevLine, rule.id, rule.severity === 'critical')) {
          suppressionCount++
          continue
        }

        let issueConfidence = computeDynamicConfidence(rule.confidence, lineCtx, joined)
        let issueDescription = rule.description
        if (rule.category === 'security') {
          if (hasSanitizerNearby(lines, i)) {
            issueConfidence = issueConfidence === 'high' ? 'medium' : 'low'
            issueDescription += ' (sanitizer detected nearby)'
          }
        }

        seenIds.add(issueId)
        issues.push({
          id: issueId,
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          description: issueDescription,
          file: path,
          line: lineNum,
          column: 0,
          snippet: lines[i].trim(),
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

  return { issues, rulesEvaluated, suppressionCount, ruleOverflow }
}

// ---------------------------------------------------------------------------
// D4: AST analysis helper
// ---------------------------------------------------------------------------

function runAstAnalysis(
  filesToScan: Map<string, IndexedFile>,
): CodeIssue[] {
  const issues: CodeIssue[] = []
  for (const [path, file] of filesToScan) {
    if (SKIP_VENDORED.test(path)) continue
    const lang = file.language ?? ''
    if (!AST_LANGUAGES.has(lang)) continue
    try {
      const ast = getAST(file)
      if (!ast) continue
      const astIssues = analyzeAST(ast, file)
      issues.push(...astIssues)
    } catch (err) {
      console.warn(`[scanner] AST analysis failed for ${path}:`, err)
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// D5: Taint analysis helper
// ---------------------------------------------------------------------------

function runTaintAnalysis(
  filesToScan: Map<string, IndexedFile>,
): CodeIssue[] {
  const issues: CodeIssue[] = []
  for (const [path, file] of filesToScan) {
    if (SKIP_VENDORED.test(path)) continue
    const lang = file.language ?? ''
    if (!AST_LANGUAGES.has(lang)) continue
    try {
      const ast = getAST(file)
      if (!ast) continue
      const taintFlows = trackTaint(ast, file)
      issues.push(...taintFlowsToIssues(taintFlows))
    } catch (err) {
      console.warn(`[scanner] Taint analysis failed for ${path}:`, err)
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// D6: Health grade computation helper
// ---------------------------------------------------------------------------

interface HealthGrades {
  healthGrade: HealthGrade
  healthScore: number
  securityGrade: HealthGrade
  qualityGrade: HealthGrade
  issuesPerKloc: number
}

function computeHealthGrades(issues: CodeIssue[], sloc: number): HealthGrades {
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

  return { healthGrade, healthScore, securityGrade, qualityGrade, issuesPerKloc }
}

// ---------------------------------------------------------------------------
// D7: Deduplication helper — resolves AST vs regex overlapping findings
// ---------------------------------------------------------------------------

function deduplicateIssues(
  issues: CodeIssue[],
  scanCodeIndex: CodeIndex,
  ruleOverflow: Map<string, number>,
): void {
  // AST empty-catch wins over regex empty-catch for same file+line
  const astEmptyCatchKeys = new Set(
    issues.filter(i => i.ruleId === 'ast-empty-catch').map(i => `${i.file}:${i.line}`)
  )
  if (astEmptyCatchKeys.size > 0) {
    for (let i = issues.length - 1; i >= 0; i--) {
      const issue = issues[i]
      if (issue.ruleId === 'empty-catch' && astEmptyCatchKeys.has(`${issue.file}:${issue.line}`)) {
        issues.splice(i, 1)
      }
    }
  }

  // Prefer regex eval-usage (has CWE, suppression, MAX_PER_RULE metadata)
  // over ast-eval-usage at the same file+line.
  const regexEvalKeys = new Set(
    issues.filter(i => i.ruleId === 'eval-usage').map(i => `${i.file}:${i.line}`)
  )
  if (regexEvalKeys.size > 0) {
    for (let i = issues.length - 1; i >= 0; i--) {
      const issue = issues[i]
      if (issue.ruleId === 'ast-eval-usage' && regexEvalKeys.has(`${issue.file}:${issue.line}`)) {
        issues.splice(i, 1)
      }
    }
  }

  // Normalize remaining ast-eval-usage (AST-only findings) to eval-usage
  // and apply MAX_PER_RULE cap + inline suppression.
  // Also apply the regex eval-usage rule's excludeFiles so test/fixture files
  // are not flagged by the AST path (which has no excludeFiles of its own).
  const EVAL_EXCLUDE_FILES = /rules-security|rules-security-lang|rules-quality|rules-framework|rules-composite|\.d\.ts$|\.test\.|\.spec\.|__tests__|fixture|mock/i
  const existingEvalCount = issues.filter(i => i.ruleId === 'eval-usage').length
  let normalizedEvalCount = existingEvalCount
  for (let i = issues.length - 1; i >= 0; i--) {
    const issue = issues[i]
    if (issue.ruleId !== 'ast-eval-usage') continue
    // Apply excludeFiles check (mirrors regex eval-usage rule)
    if (EVAL_EXCLUDE_FILES.test(issue.file)) {
      issues.splice(i, 1)
      continue
    }
    issue.ruleId = 'eval-usage'
    issue.id = issue.id.replace('ast-eval-usage', 'eval-usage')
    if (!issue.cwe) issue.cwe = 'CWE-94'
    // Apply inline suppression check for normalized issues
    const indexedFile = scanCodeIndex.files.get(issue.file)
    const allLines = indexedFile ? getFileLines(indexedFile) : undefined
    const lineContent = allLines && issue.line >= 1 && issue.line <= allLines.length ? allLines[issue.line - 1] : ''
    const prevLine = allLines && issue.line >= 2 ? allLines[issue.line - 2] : undefined
    if (hasInlineSuppression(lineContent, prevLine, 'eval-usage', true)) {
      issues.splice(i, 1)
      continue
    }
    // Apply MAX_PER_RULE cap
    normalizedEvalCount++
    if (normalizedEvalCount > MAX_PER_RULE) {
      ruleOverflow.set('eval-usage', (ruleOverflow.get('eval-usage') || 0) + 1)
      issues.splice(i, 1)
    }
  }
}

// ---------------------------------------------------------------------------
// Scan options
// ---------------------------------------------------------------------------

/** Options for scanIssues and scanIssuesAsync. */
export interface ScanOptions {
  /** When true, only metadata-only rules run (no content parsing). */
  metadataOnly?: boolean
  /** Differential scan: only check these files. */
  changedFiles?: string[]
}

/** Count files in the index that have no content loaded (empty string or undefined). */
function countUnscannedFiles(codeIndex: CodeIndex): number {
  let count = 0
  for (const file of codeIndex.files.values()) {
    if (!file.content) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Main scan orchestrator
// ---------------------------------------------------------------------------

export function scanIssues(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  changedFilesOrOptions?: string[] | ScanOptions,
): ScanResults {
  const options: ScanOptions = Array.isArray(changedFilesOrOptions)
    ? { changedFiles: changedFilesOrOptions }
    : changedFilesOrOptions ?? {}
  const { metadataOnly = false, changedFiles } = options

  // Return cached result if the same codeIndex instance + analysis is requested.
  // Only applies to full scans (no changedFiles, no metadataOnly) since partial scans are cheap.
  if (!changedFiles && !metadataOnly && lastScanRef && lastScanResult) {
    const cachedRef = lastScanRef.deref()
    if (cachedRef === codeIndex && lastScanAnalysis === analysis) {
      return lastScanResult
    }
  }

  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()

  const isPartialScan = changedFiles !== undefined && changedFiles.length > 0

  // Build the set of files to scan
  const filesToScan = new Map<string, FileEntry>()
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

  const scanCodeIndex = codeIndex

  // Pre-compute extension-based data structures for performance
  const blockCommentCache = new Map<string, Set<number> | undefined>()
  const presentExtensions = new Set(
    Array.from(filesToScan.keys()).map(p => '.' + (p.split('.').pop() || '').toLowerCase())
  )
  const filesByExtension = new Map<string, Map<string, FileEntry>>()
  for (const [path, file] of filesToScan) {
    const ext = '.' + (path.split('.').pop() || '').toLowerCase()
    let group = filesByExtension.get(ext)
    if (!group) {
      group = new Map<string, FileEntry>()
      filesByExtension.set(ext, group)
    }
    group.set(path, file)
  }

  // 1. Regex-based rules (content-required)
  let rulesEvaluated = 0
  let suppressionCount = 0
  let ruleOverflow = new Map<string, number>()

  if (!metadataOnly) {
    const regexResult = runRegexRules({
      filesToScan, scanCodeIndex, isPartialScan,
      blockCommentCache, presentExtensions, filesByExtension,
    })
    for (const issue of regexResult.issues) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
    rulesEvaluated = regexResult.rulesEvaluated
    suppressionCount = regexResult.suppressionCount
    ruleOverflow = regexResult.ruleOverflow
  }

  // 2. AST-based analysis (content-required)
  if (!metadataOnly) {
    for (const issue of runAstAnalysis(filesToScan)) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }

    // 2b. Taint tracking
    for (const issue of runTaintAnalysis(filesToScan)) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }

    // 2c–2d. Deduplicate AST vs regex overlapping findings
    deduplicateIssues(issues, scanCodeIndex, ruleOverflow)
  }

  // 3. Composite file-level rules (content-required)
  if (!metadataOnly) {
    const compositeIssues = scanCompositeRules(codeIndex)
    rulesEvaluated += COMPOSITE_RULES.length
    for (const issue of compositeIssues) {
      if (isPartialScan && !filesToScan.has(issue.file)) continue
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
  }

  // 4. Structural rules (metadata-safe — large-file check works without content)
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

  // 5. Supply chain rules (content-required)
  if (!metadataOnly) {
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
  }

  // 6. Structural context cross-reference
  if (analysis) {
    for (const issue of issues) {
      const importers = analysis.graph.reverseEdges.get(issue.file)
      const importerCount = importers?.size ?? 0
      const isEntryPoint = analysis.topology.entryPoints.includes(issue.file)
      const isDead = !isEntryPoint && importerCount === 0

      if (isDead && issue.category !== 'security' && (issue.severity === 'warning' || issue.severity === 'critical')) {
        issue.severity = 'info'
      }
      if (isEntryPoint && issue.category === 'security') {
        issue.description += ' (entry point — publicly accessible)'
      }
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

  // Risk scoring
  for (const issue of issues) {
    issue.riskScore = scoreIssue(issue)
    issue.cvssVector = buildCvssVector(issue)
  }
  const projectRiskScore = scoreProject(issues)
  const riskDistribution = getRiskDistribution(issues)

  // Health grades
  const sloc = Array.from(filesToScan.values()).reduce((sum, f) => sum + f.lineCount, 0)
  const grades = computeHealthGrades(issues, sloc)

  const result: ScanResults = {
    issues,
    summary: computeScanSummary(issues),
    healthGrade: grades.healthGrade,
    healthScore: grades.healthScore,
    ruleOverflow,
    languagesDetected: detectLanguages(codeIndex),
    rulesEvaluated,
    scannedFiles: isPartialScan ? filesToScan.size : codeIndex.totalFiles,
    scannedAt: new Date(),
    securityGrade: grades.securityGrade,
    qualityGrade: grades.qualityGrade,
    issuesPerKloc: grades.issuesPerKloc,
    isPartialScan,
    unscannedFileCount: countUnscannedFiles(codeIndex),
    isMetadataOnly: metadataOnly,
    suppressionCount,
    projectRiskScore,
    riskDistribution,
  }

  // Cache full scan results for memoization (not cached for partial or metadata-only scans)
  if (!changedFiles && !metadataOnly) {
    lastScanRef = new WeakRef(codeIndex)
    lastScanAnalysis = analysis
    lastScanResult = result
  }

  return result
}

// ---------------------------------------------------------------------------
// Async scanner — yields to main thread between phases to avoid blocking UI
// ---------------------------------------------------------------------------

/** Yield to the main thread so the browser can process events / paint. */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Async version of `scanIssues` that yields to the main thread between each
 * scanning phase so the UI stays responsive on large codebases.
 *
 * Accepts an optional `isStale` callback checked after every yield. When
 * `isStale()` returns `true` the scan aborts early and returns `null`.
 *
 * Shares the same WeakRef memoization cache as the synchronous `scanIssues`.
 */
export async function scanIssuesAsync(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  options?: {
    changedFiles?: string[]
    isStale?: () => boolean
    metadataOnly?: boolean
  },
): Promise<ScanResults | null> {
  const changedFiles = options?.changedFiles
  const isStale = options?.isStale
  const metadataOnly = options?.metadataOnly ?? false

  // Return cached result if the same codeIndex instance + analysis is requested.
  if (!changedFiles && !metadataOnly && lastScanRef && lastScanResult) {
    const cachedRef = lastScanRef.deref()
    if (cachedRef === codeIndex && lastScanAnalysis === analysis) {
      return lastScanResult
    }
  }

  // Dedup: if a full scan is already in-flight for the same codeIndex, reuse it.
  if (!changedFiles && pendingScanIndex?.deref() === codeIndex && pendingScan) {
    return pendingScan
  }

  const scanPromise = scanIssuesAsyncImpl(codeIndex, analysis, options)

  if (!changedFiles) {
    pendingScan = scanPromise
    pendingScanIndex = new WeakRef(codeIndex)
  }

  return scanPromise.finally(() => {
    pendingScan = null
    pendingScanIndex = null
  })
}

async function scanIssuesAsyncImpl(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  options?: {
    changedFiles?: string[]
    isStale?: () => boolean
    metadataOnly?: boolean
  },
): Promise<ScanResults | null> {
  const changedFiles = options?.changedFiles
  const isStale = options?.isStale
  const metadataOnly = options?.metadataOnly ?? false

  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()

  const isPartialScan = changedFiles !== undefined && changedFiles.length > 0

  // Build the set of files to scan
  const filesToScan = new Map<string, FileEntry>()
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

  const scanCodeIndex = codeIndex

  // Pre-compute extension-based data structures
  const blockCommentCache = new Map<string, Set<number> | undefined>()
  const presentExtensions = new Set(
    Array.from(filesToScan.keys()).map(p => '.' + (p.split('.').pop() || '').toLowerCase())
  )
  const filesByExtension = new Map<string, Map<string, FileEntry>>()
  for (const [path, file] of filesToScan) {
    const ext = '.' + (path.split('.').pop() || '').toLowerCase()
    let group = filesByExtension.get(ext)
    if (!group) {
      group = new Map<string, FileEntry>()
      filesByExtension.set(ext, group)
    }
    group.set(path, file)
  }

  // --- Phase 1: Regex-based rules (content-required) ---
  let rulesEvaluated = 0
  let suppressionCount = 0
  let ruleOverflow = new Map<string, number>()

  if (!metadataOnly) {
    const regexResult = runRegexRules({
      filesToScan, scanCodeIndex, isPartialScan,
      blockCommentCache, presentExtensions, filesByExtension,
    })
    for (const issue of regexResult.issues) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
    rulesEvaluated = regexResult.rulesEvaluated
    suppressionCount = regexResult.suppressionCount
    ruleOverflow = regexResult.ruleOverflow
  }

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 2: AST analysis + taint tracking (content-required) ---
  if (!metadataOnly) {
    for (const issue of runAstAnalysis(filesToScan)) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
    for (const issue of runTaintAnalysis(filesToScan)) {
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
    deduplicateIssues(issues, scanCodeIndex, ruleOverflow)
  }

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 3: Composite rules (content-required) ---
  if (!metadataOnly) {
    const compositeIssues = scanCompositeRules(codeIndex)
    rulesEvaluated += COMPOSITE_RULES.length
    for (const issue of compositeIssues) {
      if (isPartialScan && !filesToScan.has(issue.file)) continue
      if (!seenIds.has(issue.id)) {
        seenIds.add(issue.id)
        issues.push(issue)
      }
    }
  }

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 4: Structural rules (metadata-safe) ---
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

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 5: Supply chain rules (content-required) ---
  if (!metadataOnly) {
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
  }

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 5b: Tree-sitter multi-language analysis (content-required, async) ---
  if (!metadataOnly) {
    try {
      const treeSitterIssues = await scanWithTreeSitter(filesToScan)
      for (const issue of treeSitterIssues) {
        if (isPartialScan && !filesToScan.has(issue.file)) continue
        if (!seenIds.has(issue.id)) {
          seenIds.add(issue.id)
          issues.push(issue)
        }
      }
    } catch (err) {
      console.warn('[scanner] Tree-sitter analysis failed:', err)
    }
  }

  await yieldToMain()
  if (isStale?.()) return null

  // --- Phase 6: Context cross-reference + sorting + risk scoring ---
  if (analysis) {
    for (const issue of issues) {
      const importers = analysis.graph.reverseEdges.get(issue.file)
      const importerCount = importers?.size ?? 0
      const isEntryPoint = analysis.topology.entryPoints.includes(issue.file)
      const isDead = !isEntryPoint && importerCount === 0

      if (isDead && issue.category !== 'security' && (issue.severity === 'warning' || issue.severity === 'critical')) {
        issue.severity = 'info'
      }
      if (isEntryPoint && issue.category === 'security') {
        issue.description += ' (entry point — publicly accessible)'
      }
      if (importerCount >= 10) {
        issue.description += ` (high fan-in: ${importerCount} importers — changes affect many consumers)`
      }
    }
  }

  const severityOrder: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  issues.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity]
    if (sev !== 0) return sev
    return a.file.localeCompare(b.file)
  })

  for (const issue of issues) {
    issue.riskScore = scoreIssue(issue)
    issue.cvssVector = buildCvssVector(issue)
  }
  const projectRiskScore = scoreProject(issues)
  const riskDistribution = getRiskDistribution(issues)

  const sloc = Array.from(filesToScan.values()).reduce((sum, f) => sum + f.lineCount, 0)
  const grades = computeHealthGrades(issues, sloc)

  const result: ScanResults = {
    issues,
    summary: computeScanSummary(issues),
    healthGrade: grades.healthGrade,
    healthScore: grades.healthScore,
    ruleOverflow,
    languagesDetected: detectLanguages(codeIndex),
    rulesEvaluated,
    scannedFiles: isPartialScan ? filesToScan.size : codeIndex.totalFiles,
    scannedAt: new Date(),
    securityGrade: grades.securityGrade,
    qualityGrade: grades.qualityGrade,
    issuesPerKloc: grades.issuesPerKloc,
    isPartialScan,
    unscannedFileCount: countUnscannedFiles(codeIndex),
    isMetadataOnly: metadataOnly,
    suppressionCount,
    projectRiskScore,
    riskDistribution,
  }

  // Cache full scan results for memoization (not cached for partial or metadata-only scans)
  if (!changedFiles && !metadataOnly) {
    lastScanRef = new WeakRef(codeIndex)
    lastScanAnalysis = analysis
    lastScanResult = result
  }

  return result
}

// ---------------------------------------------------------------------------
// On-demand single-file scanning
// ---------------------------------------------------------------------------

/**
 * Scan a single file against all rules. Used when lazy-loaded content
 * becomes available for a file that was previously metadata-only.
 * Does NOT use scan memoization (partial scans bypass the cache).
 */
export function scanOnDemand(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  filePath: string,
): ScanResults {
  return scanIssues(codeIndex, analysis, { changedFiles: [filePath] })
}

// ---------------------------------------------------------------------------
// Merge scan results
// ---------------------------------------------------------------------------

/**
 * Merge two ScanResults (e.g. metadata-only base + on-demand content scan).
 * Deduplicates issues by id. Recomputes summary and health grades.
 */
export function mergeScanResults(
  base: ScanResults,
  addition: ScanResults,
): ScanResults {
  const seenIds = new Set<string>()
  const mergedIssues: CodeIssue[] = []

  for (const issue of base.issues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      mergedIssues.push(issue)
    }
  }
  for (const issue of addition.issues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id)
      mergedIssues.push(issue)
    }
  }

  // Sort by severity then file
  const sevOrder: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  mergedIssues.sort((a, b) => {
    const sev = sevOrder[a.severity] - sevOrder[b.severity]
    return sev !== 0 ? sev : a.file.localeCompare(b.file)
  })

  // Merge rule overflow maps
  const mergedOverflow = new Map(base.ruleOverflow)
  for (const [ruleId, count] of addition.ruleOverflow) {
    mergedOverflow.set(ruleId, (mergedOverflow.get(ruleId) ?? 0) + count)
  }

  // Merge languages
  const mergedLangs = [...new Set([...base.languagesDetected, ...addition.languagesDetected])]

  // Compute unscanned file count: base count minus newly scanned files
  const additionScannedFiles = new Set(addition.issues.map(i => i.file))
  const unscannedFileCount = Math.max(
    0,
    (base.unscannedFileCount ?? 0) - (addition.isPartialScan ? additionScannedFiles.size : addition.scannedFiles),
  )

  // Recompute summary
  const summary = computeScanSummary(mergedIssues)

  // Estimate SLOC for health grade computation
  const totalScanned = base.scannedFiles + (addition.isPartialScan ? additionScannedFiles.size : addition.scannedFiles)
  const estimatedSloc = base.issuesPerKloc > 0
    ? Math.round((base.issues.length / base.issuesPerKloc) * 1000)
    : totalScanned * 100
  const grades = computeHealthGrades(mergedIssues, estimatedSloc)

  // Re-score risk for newly added issues
  for (const issue of mergedIssues) {
    if (issue.riskScore == null) {
      issue.riskScore = scoreIssue(issue)
      issue.cvssVector = buildCvssVector(issue)
    }
  }
  const projectRiskScore = scoreProject(mergedIssues)
  const riskDistribution = getRiskDistribution(mergedIssues)

  return {
    issues: mergedIssues,
    summary,
    healthGrade: grades.healthGrade,
    healthScore: grades.healthScore,
    ruleOverflow: mergedOverflow,
    languagesDetected: mergedLangs,
    rulesEvaluated: base.rulesEvaluated + addition.rulesEvaluated,
    scannedFiles: totalScanned,
    scannedAt: new Date(),
    securityGrade: grades.securityGrade,
    qualityGrade: grades.qualityGrade,
    issuesPerKloc: grades.issuesPerKloc,
    isPartialScan: false,
    unscannedFileCount,
    isMetadataOnly: false,
    suppressionCount: base.suppressionCount + addition.suppressionCount,
    projectRiskScore,
    riskDistribution,
  }
}
