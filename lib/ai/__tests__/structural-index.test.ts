import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import {
  buildStructuralIndex,
  extractSignature,
  getLanguagePatterns,
  inferLanguage,
  isCodeFile,
  SYMBOL_PATTERNS,
} from '../structural-index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockIndex() {
  let index = createEmptyIndex()
  index = indexFile(
    index,
    'src/utils.ts',
    [
      "import { z } from 'zod'",
      '',
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`',
      '}',
      '',
      'export const add = (a: number, b: number): number => a + b',
    ].join('\n'),
    'typescript',
  )
  index = indexFile(
    index,
    'src/types.ts',
    [
      'export interface User {',
      '  id: string',
      '  name: string',
      '}',
      '',
      'export type UserId = string',
      '',
      'export enum Role {',
      "  Admin = 'admin',",
      "  User = 'user',",
      '}',
    ].join('\n'),
    'typescript',
  )
  index = indexFile(
    index,
    'src/index.ts',
    [
      "import { greet } from './utils'",
      "import { User } from './types'",
      '',
      'export class App {',
      '  run() {',
      "    console.log(greet('world'))",
      '  }',
      '}',
    ].join('\n'),
    'typescript',
  )
  return index
}

// ---------------------------------------------------------------------------
// buildStructuralIndex
// ---------------------------------------------------------------------------

describe('buildStructuralIndex', () => {
  it('returns empty string for null codeIndex', () => {
    expect(buildStructuralIndex(null)).toBe('')
  })

  it('returns empty string for codeIndex with no files', () => {
    const empty = createEmptyIndex()
    expect(buildStructuralIndex(empty)).toBe('')
  })

  it('produces valid JSON with file paths, languages, and structural info', () => {
    const index = buildMockIndex()
    const result = buildStructuralIndex(index)
    expect(result).not.toBe('')

    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThanOrEqual(2)

    // Every entry should have path, language, lineCount
    for (const entry of parsed) {
      expect(entry).toHaveProperty('path')
      expect(entry).toHaveProperty('language')
      expect(entry).toHaveProperty('lineCount')
    }

    // At least one entry should have exports
    const withExports = parsed.filter(e => Array.isArray(e.exports))
    expect(withExports.length).toBeGreaterThan(0)
  })

  it('respects maxIndexBytes option — output is truncated but still valid JSON', () => {
    const index = buildMockIndex()
    const fullResult = buildStructuralIndex(index)
    const truncated = buildStructuralIndex(index, { maxIndexBytes: 100 })

    // Truncated output should be shorter or equal
    expect(truncated.length).toBeLessThanOrEqual(fullResult.length)
    // Should still be valid JSON
    expect(() => JSON.parse(truncated)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// extractSignature
// ---------------------------------------------------------------------------

describe('extractSignature', () => {
  it('extracts regular function signature', () => {
    const line = 'export function greet(name: string): string {'
    const sig = extractSignature(line, 'greet', 'fn')
    expect(sig).toContain('greet')
    expect(sig).toContain('name: string')
  })

  it('extracts arrow function signature', () => {
    const line = 'export const add = (a: number, b: number): number => a + b'
    const sig = extractSignature(line, 'add', 'fn')
    expect(sig).toContain('add')
    expect(sig).toContain('a: number')
  })

  it('extracts class signature', () => {
    const line = 'export class App extends Base {'
    const sig = extractSignature(line, 'App', 'class')
    expect(sig).toContain('App')
    expect(sig).toContain('extends Base')
  })

  it('extracts interface signature', () => {
    const line = 'export interface User {'
    const sig = extractSignature(line, 'User', 'iface')
    expect(sig).toContain('User')
  })

  it('extracts type alias signature', () => {
    const line = 'export type UserId = string'
    const sig = extractSignature(line, 'UserId', 'type')
    expect(sig).toContain('UserId')
  })

  it('extracts enum signature', () => {
    const line = 'export enum Role {'
    // enum falls through to default — returns name
    const sig = extractSignature(line, 'Role', 'enum')
    expect(sig).toContain('Role')
  })

  it('caps signatures at 100 characters', () => {
    const longParams = 'a'.repeat(200)
    const line = `export function longFn(${longParams}): void {`
    const sig = extractSignature(line, 'longFn', 'fn')
    expect(sig.length).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// getLanguagePatterns
// ---------------------------------------------------------------------------

describe('getLanguagePatterns', () => {
  it('returns TypeScript patterns for "typescript"', () => {
    const patterns = getLanguagePatterns('typescript')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('fn')
    expect(kinds).toContain('class')
  })

  it('returns Python patterns for "python"', () => {
    const patterns = getLanguagePatterns('python')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('fn')
    expect(kinds).toContain('class')
  })

  it('returns Rust patterns for "rust"', () => {
    const patterns = getLanguagePatterns('rust')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('fn')
    expect(kinds).toContain('struct')
  })

  it('returns Go patterns for "go"', () => {
    const patterns = getLanguagePatterns('go')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('fn')
    expect(kinds).toContain('struct')
  })

  it('returns Java patterns for "java"', () => {
    const patterns = getLanguagePatterns('java')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('class')
    expect(kinds).toContain('fn')
  })
})

// ---------------------------------------------------------------------------
// inferLanguage
// ---------------------------------------------------------------------------

describe('inferLanguage', () => {
  it.each([
    { ext: '.ts', expected: 'typescript' },
    { ext: '.tsx', expected: 'tsx' },
    { ext: '.js', expected: 'javascript' },
    { ext: '.jsx', expected: 'jsx' },
    { ext: '.py', expected: 'python' },
    { ext: '.rs', expected: 'rust' },
    { ext: '.go', expected: 'go' },
    { ext: '.java', expected: 'java' },
    { ext: '.json', expected: 'json' },
    { ext: '.md', expected: 'markdown' },
    { ext: '.css', expected: 'css' },
  ])('maps "$ext" → "$expected"', ({ ext, expected }) => {
    expect(inferLanguage(`file${ext}`)).toBe(expected)
  })

  it('returns filename as language when there is no extension', () => {
    // 'file' has no dot, so split('.').pop() returns 'file' itself
    expect(inferLanguage('file')).toBe('file')
  })

  it('returns extension itself for unmapped extensions', () => {
    expect(inferLanguage('file.xyz')).toBe('xyz')
  })
})

// ---------------------------------------------------------------------------
// isCodeFile
// ---------------------------------------------------------------------------

describe('isCodeFile', () => {
  it.each(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.py', '.rs', '.go', '.java'])(
    'returns true for code extension "%s"',
    ext => {
      expect(isCodeFile(`src/file${ext}`)).toBe(true)
    },
  )

  it.each(['.json', '.md', '.yaml', '.yml', '.css', '.html'])(
    'returns false for non-code extension "%s"',
    ext => {
      expect(isCodeFile(`src/file${ext}`)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// SYMBOL_PATTERNS
// ---------------------------------------------------------------------------

describe('SYMBOL_PATTERNS', () => {
  it('is exported and is a non-empty readonly array', () => {
    expect(SYMBOL_PATTERNS).toBeDefined()
    expect(Array.isArray(SYMBOL_PATTERNS)).toBe(true)
    expect(SYMBOL_PATTERNS.length).toBeGreaterThan(0)
  })

  it('each entry has regex and kind fields', () => {
    for (const pattern of SYMBOL_PATTERNS) {
      expect(pattern).toHaveProperty('regex')
      expect(pattern.regex).toBeInstanceOf(RegExp)
      expect(pattern).toHaveProperty('kind')
      expect(typeof pattern.kind).toBe('string')
    }
  })
})
