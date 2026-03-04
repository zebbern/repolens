// Fix suggestion generator — produces code diffs for scanner findings
// using conservative pattern-based replacements.

import type { CodeIssue } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNumber: number
}

export interface FixSuggestion {
  ruleId: string
  original: string
  fixed: string
  explanation: string
  confidence: 'auto' | 'ai-suggested'
  diffLines: DiffLine[]
}

// ---------------------------------------------------------------------------
// Fix pattern functions
// ---------------------------------------------------------------------------

type FixFunction = (line: string, context: string[]) => { fixed: string; explanation: string } | null

// NOTE: Some patterns below include Unicode smart quotes \u201C (\u201C) and \u201D (\u201D)
// alongside standard quotes. This is intentional — real-world code pasted from documents,
// word processors, or Slack often contains smart quotes, and the scanner should match them.
const FIX_PATTERNS: Record<string, FixFunction> = {
  // --- Security ---

  'eval-usage': (line) => {
    // Replace eval(...) with JSON.parse(...) when it looks like data parsing
    const evalMatch = line.match(/\beval\s*\(/)
    if (!evalMatch) return null
    const fixed = line.replace(/\beval\s*\(/, 'JSON.parse(')
    return {
      fixed,
      explanation: 'Replace eval() with JSON.parse() for data parsing. eval() executes arbitrary code and is a critical security risk.',
    }
  },

  'innerhtml-xss': (line) => {
    // .innerHTML = ... → .textContent = ...
    if (line.includes('.innerHTML')) {
      const fixed = line.replace(/\.innerHTML\s*=/, '.textContent =')
      return {
        fixed,
        explanation: 'Use textContent instead of innerHTML to prevent XSS. If HTML rendering is needed, sanitize with DOMPurify first.',
      }
    }
    // dangerouslySetInnerHTML — can't auto-fix React JSX safely
    return null
  },

  'sql-injection': (line) => {
    // Template literal SQL → parameterized (too complex for reliable auto-fix)
    return null
  },

  'hardcoded-secret': (line) => {
    const match = line.match(
      /((?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*)['""][^'"]{8,}['"]/i,
    )
    if (!match) return null
    // Derive an env var name from the key name
    const keyName = match[1].replace(/\s*[:=]\s*$/, '').trim()
    const envName = keyName.toUpperCase().replace(/[- ]/g, '_')
    const fixed = line.replace(/['""][^'"]{8,}['"]/, `process.env.${envName}`)
    return {
      fixed,
      explanation: `Move the secret to an environment variable (process.env.${envName}) or a secrets manager.`,
    }
  },

  'hardcoded-password': (line) => {
    const match = line.match(/((?:password|passwd|pwd)\s*[:=]\s*)['""][^'"]{4,}['"]/i)
    if (!match) return null
    const fixed = line.replace(/['""][^'"]{4,}['"]/, 'process.env.DB_PASSWORD')
    return {
      fixed,
      explanation: 'Move the password to an environment variable (process.env.DB_PASSWORD) or a secrets manager.',
    }
  },

  'cors-wildcard': (line) => {
    const fixed = line.replace(/['"]?\*['"]?/, "'https://your-domain.com'")
    return {
      fixed,
      explanation: "Replace wildcard '*' CORS origin with your specific trusted domain(s).",
    }
  },

  'weak-hash': (line) => {
    const fixed = line.replace(/['"](?:md5|sha1|sha-1)['"]/i, "'sha256'")
    return {
      fixed,
      explanation: 'Use SHA-256 or stronger hash algorithm. MD5 and SHA-1 are cryptographically broken.',
    }
  },

  'insecure-random': (line) => {
    const fixed = line.replace(/Math\.random\(\)/, 'crypto.randomUUID()')
    return {
      fixed,
      explanation: 'Use crypto.randomUUID() or crypto.getRandomValues() for security-sensitive random values. Math.random() is predictable.',
    }
  },

  'cookie-no-httponly': (line) => {
    const fixed = line.replace(/httpOnly\s*:\s*false/i, 'httpOnly: true')
    return {
      fixed,
      explanation: 'Set httpOnly to true to prevent JavaScript access to the cookie, mitigating XSS-based cookie theft.',
    }
  },

  'cookie-no-secure': (line) => {
    const fixed = line.replace(/secure\s*:\s*false/i, 'secure: true')
    return {
      fixed,
      explanation: 'Set secure to true to ensure the cookie is only sent over HTTPS.',
    }
  },

  // --- Quality ---

  'console-log': (line) => {
    const match = line.match(/\bconsole\.(log|debug|info|trace)\s*\(/)
    if (!match) return null
    const method = match[1]
    const logLevel = method === 'debug' || method === 'trace' ? 'debug' : 'info'
    const fixed = line.replace(`console.${method}(`, `logger.${logLevel}(`)
    return {
      fixed,
      explanation: `Replace console.${method}() with a structured logger. Console statements leak information in production.`,
    }
  },

  'any-type': (line) => {
    // : any → : unknown
    if (line.match(/:\s*any\b/)) {
      const fixed = line.replace(/:\s*any\b/, ': unknown')
      return {
        fixed,
        explanation: "Use 'unknown' instead of 'any'. Unknown requires type narrowing before use, preserving type safety.",
      }
    }
    // as any → as unknown
    if (line.match(/as\s+any\b/)) {
      const fixed = line.replace(/as\s+any\b/, 'as unknown')
      return {
        fixed,
        explanation: "Use 'as unknown' instead of 'as any'. Consider defining a proper type instead of casting.",
      }
    }
    // <any> → <unknown>
    if (line.includes('<any>')) {
      const fixed = line.replace(/<any>/g, '<unknown>')
      return {
        fixed,
        explanation: "Use '<unknown>' instead of '<any>'. Define a proper generic type for better type safety.",
      }
    }
    return null
  },

  'empty-catch': (line, context) => {
    // Match catch(...) { } and add error logging
    const catchMatch = line.match(/catch\s*\(([^)]*)\)\s*\{\s*\}/)
    if (!catchMatch) return null
    const errorVar = catchMatch[1].trim() || 'error'
    const fixed = line.replace(
      /catch\s*\([^)]*\)\s*\{\s*\}/,
      `catch (${errorVar}) { console.error('Operation failed', ${errorVar}) }`,
    )
    return {
      fixed,
      explanation: 'Add error logging to the catch block. Empty catch blocks silently swallow errors, making debugging impossible.',
    }
  },

  'var-usage': (line) => {
    const fixed = line.replace(/\bvar\s+/, 'const ')
    return {
      fixed,
      explanation: "Replace 'var' with 'const' (or 'let' if reassigned). 'var' has function scope and hoisting, leading to subtle bugs.",
    }
  },

  // --- Framework ---

  'django-csrf-exempt': (line) => {
    if (line.match(/@csrf_exempt/)) {
      return {
        fixed: '# @csrf_exempt removed — CSRF protection is important',
        explanation: 'Remove @csrf_exempt decorator to re-enable CSRF protection. CSRF tokens prevent cross-site request forgery attacks.',
      }
    }
    return null
  },

  'flask-debug-mode': (line) => {
    const fixed = line.replace(/debug\s*=\s*True/i, 'debug=False')
    return {
      fixed,
      explanation: 'Disable debug mode in production. Debug mode exposes a debugger that allows arbitrary code execution.',
    }
  },

  'cookie-insecure': (line) => {
    // Generic: secure: false → secure: true
    if (line.match(/secure\s*[:=]\s*false/i)) {
      const fixed = line.replace(/secure\s*[:=]\s*false/i, 'secure: true')
      return {
        fixed,
        explanation: 'Set secure flag to true to ensure cookies are only transmitted over HTTPS.',
      }
    }
    return null
  },

  'graphql-introspection-enabled': (line) => {
    const fixed = line.replace(
      /introspection\s*:\s*true/,
      "introspection: process.env.NODE_ENV !== 'production'",
    )
    return {
      fixed,
      explanation: 'Disable GraphQL introspection in production to prevent schema exposure.',
    }
  },
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Generate a unified diff between original and fixed text,
 * including context lines above and below the change.
 */
export function generateDiff(
  original: string,
  fixed: string,
  lineNumber: number,
  fileContent: string,
): DiffLine[] {
  const fileLines = fileContent.split('\n')
  const diffLines: DiffLine[] = []
  const CONTEXT_LINES = 2

  // Context lines before
  const contextStart = Math.max(0, lineNumber - 1 - CONTEXT_LINES)
  for (let i = contextStart; i < lineNumber - 1; i++) {
    diffLines.push({ type: 'context', content: fileLines[i] ?? '', lineNumber: i + 1 })
  }

  // Original (removed) lines
  const originalLines = original.split('\n')
  for (let i = 0; i < originalLines.length; i++) {
    diffLines.push({ type: 'remove', content: originalLines[i], lineNumber: lineNumber + i })
  }

  // Fixed (added) lines
  const fixedLines = fixed.split('\n')
  for (let i = 0; i < fixedLines.length; i++) {
    diffLines.push({ type: 'add', content: fixedLines[i], lineNumber: lineNumber + i })
  }

  // Context lines after
  const contextEnd = Math.min(fileLines.length, lineNumber + originalLines.length - 1 + CONTEXT_LINES)
  for (let i = lineNumber + originalLines.length - 1; i < contextEnd; i++) {
    diffLines.push({ type: 'context', content: fileLines[i] ?? '', lineNumber: i + 1 })
  }

  return diffLines
}

/**
 * Generate a fix suggestion for a single scanner issue.
 * Returns null if no automated fix is available.
 */
export function generateFix(issue: CodeIssue, fileContent: string): FixSuggestion | null {
  const fileLines = fileContent.split('\n')
  const lineIndex = issue.line - 1

  if (lineIndex < 0 || lineIndex >= fileLines.length) return null

  const originalLine = fileLines[lineIndex]

  // Gather surrounding context (±5 lines)
  const contextStart = Math.max(0, lineIndex - 5)
  const contextEnd = Math.min(fileLines.length, lineIndex + 6)
  const context = fileLines.slice(contextStart, contextEnd)

  // 1. Try pattern-based fix
  const fixFn = FIX_PATTERNS[issue.ruleId]
  if (fixFn) {
    const result = fixFn(originalLine, context)
    if (result && result.fixed !== originalLine) {
      return {
        ruleId: issue.ruleId,
        original: originalLine,
        fixed: result.fixed,
        explanation: result.explanation,
        confidence: 'auto',
        diffLines: generateDiff(originalLine, result.fixed, issue.line, fileContent),
      }
    }
  }

  // 2. Fall back to the issue's fix field from the rule definition
  if (issue.fix) {
    return {
      ruleId: issue.ruleId,
      original: originalLine,
      fixed: issue.fix,
      explanation: issue.fixDescription ?? issue.suggestion ?? `Apply suggested fix for ${issue.title}`,
      confidence: 'ai-suggested',
      diffLines: generateDiff(originalLine, issue.fix, issue.line, fileContent),
    }
  }

  // 3. No fix available
  return null
}

/**
 * Generate fix suggestions for all issues in a file.
 * Filters out issues where no automated fix is available.
 */
export function getAllFixSuggestions(issues: CodeIssue[], fileContent: string): FixSuggestion[] {
  const suggestions: FixSuggestion[] = []

  for (const issue of issues) {
    const suggestion = generateFix(issue, fileContent)
    if (suggestion) {
      suggestions.push(suggestion)
    }
  }

  return suggestions
}
