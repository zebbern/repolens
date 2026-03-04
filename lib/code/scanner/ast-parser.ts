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

const astCache = new Map<string, { contentLen: number; ast: ParseResult<File> | null }>()

/** Clear the AST cache. Exported for testing purposes. */
export function clearASTCache(): void {
  astCache.clear()
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

  const cached = astCache.get(file.path)
  if (cached && cached.contentLen === file.content.length) return cached.ast

  const ast = parseFileAST(file.content, lang)
  astCache.set(file.path, { contentLen: file.content.length, ast })
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
