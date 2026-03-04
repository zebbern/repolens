// Context classifier — classifies the context of a matched line to reduce
// false positives from comments, strings, type annotations, and test files.

export interface LineClassification {
  isComment: boolean
  isStringLiteral: boolean
  isTypeAnnotation: boolean
  isTestFile: boolean
  isGeneratedFile: boolean
}

// ---------------------------------------------------------------------------
// Test / Generated file patterns
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERN = /\.test\.|\.spec\.|__tests__[/\\]|[/\\]test[/\\]|__mocks__[/\\]|fixtures[/\\]/i
const GENERATED_FILE_PATTERN = /\.generated\.|\.g\.ts$|__generated__[/\\]|codegen[/\\]|\.d\.ts$|generated[/\\]/i

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

const TYPE_ANNOTATION_PATTERN = /^\s*(?:type\s+\w|interface\s+\w)|:\s*[A-Z]\w+|(?:\bas\b\s+[A-Z]\w+)|<[A-Z]\w+>/

// ---------------------------------------------------------------------------
// String literal heuristic
// ---------------------------------------------------------------------------

const STRING_ASSIGNMENT = /=\s*(?:"[^"]*"|'[^']*'|`(?:(?!\$\{)[^`])*`)\s*[;,]?\s*$/

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

  return { isComment, isStringLiteral, isTypeAnnotation, isTestFile, isGeneratedFile }
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
