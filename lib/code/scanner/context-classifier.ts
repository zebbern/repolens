// Context classifier — classifies the context of a matched line to reduce
// false positives from comments, strings, type annotations, and test files.

export interface LineClassification {
  isComment: boolean
  isStringLiteral: boolean
  isTypeAnnotation: boolean
  isTestFile: boolean
  isGeneratedFile: boolean
  isExampleFile: boolean
}

// ---------------------------------------------------------------------------
// Test / Generated file patterns
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERN = /\.test\.|\.spec\.|__tests__[\/\\]|[\/\\]test[\/\\]|__mocks__[\/\\]|fixtures[\/\\]|_test\.go$|_test\.rs$/i
const GENERATED_FILE_PATTERN = /\.generated\.|\.g\.ts$|__generated__[/\\]|codegen[/\\]|\.d\.ts$|generated[/\\]/i
const EXAMPLE_FILE_PATTERN = /[/\\](?:examples?|docs?|documentation|samples?|demo|tutorials?|playground|fixtures?|mocks?|__mocks__|__fixtures__|stories|\.storybook)[/\\]|\.stories\./i

// ---------------------------------------------------------------------------
// Comment patterns
// ---------------------------------------------------------------------------

const SINGLE_LINE_COMMENT = /^\s*(?:\/\/|#|--)/

// Multi-line openers / closers
const PY_TRIPLE_DOUBLE = /"""/
const PY_TRIPLE_SINGLE = /'''/

// ---------------------------------------------------------------------------
// Type annotation patterns
// ---------------------------------------------------------------------------

const TYPE_ANNOTATION_PATTERN = /^\s*(?:type\s+\w|interface\s+\w)|:\s*[A-Z]\w+|(?:\bas\b\s+[A-Z]\w+)|<[A-Z]\w+>|@dataclass|class\s+\w+.*:|def\s+\w+\(.*:\s*(?:str|int|bool)|(?:String|int|boolean)\s+\w+\)|type\s+\w+\s+struct/

// ---------------------------------------------------------------------------
// String literal heuristic
// ---------------------------------------------------------------------------

const STRING_ASSIGNMENT = /=\s*(?:"[^"]*"|'[^']*'|`(?:(?!\$\{)[^`])*`)\s*[;,]?\s*$/
// ---------------------------------------------------------------------------
// Sanitizer patterns — known functions that sanitize/escape untrusted input
// ---------------------------------------------------------------------------

export const SANITIZER_PATTERNS: RegExp[] = [
  /DOMPurify/i,
  /\bsanitize\s*\(/i,
  /\bescape\s*\(/i,
  /\bencode\s*\(/i,
  /\bhtmlEncode\s*\(/i,
  /\bvalidator\./i,
  /\bxss\s*\(/i,
  /\bpurify\s*\(/i,
  /\bbleach\./i,
  /\bstrip_tags\s*\(/i,
  /\bhtml_escape\s*\(/i,
  /\bescapeHtml\s*\(/i,
  /\bhtml\.escape\s*\(/i,
  /\bcgi\.escape/i,
  /CGI\.escapeHTML/,
]

// ---------------------------------------------------------------------------
// Inline suppression comment patterns
// ---------------------------------------------------------------------------

/**
 * Regex that matches inline suppression comments.
 *
 * Supported formats:
 *   // repolens-ignore                     → suppress all rules on this line
 *   // repolens-ignore-next-line           → suppress all rules on the next line
 *   // repolens-disable rule-id            → suppress a specific rule
 *   // scanner-ignore                      → suppress all rules (alias)
 *   // scanner-ignore: rule-id1, rule-id2  → suppress specific rules (alias)
 *   # noqa: rule-id                        → Python-style suppression
 *   # scanner-ignore                       → Python-style (hash comment)
 *   /* scanner-ignore *\/                   → CSS/C-style
 */
const SUPPRESSION_PATTERN = /(?:\/\/|#|\/?\*)\s*(?:repolens-ignore(?:-next-line)?|scanner-ignore|repolens-disable|noqa)(?:[:\s]\s*([\w-]+(?:\s*,\s*[\w-]+)*))?/i
/**
 * Classify the context of a source line to help suppress false-positive
 * scanner matches. Pure function — no side effects.
 *
 * @param blockCommentLines Pre-computed set of line indices inside block
 *   comments (from `computeBlockCommentLines`). Pass this instead of
 *   re-scanning from line 0 on every call.
 */
export function classifyLine(
  line: string,
  filePath: string,
  blockCommentLines?: Set<number>,
  lineIndex?: number,
): LineClassification {
  const isTestFile = TEST_FILE_PATTERN.test(filePath)
  const isGeneratedFile = GENERATED_FILE_PATTERN.test(filePath)
  const isExampleFile = EXAMPLE_FILE_PATTERN.test(filePath)

  // --- Comment detection ---
  let isComment = SINGLE_LINE_COMMENT.test(line)

  // Multi-line block comment detection (pre-computed set)
  if (!isComment && blockCommentLines !== undefined && lineIndex !== undefined) {
    isComment = blockCommentLines.has(lineIndex)
  }

  // --- String literal detection ---
  const isStringLiteral = STRING_ASSIGNMENT.test(line)

  // --- Type annotation detection ---
  const isTypeAnnotation = TYPE_ANNOTATION_PATTERN.test(line) || filePath.endsWith('.d.ts')

  return { isComment, isStringLiteral, isTypeAnnotation, isTestFile, isGeneratedFile, isExampleFile }
}

// ---------------------------------------------------------------------------
// Sanitizer proximity detection
// ---------------------------------------------------------------------------

/**
 * Check whether a known sanitizer function call appears within `windowSize`
 * lines of the match line.  This is a lightweight heuristic — not dataflow
 * analysis — designed to downgrade confidence when a sanitizer is nearby.
 *
 * @param lines All lines in the file.
 * @param matchLine 0-based index of the matched line.
 * @param windowSize Number of lines to check before and after (default 3).
 */
export function hasSanitizerNearby(
  lines: string[],
  matchLine: number,
  windowSize = 3,
): boolean {
  const start = Math.max(0, matchLine - windowSize)
  const end = Math.min(lines.length - 1, matchLine + windowSize)

  for (let i = start; i <= end; i++) {
    if (i === matchLine) continue
    const line = lines[i]
    for (const pat of SANITIZER_PATTERNS) {
      if (pat.test(line)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Inline suppression
// ---------------------------------------------------------------------------

/**
 * Check whether an inline suppression comment on the current line (or the
 * previous line as a "next-line" suppression) covers the given rule.
 *
 * Supported comment formats:
 *   // repolens-ignore                     → suppress all rules on this line
 *   // repolens-ignore-next-line           → suppress all on the next line
 *   // repolens-disable rule-id            → suppress a specific rule
 *   // scanner-ignore                      → suppress all (alias)
 *   // scanner-ignore: rule-id1, rule-id2  → suppress specific rules (alias)
 *   # noqa: rule-id                        → Python-style suppression
 *   # scanner-ignore                       → Python hash-comment style
 *   /* scanner-ignore *\/                   → CSS/C block-comment style
 *
 * @param line        The matched line content.
 * @param previousLine The line immediately before (undefined if first line).
 * @param ruleId      The id of the rule being checked.
 * @returns `true` if the issue should be suppressed.
 */
export function hasInlineSuppression(
  line: string,
  previousLine: string | undefined,
  ruleId: string,
  requireScoped = false,
): boolean {
  // Check the current line for an inline comment
  if (matchesSuppression(line, ruleId, false, requireScoped)) return true

  // Check the previous line for a "next-line" suppression
  if (previousLine !== undefined && matchesSuppression(previousLine, ruleId, true, requireScoped)) return true

  return false
}

/**
 * @internal  Test a single line against the suppression pattern.
 * When `nextLineOnly` is true, only "ignore-next-line" variants match.
 */
function matchesSuppression(line: string, ruleId: string, nextLineOnly = false, requireScoped = false): boolean {
  const m = SUPPRESSION_PATTERN.exec(line)
  if (!m) return false

  // If checking a previous line, it must be a "next-line" style suppression
  if (nextLineOnly && !/ignore-next-line/i.test(line)) return false

  const ruleList = m[1]
  if (!ruleList) return !requireScoped  // No specific rules → suppress all (unless scoped required for critical rules)

  const ids = ruleList.split(/\s*,\s*/).map(s => s.trim().toLowerCase())
  return ids.includes(ruleId.toLowerCase())
}

// ---------------------------------------------------------------------------
// Example / docs file detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the file path belongs to an example, documentation,
 * sample, demo, tutorial, fixture, mock, or storybook directory.
 */
export function isExampleOrDocsFile(filePath: string): boolean {
  return EXAMPLE_FILE_PATTERN.test(filePath)
}

// ---------------------------------------------------------------------------
// Dynamic confidence scoring
// ---------------------------------------------------------------------------

type ConfidenceLevel = 'high' | 'medium' | 'low'

const CONFIDENCE_ORDER: ConfidenceLevel[] = ['high', 'medium', 'low']

function downgradeConfidence(level: ConfidenceLevel): ConfidenceLevel {
  const idx = CONFIDENCE_ORDER.indexOf(level)
  return CONFIDENCE_ORDER[Math.min(idx + 1, CONFIDENCE_ORDER.length - 1)]
}

/**
 * Compute a dynamic confidence level by adjusting the rule's base confidence
 * based on file context.  Each applicable factor downgrades one level (min: low).
 *
 * Factors:
 *  - Match is in a test file
 *  - Match is in an example/docs path
 *  - Match line contains a known sanitizer
 *  - Match is inside a comment (for security rules that still report on comments)
 */
export function computeDynamicConfidence(
  baseConfidence: ConfidenceLevel | undefined,
  context: LineClassification,
  matchContent: string,
): ConfidenceLevel {
  let level: ConfidenceLevel = baseConfidence ?? 'medium'

  if (context.isTestFile) level = downgradeConfidence(level)
  if (context.isExampleFile) level = downgradeConfidence(level)
  if (context.isComment) level = downgradeConfidence(level)

  // Check if the match line itself contains a sanitizer call
  for (const pat of SANITIZER_PATTERNS) {
    if (pat.test(matchContent)) {
      level = downgradeConfidence(level)
      break
    }
  }

  return level
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the first occurrence of `marker` that is NOT inside a string literal
 * (single, double, or template quotes). Returns the index, or -1 if not found.
 */
function findOutsideString(line: string, marker: string): number {
  let inSingle = false
  let inDouble = false
  let inTemplate = false

  for (let i = 0; i <= line.length - marker.length; i++) {
    const ch = line[i]
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) { i++; continue }
    if (ch === "'" && !inDouble && !inTemplate) { inSingle = !inSingle; continue }
    if (ch === '"' && !inSingle && !inTemplate) { inDouble = !inDouble; continue }
    if (ch === '`' && !inSingle && !inDouble) { inTemplate = !inTemplate; continue }
    if (!inSingle && !inDouble && !inTemplate && line.startsWith(marker, i)) {
      return i
    }
  }
  return -1
}

/**
 * Pre-compute which line indices sit inside a block comment (`/* … *​/`)
 * or a Python triple-quote docstring (`"""` / `'''`).  Run once per file
 * and pass the resulting Set to `classifyLine()` to avoid O(n*m) rescans.
 */
export function computeBlockCommentLines(lines: string[]): Set<number> {
  const result = new Set<number>()
  let inBlock = false
  let inTripleDouble = false
  let inTripleSingle = false

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]

    // --- C-style block comments ---
    if (!inTripleDouble && !inTripleSingle) {
      if (!inBlock) {
        const pos = findOutsideString(l, '/*')
        if (pos >= 0) {
          // Open and close on the same line → not a block
          if (l.indexOf('*/', pos + 2) !== -1) {
            // self-closing on same line, skip
          } else {
            inBlock = true
          }
        }
      } else {
        if (l.includes('*/')) {
          inBlock = false
        }
      }
    }

    // --- Python triple-double-quote docstrings ---
    if (!inBlock && !inTripleSingle) {
      const count = l.split('"""').length - 1
      if (count % 2 !== 0) {
        inTripleDouble = !inTripleDouble
      }
    }

    // --- Python triple-single-quote docstrings ---
    if (!inBlock && !inTripleDouble) {
      const count = l.split("'''").length - 1
      if (count % 2 !== 0) {
        inTripleSingle = !inTripleSingle
      }
    }

    if (inBlock || inTripleDouble || inTripleSingle) {
      result.add(i)
    }
  }

  return result
}
