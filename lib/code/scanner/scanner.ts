// Main scanner — orchestrates all rule scanning, computes health score,
// and produces the final ScanResults.
//
// scanIssuesAsync is the only scan orchestrator and memoizes successful
// complete scans.

import type { CodeIndex, IndexedFile } from '../code-index'
import { buildSearchRegex, getFileLines, recordResolvedFileLineCount, resolveFileContentBatches } from '../code-index'
import type { FullAnalysis } from '../import-parser'
import type {
  ScanRule,
  CodeIssue,
  IssueSeverity,
  HealthGrade,
  ScanResults,
  ScanDiagnostics,
  ScanEngine,
} from './types'
import { SKIP_VENDORED, SCANNER_EXCLUDE_PATTERNS, detectLanguages, isExemptFromRuleCap } from './constants'
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
import { isTaintEligible, trackTaint, taintFlowsToIssues } from './taint-tracker'
import { scoreIssue, scoreProject, getRiskDistribution, buildCvssVector } from './risk-scorer'
import { scanWithTreeSitter } from './tree-sitter-scanner'

const MAX_PER_RULE = 15

/** Files whose content is resolved and scanned per batch. */
const DEFAULT_SCAN_BATCH_SIZE = 50

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
const SSRF_FILE_VALIDATION = /\b(?:ALLOWED_(?:HOSTS|DOMAINS)|allowedOrigins|allowlist|whitelist|isValidUrl|validateUrl)\b/i

