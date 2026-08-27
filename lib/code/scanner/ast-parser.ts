// AST Parser — Babel-based AST parsing with caching for JS/TS files
//
// Provides cached AST parsing. Analysis functions are in ast-analysis.ts.

import { parse, type ParserPlugin } from '@babel/parser'
import type { ParseResult } from '@babel/parser'
import type { File } from '@babel/types'
import type { IndexedFile } from '../code-index'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions eligible for AST parsing */
const AST_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts'])

/** Languages eligible for AST parsing */
const AST_LANGUAGES = new Set(['javascript', 'typescript', 'jsx', 'tsx'])

/** Max file size (in lines) we'll attempt to parse */
const MAX_LINE_COUNT = 5000

/** Babel parser plugins for broad JS/TS support */
const PARSER_PLUGINS: ParserPlugin[] = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'optionalChaining',
  'nullishCoalescingOperator',
]

// ---------------------------------------------------------------------------
// AST Cache
// ---------------------------------------------------------------------------

const astCache = new Map<string, ParseResult<File> | null>()

/** Maximum number of entries in the AST cache before evicting oldest */
const AST_CACHE_MAX_SIZE = 500

/** Clear the AST cache. Exported for testing purposes. */
export function clearASTCache(): void {
  astCache.clear()
}

/** Stable 128-bit content identity for the in-memory AST cache. */
function stableContentHash(content: string): string {
  let h1 = 0x6a09e667 ^ content.length
  let h2 = 0xbb67ae85 ^ content.length
  let h3 = 0x3c6ef372 ^ content.length
  let h4 = 0xa54ff53a ^ content.length

  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 0x85ebca6b)
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35)
    h3 = Math.imul(h3 ^ code, 0x27d4eb2f)
    h4 = Math.imul(h4 ^ code, 0x165667b1)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b) ^ Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x85ebca6b) ^ Math.imul(h3 ^ (h3 >>> 13), 0xc2b2ae35)
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x85ebca6b) ^ Math.imul(h4 ^ (h4 >>> 13), 0xc2b2ae35)
  h4 = Math.imul(h4 ^ (h4 >>> 16), 0x85ebca6b) ^ Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35)

  return [h1, h2, h3, h4]
    .map(value => (value >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JS/TS source string into a Babel AST.
 *
 * @param content  - Source code to parse
 * @param language - Language identifier (`'javascript'`, `'typescript'`, `'jsx'`, `'tsx'`)
 * @returns Parsed AST File node, or `null` if unsupported language or parse failure.
 */
export function parseFileAST(
  content: string,
  language: string,
): ParseResult<File> | null {
  if (!AST_LANGUAGES.has(language)) return null

  try {
    return parse(content, {
      sourceType: 'module',
      plugins: PARSER_PLUGINS,
      errorRecovery: true,
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
    })
  } catch {
    return null
  }
}

/**
 * Get (or cache) the Babel AST for an `IndexedFile`.
 *
 * Returns `null` when the language is unsupported, file exceeds
 * MAX_LINE_COUNT, or parsing fails.
 */
export function getAST(file: IndexedFile): ParseResult<File> | null {
  const lang = file.language ?? ''
  if (!AST_LANGUAGES.has(lang)) return null
  if (file.lineCount > MAX_LINE_COUNT) return null
  if (!file.content) return null
  const content = file.content
  const cacheKey = `${lang}:${content.length}:${stableContentHash(content)}`

  if (astCache.has(cacheKey)) return astCache.get(cacheKey) ?? null

  const ast = parseFileAST(content, lang)
  // Evict oldest entry if cache is full (FIFO approximation)
  if (astCache.size >= AST_CACHE_MAX_SIZE) {
    const oldestKey = astCache.keys().next().value
    if (oldestKey !== undefined) astCache.delete(oldestKey)
  }
  astCache.set(cacheKey, ast)
  return ast
}

/** Check whether a file extension is eligible for AST parsing. */
export function isASTEligible(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop() || '').toLowerCase()
  return AST_EXTENSIONS.has(ext)
}

// Re-export types for convenience
export type { ParseResult } from '@babel/parser'
export type { File } from '@babel/types'
export { AST_LANGUAGES }