// Credential assignments that resolve their value at runtime are not
// hardcoded credentials. Keep this separate from rule-level exclusions so
// only the credential rules receive this semantic suppression.
const RUNTIME_CREDENTIAL_REFERENCE = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$env:[A-Za-z_][A-Za-z0-9_]*|\$\{env:[A-Za-z_][A-Za-z0-9_]*\}|\$\{[A-Za-z_][A-Za-z0-9_]*(?::?\?[^}]*)\}|\$\{\{\s*(?:secrets|env|vars)\.[A-Za-z_][A-Za-z0-9_]*\s*\}\})$/i
const BATCH_CREDENTIAL_REFERENCE = /^%[A-Za-z_][A-Za-z0-9_]*%$/
const CREDENTIAL_ASSIGNMENT = /[:=]\s*(["'])([^"']*)\1/
const SINGLE_QUOTE_LITERAL_FILE = /(?:^|[/\\])(?:Dockerfile|Containerfile)(?:\.[^/\\]+)?$|\.(?:sh|bash|zsh|ksh|fish|ps1|psm1|psd1|command)$/i
const POWERSHELL_SCRIPT_FILE = /\.(?:ps1|psm1|psd1)$/i
const BATCH_SCRIPT_FILE = /\.(?:bat|cmd)$/i

function isRuntimeCredentialReference(matchedText: string, ruleId: string, path: string): boolean {
  if (ruleId !== 'hardcoded-secret' && ruleId !== 'hardcoded-password') return false

  const assignment = matchedText.match(CREDENTIAL_ASSIGNMENT)
  if (!assignment) return false

  if (assignment[1] === "'" && SINGLE_QUOTE_LITERAL_FILE.test(path)) return false
  const value = assignment[2]?.trim()
  if (!value) return false
  if (BATCH_CREDENTIAL_REFERENCE.test(value)) return BATCH_SCRIPT_FILE.test(path)
  return RUNTIME_CREDENTIAL_REFERENCE.test(value)
}

// Credential rules test their excludePattern against the asserted key path,
// the value, and the names of the containers enclosing it in the same
// statement (`labels = {`, `i18n.add(`, `LABELS = Object.freeze({`), so a
// comment or sibling property on the same line cannot hide a real credential.
const CREDENTIAL_RULE_IDS = new Set(['hardcoded-secret', 'hardcoded-password'])
const KEY_PATH_CHAR = /[\w$.]/
const CONTAINER_NAME_SEPARATOR = /[\s=:]/
// Bounds the backward scan so long minified lines stay linear. A cut-short
// scan still checks the line's leading assignment target (`var labels = {`).
const CONTAINER_SCAN_CHARS = 2_000
const LEADING_ASSIGNMENT_TARGET = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?([\w$.]+)\s*(?::[^=]{0,200})?=(?![=>])/
// API keys and tokens never read as a sentence; a value of three or more
// short words is UI copy (`apiKey: "API key is required"`). Key material
// such as an inline PEM block keeps a long unbroken run.
const PROSE_VALUE = /\S\s+\S+\s+\S/
const KEY_MATERIAL_RUN = /\S{20}/

/** Last index of `char` in `line` before `before` and not below `floor`, or -1. */
function lastIndexAbove(line: string, char: string, before: number, floor: number, skipEscaped = false): number {
  for (let i = before - 1; i >= floor; i--) {
    if (line[i] === char && !(skipEscaped && line[i - 1] === '\\')) return i
  }
  return -1
}

/** Start of the key path ending at `end`, including bracketed segments such as `labels['en']`. */
function keyPathStart(line: string, end: number, floor: number): number {
  let start = end
  while (start > floor) {
    const ch = line[start - 1]
    if (KEY_PATH_CHAR.test(ch)) {
      start--
    } else if (ch === ']') {
      const open = lastIndexAbove(line, '[', start - 1, floor)
      if (open < 0) break
      start = open
    } else {
      break
    }
  }
  return start
}

function isAssignmentOperator(line: string, index: number): boolean {
  return line[index + 1] !== '=' && line[index + 1] !== '>' && !/[=!<>]/.test(line[index - 1] ?? '')
}

function pushNameBefore(line: string, index: number, floor: number, names: string[]): void {
  let end = index
  while (end > floor && CONTAINER_NAME_SEPARATOR.test(line[end - 1])) end--
  const start = keyPathStart(line, end, floor)
  if (start < end) names.push(line.slice(start, end))
}

/**
 * Names of the unclosed objects, arrays and calls left of `index`, and the
 * targets assigned to them, innermost first. Stops at the statement boundary.
 */
function enclosingContainerNames(line: string, index: number): string[] {
  const names: string[] = []
  const floor = Math.max(0, index - CONTAINER_SCAN_CHARS)
  let depth = 0
  for (let i = index - 1; i >= floor; i--) {
    const ch = line[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = lastIndexAbove(line, ch, i, floor, true)
      if (i < 0) break
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth++
    } else if (ch === '{' || ch === '(' || ch === '[') {
      if (depth > 0) depth--
      else pushNameBefore(line, i, floor, names)
    } else if (depth === 0 && ch === ';') {
      return names
    } else if (depth === 0 && ch === '=' && isAssignmentOperator(line, i)) {
      pushNameBefore(line, i, floor, names)
    }
  }
  if (floor > 0) {
    const target = LEADING_ASSIGNMENT_TARGET.exec(line)?.[1]
    if (target) names.push(target)
  }
  return names
}

function isExcludedCredential(rule: ScanRule, lineContent: string, match: RegExpExecArray): boolean {
  const excludePattern = rule.excludePattern
  if (!excludePattern || !CREDENTIAL_RULE_IDS.has(rule.id)) return false
  if (rule.id === 'hardcoded-secret') {
    const value = match[0].match(CREDENTIAL_ASSIGNMENT)?.[2] ?? ''
    if (PROSE_VALUE.test(value) && !KEY_MATERIAL_RUN.test(value)) return true
  }

  const start = keyPathStart(lineContent, match.index, Math.max(0, match.index - CONTAINER_SCAN_CHARS))
  if (excludePattern.test(lineContent.slice(start, match.index + match[0].length))) return true
  return enclosingContainerNames(lineContent, start).some(name => excludePattern.test(name))
}

// ---------------------------------------------------------------------------
// Scan memoization — scanIssuesAsync reuses a complete scan, or joins one in
// flight, for the same CodeIndex object, analysis and options. Worker requests
// deserialize a fresh CodeIndex, so only in-thread callers can hit it.
// ---------------------------------------------------------------------------

let lastScanRef: WeakRef<CodeIndex> | null = null
let lastScanAnalysis: FullAnalysis | null = null
let lastScanResult: ScanResults | null = null
let lastScanOptionsKey: string | null = null

// In-flight async scan dedup — prevents concurrent scans for the same index.
let pendingScan: Promise<ScanResults> | null = null
let pendingScanIndex: WeakRef<CodeIndex> | null = null
let pendingScanAnalysis: FullAnalysis | null = null
let pendingScanOptionsKey: string | null = null

/** Clear the scan cache, e.g. for testing. */
export function clearScanCache(): void {
  lastScanRef = null
  lastScanAnalysis = null
  lastScanResult = null
  lastScanOptionsKey = null
  pendingScan = null
  pendingScanIndex = null
  pendingScanAnalysis = null
  pendingScanOptionsKey = null
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

interface CompiledRuleIndex {
  /** Rules keyed by lowercased extension (e.g. ".ts") */
  rulesForExtension: Map<string, CompiledRule[]>
  /** Rules that apply to every file (no fileFilter) */
  universalRules: CompiledRule[]
  /** Total unique rules that were compiled */
  rulesEvaluated: number
}

/**
 * Compile all RULES into RegExp objects upfront, grouped by applicable
 * file extension.  Rules with no `fileFilter` go into `universalRules`.
 */
function buildCompiledRuleIndex(presentExtensions: Set<string>): CompiledRuleIndex {
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
      trusted: true,
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

function runRegexRules(
  ctx: ScanContext,
  sharedRuleCounts = new Map<string, number>(),
  sharedRuleOverflow = new Map<string, number>(),
  compiledRuleIndex?: CompiledRuleIndex,
  sharedRuleMatchIds = new Set<string>(),
): RegexRulesResult {
  const { filesToScan, isPartialScan, blockCommentCache, presentExtensions } = ctx
  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()
  let suppressionCount = 0
  const ruleOverflow = sharedRuleOverflow
  const ruleCounts = sharedRuleCounts

  // --- Phase 1: Single-pass over files --------------------------------

  const { rulesForExtension, universalRules, rulesEvaluated } =
    compiledRuleIndex ?? buildCompiledRuleIndex(presentExtensions)

  for (const [path, file] of filesToScan) {
    if (typeof file.content !== 'string') continue
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
        let ruleMatch = regex.exec(lineContent)
        while (
          ruleMatch
          && (isRuntimeCredentialReference(ruleMatch[0], rule.id, path) || isExcludedCredential(rule, lineContent, ruleMatch))
        ) {
          ruleMatch = regex.exec(lineContent)
        }
        if (!ruleMatch) continue

        // Per-rule line exclusion (credential rules were checked per match above)
        if (rule.excludePattern && !CREDENTIAL_RULE_IDS.has(rule.id) && rule.excludePattern.test(lineContent)) continue
        if (
          rule.id === 'nextjs-rsc-ssrf'
          && SSRF_FILE_VALIDATION.test(file.content)
        ) continue

        // --- Context-aware suppression ---
        const lineCtx = classifyLine(lineContent, path, blockCommentLines, i)

        if (
          lineCtx.isComment
          && !isSecurityCritical
          && rule.id !== 'todo-fixme'
          && rule.id !== 'eslint-disable'
        ) continue
        if ((lineCtx.isTestFile || lineCtx.isGeneratedFile || lineCtx.isExampleFile) && rule.category !== 'security') continue
        if (
          lineCtx.isTypeAnnotation
          && SECRET_RULE_IDS.test(rule.id)
          && !(POWERSHELL_SCRIPT_FILE.test(path) && CREDENTIAL_ASSIGNMENT.test(ruleMatch[0]))
        ) continue
        if (lineCtx.isStringLiteral && STRING_LITERAL_SUPPRESSED_IDS.has(rule.id)) continue

        // --- Entropy check for secret rules ---
        if (ENTROPY_CHECKED_RULE_IDS.test(rule.id)) {
          const valueSource = rule.id === 'hardcoded-secret' ? ruleMatch[0] : lineContent
          const valueMatch = valueSource.match(EXTRACT_SECRET_VALUE)
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
        if (rule.id === 'eval-usage') {
          if (sharedRuleMatchIds.has(issueId)) continue
          sharedRuleMatchIds.add(issueId)
        }

        // --- Per-rule cap (security and critical findings are never dropped) ---
        const ruleCount = (ruleCounts.get(rule.id) || 0) + 1
        ruleCounts.set(rule.id, ruleCount)
        if (ruleCount > MAX_PER_RULE && !isExemptFromRuleCap(rule)) {
          ruleOverflow.set(rule.id, (ruleOverflow.get(rule.id) || 0) + 1)
          continue
        }

        // --- Compute column from the accepted match position ---
        const column = ruleMatch.index

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
        if (
          lineCtx.isComment
          && !isSecurityCritical
          && rule.id !== 'todo-fixme'
          && rule.id !== 'eslint-disable'
        ) continue
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
        if (rule.id === 'eval-usage') {
          if (sharedRuleMatchIds.has(issueId)) continue
          sharedRuleMatchIds.add(issueId)
        }
        const ruleCount = (ruleCounts.get(rule.id) || 0) + 1
        ruleCounts.set(rule.id, ruleCount)
        if (ruleCount > MAX_PER_RULE && !isExemptFromRuleCap(rule)) {
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

interface ParsedEngineResult {
  issues: CodeIssue[]
  omittedPaths: string[]
}

function runAstAnalysis(
  filesToScan: Map<string, IndexedFile>,
): ParsedEngineResult {
  const issues: CodeIssue[] = []
  const omittedPaths: string[] = []
  for (const [path, file] of filesToScan) {
    if (SKIP_VENDORED.test(path)) continue
    const lang = file.language ?? ''
    if (!AST_LANGUAGES.has(lang)) continue
    try {
      const ast = getAST(file)
      if (!ast) {
        if (file.content) omittedPaths.push(path)
        continue
      }
      const astIssues = analyzeAST(ast, file)
      issues.push(...astIssues)
    } catch (err) {
      console.warn(`[scanner] AST analysis failed for ${path}:`, err)
      omittedPaths.push(path)
    }
  }
  return { issues, omittedPaths }
}

// ---------------------------------------------------------------------------
// D5: Taint analysis helper
// ---------------------------------------------------------------------------

function runTaintAnalysis(
  filesToScan: Map<string, IndexedFile>,
): ParsedEngineResult {
  const issues: CodeIssue[] = []
  const omittedPaths: string[] = []
  for (const [path, file] of filesToScan) {
    if (SKIP_VENDORED.test(path)) continue
    const lang = file.language ?? ''
    if (!AST_LANGUAGES.has(lang)) continue
    try {
      if (!isTaintEligible(file)) {
        omittedPaths.push(path)
        continue
      }
      const ast = getAST(file)
      if (!ast) {
        if (file.content) omittedPaths.push(path)
        continue
      }
      const taintFlows = trackTaint(ast, file)
      issues.push(...taintFlowsToIssues(taintFlows))
    } catch (err) {
      console.warn(`[scanner] Taint analysis failed for ${path}:`, err)
      omittedPaths.push(path)
    }
  }
  return { issues, omittedPaths }
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

interface DeferredAstEvalState {
  issueIds: Set<string>
  count: number
}

function deduplicateIssues(
  issues: CodeIssue[],
  scanCodeIndex: CodeIndex,
  ruleOverflow: Map<string, number>,
  ruleCounts?: Map<string, number>,
  ruleMatchIds?: Set<string>,
  deferredAstEval?: DeferredAstEvalState,
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
  const existingEvalCount = ruleCounts?.get('eval-usage')
    ?? issues.filter(i => i.ruleId === 'eval-usage').length
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
    if (ruleMatchIds?.has(issue.id)) {
      issues.splice(i, 1)
      continue
    }
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
    const capExempt = isExemptFromRuleCap(issue)
    if (deferredAstEval && !capExempt) {
      deferredAstEval.count++
      deferredAstEval.issueIds.add(issue.id)
      continue
    }
    // Apply MAX_PER_RULE cap (security and critical findings are never dropped)
    normalizedEvalCount++
    ruleCounts?.set('eval-usage', normalizedEvalCount)
    ruleMatchIds?.add(issue.id)
    if (normalizedEvalCount > MAX_PER_RULE && !capExempt) {
      ruleOverflow.set('eval-usage', (ruleOverflow.get('eval-usage') || 0) + 1)
      issues.splice(i, 1)
    }
  }

  // Batched scans cannot cap AST fallbacks until every regex batch has run.
  // Retain only the latest candidates that a single reverse pass over the
  // whole index would select; the total count preserves truthful overflow
  // reporting.
  if (deferredAstEval && deferredAstEval.issueIds.size > MAX_PER_RULE) {
    let retained = 0
    for (let index = issues.length - 1; index >= 0; index--) {
      const issue = issues[index]
      if (!deferredAstEval.issueIds.has(issue.id)) continue
      retained++
      if (retained <= MAX_PER_RULE) continue
      deferredAstEval.issueIds.delete(issue.id)
      issues.splice(index, 1)
    }
  }
}

// ---------------------------------------------------------------------------
// Scan options
// ---------------------------------------------------------------------------

/** Options for scanIssuesAsync. */
export interface ScanOptions {
  /** When true, only metadata-only rules run (no content parsing). */
  metadataOnly?: boolean
  /** Differential scan: only check these files. */
  changedFiles?: string[]
}

export interface AsyncScanOptions extends ScanOptions {
  signal?: AbortSignal
  failureMode?: 'best-effort' | 'strict'
  /**
   * @internal Files per content batch (default 50, capped at 100). Results do
   * not depend on it; tests vary it to prove that. Not sent to the worker.
   */
  batchSize?: number
}

interface ScanAccumulator {
  issues: CodeIssue[]
  seenIds: Set<string>
  ruleCounts: Map<string, number>
  ruleMatchIds: Set<string>
  deferredAstEval: DeferredAstEvalState
  rulesEvaluated: number
  suppressionCount: number
  ruleOverflow: Map<string, number>
  diagnostics: ScanDiagnostics
  partialEnginePaths: Map<ScanEngine, Set<string>>
}

function createScanAccumulator(): ScanAccumulator {
  return {
    issues: [],
    seenIds: new Set(),
    ruleCounts: new Map(),
    ruleMatchIds: new Set(),
    deferredAstEval: { issueIds: new Set(), count: 0 },
    rulesEvaluated: 0,
    suppressionCount: 0,
    ruleOverflow: new Map(),
    diagnostics: { engines: {}, failures: [] },
    partialEnginePaths: new Map(),
  }
}

function finalizeDeferredAstEvalIssues(accumulator: ScanAccumulator): void {
  const { deferredAstEval, issues, ruleCounts, ruleOverflow } = accumulator
  if (deferredAstEval.count === 0) return

  const regexEvalCount = ruleCounts.get('eval-usage') ?? 0
  const astRetentionLimit = Math.max(0, MAX_PER_RULE - regexEvalCount)
  let retained = 0
  for (let index = issues.length - 1; index >= 0; index--) {
    const issue = issues[index]
    if (!deferredAstEval.issueIds.has(issue.id)) continue
    retained++
    if (retained <= astRetentionLimit) continue
    issues.splice(index, 1)
  }
  const retainedAstCount = Math.min(deferredAstEval.count, astRetentionLimit)
  const overflow = deferredAstEval.count - retainedAstCount
  if (overflow > 0) {
    ruleOverflow.set('eval-usage', (ruleOverflow.get('eval-usage') || 0) + overflow)
  }
  ruleCounts.set('eval-usage', regexEvalCount + deferredAstEval.count)
  deferredAstEval.issueIds.clear()
  deferredAstEval.count = 0
}

function addIssues(accumulator: ScanAccumulator, issues: CodeIssue[]): void {
  for (const issue of issues) {
    if (!accumulator.seenIds.has(issue.id)) {
      accumulator.seenIds.add(issue.id)
      accumulator.issues.push(issue)
    }
  }
}

function completeEngine(
  accumulator: ScanAccumulator,
  engine: ScanEngine,
  status: 'completed' | 'not-applicable' | 'skipped' = 'completed',
): void {
  accumulator.diagnostics.engines[engine] = status
}

function recordPartialEngine(
  accumulator: ScanAccumulator,
  engine: 'ast' | 'taint',
  paths: readonly string[],
): void {
  if (paths.length === 0 || accumulator.diagnostics.engines[engine] === 'failed') return
  let omitted = accumulator.partialEnginePaths.get(engine)
  if (!omitted) {
    omitted = new Set<string>()
    accumulator.partialEnginePaths.set(engine, omitted)
  }
  for (const path of paths) omitted.add(path)
  accumulator.diagnostics.engines[engine] = 'partial'

  const label = engine === 'ast' ? 'AST' : 'Taint'
  const sortedPaths = [...omitted].sort()
  const message = `${label} parsing unavailable for ${sortedPaths.length} file${sortedPaths.length === 1 ? '' : 's'}.`
  const existing = accumulator.diagnostics.failures.find(
    failure => failure.engine === engine && failure.message.startsWith(`${label} parsing unavailable for `),
  )
  if (existing) {
    existing.message = message
    existing.paths = sortedPaths
  } else {
    accumulator.diagnostics.failures.push({ engine, message, paths: sortedPaths })
  }
}

async function runAsyncEngine(
  accumulator: ScanAccumulator,
  engine: ScanEngine,
  failureMode: 'best-effort' | 'strict',
  run: () => void | Promise<void>,
): Promise<void> {
  if (accumulator.diagnostics.engines[engine] === 'failed') return
  try {
    await run()
    if (accumulator.diagnostics.engines[engine] !== 'partial') {
      completeEngine(accumulator, engine)
    }
  } catch (error) {
    accumulator.diagnostics.engines[engine] = 'failed'
    accumulator.diagnostics.failures.push({
      engine,
      message: error instanceof Error ? error.message : String(error),
    })
    if (failureMode === 'strict') throw error
  }
}

function throwIfScanAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The scan was aborted', 'AbortError')
  }
}

function scanOptionsKey(options: AsyncScanOptions): string {
  return JSON.stringify({
    changedFiles: options.changedFiles ?? null,
    metadataOnly: options.metadataOnly ?? false,
    failureMode: options.failureMode ?? 'best-effort',
    batchSize: options.batchSize ?? DEFAULT_SCAN_BATCH_SIZE,
  })
}

function isCompleteFullScan(options: AsyncScanOptions): boolean {
  return (options.changedFiles?.length ?? 0) === 0 && !options.metadataOnly && !options.signal
}

/** Count files in the index whose source is absent. Genuine empty files are loaded. */
function countUnscannedFiles(codeIndex: CodeIndex): number {
  let count = 0
  for (const file of codeIndex.files.values()) {
    if (typeof file.content !== 'string') count++
  }
  return count
}

function finalizeScan(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  filesToScan: Map<string, FileEntry>,
  isPartialScan: boolean,
  metadataOnly: boolean,
  accumulator: ScanAccumulator,
  unscannedFileCountOverride?: number,
): ScanResults {
  const { issues } = accumulator

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
    const severity = severityOrder[a.severity] - severityOrder[b.severity]
    return severity !== 0 ? severity : a.file.localeCompare(b.file)
  })

  for (const issue of issues) {
    issue.riskScore = scoreIssue(issue)
    issue.cvssVector = buildCvssVector(issue)
  }
  const projectRiskScore = scoreProject(issues)
  const riskDistribution = getRiskDistribution(issues)
  const sloc = Array.from(filesToScan.values()).reduce((sum, file) => sum + file.lineCount, 0)
  const grades = computeHealthGrades(issues, sloc)

  return {
    repositoryCoverage: codeIndex.coverage,
    issues,
    summary: computeScanSummary(issues),
    healthGrade: grades.healthGrade,
    healthScore: grades.healthScore,
    ruleOverflow: accumulator.ruleOverflow,
    languagesDetected: detectLanguages(codeIndex),
    rulesEvaluated: accumulator.rulesEvaluated,
    scannedFiles: filesToScan.size,
    scannedAt: new Date(),
    securityGrade: grades.securityGrade,
    qualityGrade: grades.qualityGrade,
    issuesPerKloc: grades.issuesPerKloc,
    isPartialScan,
    unscannedFileCount: unscannedFileCountOverride ?? countUnscannedFiles(codeIndex),
    isMetadataOnly: metadataOnly,
    suppressionCount: accumulator.suppressionCount,
    projectRiskScore,
    riskDistribution,
    diagnostics: accumulator.diagnostics,
  }
}

// ---------------------------------------------------------------------------
// Main scan orchestrator — yields to the main thread between content batches
// and phases to avoid blocking the UI
// ---------------------------------------------------------------------------

/** Yield to the main thread so the browser can process events / paint. */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Scan a CodeIndex for security and quality issues. Content is resolved and
 * scanned in bounded batches, yielding to the main thread between batches and
 * phases so the UI stays responsive on large codebases.
 *
 * This is the only scanner orchestrator; the scanner worker and every in-thread
 * caller use it. Cancellation rejects with AbortError; best-effort engine
 * failures are returned in diagnostics and strict failures throw.
 */
export async function scanIssuesAsync(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  options: AsyncScanOptions = {},
): Promise<ScanResults> {
  throwIfScanAborted(options.signal)
  const optionsKey = scanOptionsKey(options)
  const cacheEligible = isCompleteFullScan(options)

  if (cacheEligible && lastScanRef && lastScanResult) {
    const cachedRef = lastScanRef.deref()
    if (
      cachedRef === codeIndex
      && lastScanAnalysis === analysis
      && lastScanOptionsKey === optionsKey
    ) {
      lastScanResult.repositoryCoverage = codeIndex.coverage
      return lastScanResult
    }
  }

  if (
    cacheEligible
    && pendingScanIndex?.deref() === codeIndex
    && pendingScanAnalysis === analysis
    && pendingScanOptionsKey === optionsKey
    && pendingScan
  ) {
    return pendingScan
  }

  const scanPromise = scanIssuesAsyncImpl(codeIndex, analysis, options)

  if (cacheEligible) {
    pendingScan = scanPromise
    pendingScanIndex = new WeakRef(codeIndex)
    pendingScanAnalysis = analysis
    pendingScanOptionsKey = optionsKey
  }

  return scanPromise.finally(() => {
    if (pendingScan === scanPromise) {
      pendingScan = null
      pendingScanIndex = null
      pendingScanAnalysis = null
      pendingScanOptionsKey = null
    }
  })
}

async function scanIssuesAsyncImpl(
  codeIndex: CodeIndex,
  analysis: FullAnalysis | null,
  options: AsyncScanOptions,
): Promise<ScanResults> {
  const { changedFiles, signal } = options
  const metadataOnly = options.metadataOnly ?? false
  const failureMode = options.failureMode ?? 'best-effort'
  const originalCodeIndex = codeIndex
  const missingContentPaths: string[] = []

  throwIfScanAborted(signal)

  const accumulator = createScanAccumulator()

  const hasChangedFiles = changedFiles !== undefined && changedFiles.length > 0

  // Build the set of files to scan, excluding test/fixture paths that
  // produce false positives (test corpus intentionally contains vulnerable patterns).
  const filesToScan = new Map<string, FileEntry>()
  if (hasChangedFiles) {
    for (const changed of changedFiles!) {
      if (SCANNER_EXCLUDE_PATTERNS.test(changed)) continue
      const file = codeIndex.files.get(changed)
      if (file) filesToScan.set(changed, file)
    }
  } else {
    for (const [path, file] of codeIndex.files) {
      if (SCANNER_EXCLUDE_PATTERNS.test(path)) continue
      filesToScan.set(path, file)
    }
  }

  // Pre-compute extension-based data structures
  const presentExtensions = new Set(
    Array.from(filesToScan.keys()).map(p => '.' + (p.split('.').pop() || '').toLowerCase())
  )
  if (metadataOnly) {
    completeEngine(accumulator, 'regex', 'not-applicable')
    completeEngine(accumulator, 'ast', 'not-applicable')
    completeEngine(accumulator, 'taint', 'not-applicable')
    completeEngine(accumulator, 'composite', 'not-applicable')
    completeEngine(accumulator, 'supply-chain', 'not-applicable')
    completeEngine(accumulator, 'tree-sitter', 'not-applicable')
  } else {
    accumulator.rulesEvaluated += COMPOSITE_RULES.length
    const supplyChainRuleIds = new Set<string>()
    let sawContentBatch = false
    let regexRulesRecorded = false
    const compiledRuleIndex = buildCompiledRuleIndex(presentExtensions)
    const pathsToResolve = Array.from(filesToScan.keys())

    for await (const batch of resolveFileContentBatches(
      codeIndex,
      pathsToResolve,
      { batchSize: options.batchSize ?? DEFAULT_SCAN_BATCH_SIZE, signal },
    )) {
      throwIfScanAborted(signal)
      missingContentPaths.push(...batch.missingPaths)

      const batchFilesToScan = new Map<string, FileEntry>()
      let batchTotalLines = 0
      for (const path of batch.paths) {
        const source = batch.contents.get(path)
        if (source === undefined) continue
        const originalFile = codeIndex.files.get(path)
        if (!originalFile) continue
        recordResolvedFileLineCount(codeIndex, path, source)
        const file = { ...originalFile, content: source }
        if (filesToScan.has(path)) {
          batchFilesToScan.set(path, file)
          batchTotalLines += file.lineCount
        }
      }

      if (batchFilesToScan.size === 0) {
        continue
      }
      sawContentBatch = true

      const batchCodeIndex: CodeIndex = {
        ...codeIndex,
        files: batchFilesToScan,
        totalFiles: batchFilesToScan.size,
        totalLines: batchTotalLines,
      }
      const filesByExtension = new Map<string, Map<string, FileEntry>>()
      const blockCommentCache = new Map<string, Set<number> | undefined>()
      for (const [path, file] of batchFilesToScan) {
        const ext = '.' + (path.split('.').pop() || '').toLowerCase()
        let group = filesByExtension.get(ext)
        if (!group) {
          group = new Map<string, FileEntry>()
          filesByExtension.set(ext, group)
        }
        group.set(path, file)
      }
      const scanContext: ScanContext = {
        filesToScan: batchFilesToScan,
        scanCodeIndex: batchCodeIndex,
        isPartialScan: hasChangedFiles,
        blockCommentCache,
        presentExtensions,
        filesByExtension,
      }

      // Match identities are needed only to deduplicate regex and AST findings
      // within this bounded content batch. Counts remain global across batches.
      accumulator.ruleMatchIds.clear()
      await runAsyncEngine(accumulator, 'regex', failureMode, () => {
        const regexResult = runRegexRules(
          scanContext,
          accumulator.ruleCounts,
          accumulator.ruleOverflow,
          compiledRuleIndex,
          accumulator.ruleMatchIds,
        )
        addIssues(accumulator, regexResult.issues)
        if (!regexRulesRecorded) {
          accumulator.rulesEvaluated += regexResult.rulesEvaluated
          regexRulesRecorded = true
        }
        accumulator.suppressionCount += regexResult.suppressionCount
      })
      await runAsyncEngine(accumulator, 'ast', failureMode, () => {
        const astResult = runAstAnalysis(batchFilesToScan)
        addIssues(accumulator, astResult.issues)
        recordPartialEngine(accumulator, 'ast', astResult.omittedPaths)
      })
      await runAsyncEngine(accumulator, 'taint', failureMode, () => {
        const taintResult = runTaintAnalysis(batchFilesToScan)
        addIssues(accumulator, taintResult.issues)
        recordPartialEngine(accumulator, 'taint', taintResult.omittedPaths)
        deduplicateIssues(
          accumulator.issues,
          batchCodeIndex,
          accumulator.ruleOverflow,
          accumulator.ruleCounts,
          accumulator.ruleMatchIds,
          accumulator.deferredAstEval,
        )
        accumulator.ruleMatchIds.clear()
      })
      await runAsyncEngine(accumulator, 'composite', failureMode, () => {
        addIssues(
          accumulator,
          scanCompositeRules(batchCodeIndex).filter(issue => filesToScan.has(issue.file)),
        )
      })
      await runAsyncEngine(accumulator, 'supply-chain', failureMode, () => {
        let supplyChainFiles: Map<string, FileEntry> | null = null
        for (const path of batchFilesToScan.keys()) {
          if ((path.split('/').pop() || '') !== 'package.json') continue
          const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
          for (const lockfileName of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
            const lockfilePath = `${directory}${lockfileName}`
            if (batchFilesToScan.has(lockfilePath)) continue
            const lockfile = codeIndex.files.get(lockfilePath)
            if (!lockfile) continue
            supplyChainFiles ??= new Map(batchFilesToScan)
            supplyChainFiles.set(lockfilePath, {
              path: lockfile.path,
              name: lockfile.name,
              language: lockfile.language,
              lineCount: lockfile.lineCount,
            })
          }
        }
        const supplyChainCodeIndex = supplyChainFiles
          ? {
              ...batchCodeIndex,
              files: supplyChainFiles,
              totalFiles: supplyChainFiles.size,
              totalLines: Array.from(supplyChainFiles.values())
                .reduce((sum, file) => sum + file.lineCount, 0),
            }
          : batchCodeIndex
        const supplyChainIssues = scanSupplyChain(supplyChainCodeIndex)
          .filter(issue => filesToScan.has(issue.file))
        for (const issue of supplyChainIssues) supplyChainRuleIds.add(issue.ruleId)
        addIssues(accumulator, supplyChainIssues)
      })
      await runAsyncEngine(accumulator, 'tree-sitter', failureMode, async () => {
        const treeSitterResult = await scanWithTreeSitter(batchFilesToScan)
        addIssues(accumulator, treeSitterResult.issues.filter(issue => filesToScan.has(issue.file)))
        // Tree-sitter rule ids are `ts-` prefixed, so these counts stay apart from regex rule counts
        for (const [ruleId, count] of treeSitterResult.ruleOverflow) {
          accumulator.ruleOverflow.set(ruleId, (accumulator.ruleOverflow.get(ruleId) || 0) + count)
        }
      })

      batchFilesToScan.clear()
      blockCommentCache.clear()
      await yieldToMain()
      throwIfScanAborted(signal)
    }

    accumulator.rulesEvaluated += supplyChainRuleIds.size
    finalizeDeferredAstEvalIssues(accumulator)
    if (!sawContentBatch) {
      for (const engine of ['regex', 'ast', 'taint', 'composite', 'supply-chain', 'tree-sitter'] as const) {
        completeEngine(accumulator, engine)
      }
    }
  }

  const finalIsPartialScan = hasChangedFiles || missingContentPaths.length > 0

  await yieldToMain()
  throwIfScanAborted(signal)

  // --- Structural rules (metadata-safe) ---
  await runAsyncEngine(accumulator, 'structural', failureMode, () => {
    const structuralIssues = scanStructuralIssues(codeIndex, analysis)
      .filter(issue => filesToScan.has(issue.file))
    accumulator.rulesEvaluated += new Set(structuralIssues.map(issue => issue.ruleId)).size
    addIssues(accumulator, structuralIssues)
  })

  if (!metadataOnly) {
    for (const path of missingContentPaths) filesToScan.delete(path)
  }

  await yieldToMain()
  throwIfScanAborted(signal)

  const result = finalizeScan(
    codeIndex,
    analysis,
    filesToScan,
    finalIsPartialScan,
    metadataOnly,
    accumulator,
    metadataOnly ? undefined : missingContentPaths.length,
  )

  if (isCompleteFullScan(options) && accumulator.diagnostics.failures.length === 0 && result.unscannedFileCount === 0) {
    lastScanRef = new WeakRef(originalCodeIndex)
    lastScanAnalysis = analysis
    lastScanOptionsKey = scanOptionsKey(options)
    lastScanResult = result
  }

  return result
}

// ---------------------------------------------------------------------------
// Merge scan results
// ---------------------------------------------------------------------------

/**
 * Merge two ScanResults (e.g. a metadata-only base plus an on-demand content
 * scan from scanIssuesAsync with `changedFiles`). Deduplicates issues by id.
 * Recomputes summary and health grades.
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
  const engines: ScanDiagnostics['engines'] = {}
  for (const engine of [
    'regex',
    'ast',
    'taint',
    'composite',
    'structural',
    'supply-chain',
    'tree-sitter',
  ] as const) {
    const statuses = [base.diagnostics.engines[engine], addition.diagnostics.engines[engine]]
    if (statuses.includes('failed')) engines[engine] = 'failed'
    else if (statuses.includes('partial')) engines[engine] = 'partial'
    else if (statuses.includes('completed')) engines[engine] = 'completed'
    else if (statuses.includes('skipped')) engines[engine] = 'skipped'
    else if (statuses.includes('not-applicable')) engines[engine] = 'not-applicable'
  }

  return {
    repositoryCoverage: addition.repositoryCoverage ?? base.repositoryCoverage,
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
    diagnostics: {
      engines,
      failures: [...base.diagnostics.failures, ...addition.diagnostics.failures],
    },
  }
}
