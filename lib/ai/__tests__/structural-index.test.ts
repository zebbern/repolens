import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import {
  buildStructuralIndex,
  extractExports,
  extractImports,
  extractSignatures,
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

  it('preserves exact partial coverage for a zero-file structural index', () => {
    const empty = createEmptyIndex()
    empty.coverage = {
      treeStatus: 'partial',
      supportedFiles: { discovered: 0, loaded: 0 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 1, samples: ['vendor'] },
      mode: 'full',
    }

    const parsed = JSON.parse(buildStructuralIndex(empty)) as Array<Record<string, unknown>>
    expect(parsed).toEqual([expect.objectContaining({
      path: '[repository-coverage]',
      repositoryCoverage: empty.coverage,
      coverageNotice: expect.stringContaining('Do not imply repository-wide completeness'),
    })])
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

  it('includes repository coverage truth for partial AI context', () => {
    const index = buildMockIndex()
    index.coverage = {
      treeStatus: 'partial',
      supportedFiles: { discovered: 10, loaded: 8 },
      failures: { count: 2, samples: [] },
      failedSubtrees: { count: 1, samples: ['vendor'] },
      mode: 'full',
    }
    const parsed = JSON.parse(buildStructuralIndex(index)) as Array<Record<string, unknown>>
    expect(parsed[0]).toMatchObject({ path: '[repository-coverage]' })
    expect(parsed[0].coverageNotice).toContain('Do not imply repository-wide completeness')
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
    expect(kinds).toContain('const')
  })

  it('returns Rust patterns for "rust"', () => {
    const patterns = getLanguagePatterns('rust')
    expect(patterns.length).toBeGreaterThan(0)
    const kinds = patterns.map(p => p.kind)
    expect(kinds).toContain('fn')
    expect(kinds).toContain('struct')
    expect(kinds).toContain('type')
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

// ---------------------------------------------------------------------------
// Python top-level constant pattern
// ---------------------------------------------------------------------------

describe('Python top-level constant extraction', () => {
  it('extracts UPPER_CASE constant assignments as symbols', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'config.py',
      [
        'MAX_RETRIES = 5',
        'DEFAULT_TIMEOUT = 30',
        'API_BASE_URL = "https://example.com"',
        '',
        'def connect():',
        '    pass',
      ].join('\n'),
      'python',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const pyFile = parsed.find(e => e.path === 'config.py')
    expect(pyFile).toBeDefined()

    const signatures = pyFile!.signatures as string[]
    expect(signatures).toBeDefined()
    expect(signatures.some(s => s.startsWith('const:') && s.includes('MAX_RETRIES'))).toBe(true)
    expect(signatures.some(s => s.startsWith('const:') && s.includes('DEFAULT_TIMEOUT'))).toBe(true)
    expect(signatures.some(s => s.startsWith('const:') && s.includes('API_BASE_URL'))).toBe(true)
    // The function should also be extracted
    expect(signatures.some(s => s.startsWith('fn:') && s.includes('connect'))).toBe(true)
  })

  it('does not match lowercase variable assignments as constants', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'script.py',
      [
        'local_var = 42',
        'another_var = "hello"',
        '',
        'MAX_SIZE = 100',
      ].join('\n'),
      'python',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const pyFile = parsed.find(e => e.path === 'script.py')
    expect(pyFile).toBeDefined()

    const signatures = pyFile!.signatures as string[]
    expect(signatures).toBeDefined()
    // Only UPPER_CASE should match
    expect(signatures.some(s => s.includes('local_var'))).toBe(false)
    expect(signatures.some(s => s.includes('another_var'))).toBe(false)
    expect(signatures.some(s => s.startsWith('const:') && s.includes('MAX_SIZE'))).toBe(true)
  })

  it('treats Python constants as exports (top-level defs)', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'settings.py',
      ['DEBUG = True', 'VERSION = "1.0.0"'].join('\n'),
      'python',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const pyFile = parsed.find(e => e.path === 'settings.py')
    expect(pyFile).toBeDefined()

    const exports = pyFile!.exports as string[]
    expect(exports).toBeDefined()
    expect(exports).toContain('DEBUG')
    expect(exports).toContain('VERSION')
  })
})

// ---------------------------------------------------------------------------
// Rust type alias pattern
// ---------------------------------------------------------------------------

describe('Rust type alias extraction', () => {
  it('extracts pub type aliases as symbols', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/lib.rs',
      [
        'pub type Result<T> = std::result::Result<T, Error>;',
        'pub type BoxedFuture = Box<dyn Future<Output = ()>>;',
        '',
        'pub fn run() {',
        '    todo!()',
        '}',
      ].join('\n'),
      'rust',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const rsFile = parsed.find(e => e.path === 'src/lib.rs')
    expect(rsFile).toBeDefined()

    const signatures = rsFile!.signatures as string[]
    expect(signatures).toBeDefined()
    expect(signatures.some(s => s.startsWith('type:') && s.includes('Result'))).toBe(true)
    expect(signatures.some(s => s.startsWith('type:') && s.includes('BoxedFuture'))).toBe(true)
    expect(signatures.some(s => s.startsWith('fn:') && s.includes('run'))).toBe(true)
  })

  it('extracts private (non-pub) type aliases', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/internal.rs',
      [
        'type NodeId = u64;',
        'type Callback = Box<dyn Fn() -> ()>;',
      ].join('\n'),
      'rust',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const rsFile = parsed.find(e => e.path === 'src/internal.rs')
    expect(rsFile).toBeDefined()

    const signatures = rsFile!.signatures as string[]
    expect(signatures).toBeDefined()
    expect(signatures.some(s => s.startsWith('type:') && s.includes('NodeId'))).toBe(true)
    expect(signatures.some(s => s.startsWith('type:') && s.includes('Callback'))).toBe(true)
  })

  it('treats pub type aliases as Rust exports', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/types.rs',
      [
        'pub type AppResult<T> = Result<T, AppError>;',
        'type InternalId = u32;',
      ].join('\n'),
      'rust',
    )

    const result = buildStructuralIndex(index)
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>
    const rsFile = parsed.find(e => e.path === 'src/types.rs')
    expect(rsFile).toBeDefined()

    const exports = rsFile!.exports as string[]
    expect(exports).toBeDefined()
    expect(exports).toContain('AppResult')
    // Non-pub should NOT appear in exports
    expect(exports).not.toContain('InternalId')
  })
})

// ---------------------------------------------------------------------------
// extractExports
// ---------------------------------------------------------------------------

describe('extractExports', () => {
  it('extracts named exports from a TypeScript file', () => {
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
        '',
        'export class Calculator {}',
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/utils.ts')!
    const exports = extractExports(file)
    expect(exports).toContain('greet')
    expect(exports).toContain('add')
    expect(exports).toContain('Calculator')
  })

  it('extracts re-exports from JS/TS files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/index.ts',
      [
        "export { greet, Calculator } from './utils'",
        "export { User } from './types'",
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/index.ts')!
    const exports = extractExports(file)
    expect(exports).toContain('greet')
    expect(exports).toContain('Calculator')
    expect(exports).toContain('User')
  })

  it('extracts top-level defs as exports from Python files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'module.py',
      [
        'def hello():',
        '    pass',
        '',
        'class MyClass:',
        '    pass',
        '',
        'MAX_SIZE = 100',
      ].join('\n'),
      'python',
    )
    const file = index.files.get('module.py')!
    const exports = extractExports(file)
    expect(exports).toContain('hello')
    expect(exports).toContain('MyClass')
    expect(exports).toContain('MAX_SIZE')
  })

  it('returns deduplicated export names', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/dup.ts',
      [
        'export function foo() {}',
        "export { foo } from './other'",
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/dup.ts')!
    const exports = extractExports(file)
    const fooCount = exports.filter(e => e === 'foo').length
    expect(fooCount).toBe(1)
  })

  it('extracts pub items as exports from Rust files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/lib.rs',
      [
        'pub fn run() {}',
        'pub struct Config {}',
        'fn private_fn() {}',
      ].join('\n'),
      'rust',
    )
    const file = index.files.get('src/lib.rs')!
    const exports = extractExports(file)
    expect(exports).toContain('run')
    expect(exports).toContain('Config')
    expect(exports).not.toContain('private_fn')
  })
})

// ---------------------------------------------------------------------------
// extractImports
// ---------------------------------------------------------------------------

describe('extractImports', () => {
  it('extracts import paths from TypeScript files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/app.ts',
      [
        "import { z } from 'zod'",
        "import { User } from './types'",
        "import React from 'react'",
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/app.ts')!
    const imports = extractImports(file)
    expect(imports).toContain('zod')
    expect(imports).toContain('./types')
    expect(imports).toContain('react')
  })

  it('extracts import paths from Python files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'main.py',
      [
        'from flask import Flask',
        'import os',
        'from utils.helpers import parse',
      ].join('\n'),
      'python',
    )
    const file = index.files.get('main.py')!
    const imports = extractImports(file)
    expect(imports).toContain('flask')
    expect(imports).toContain('os')
    expect(imports).toContain('utils.helpers')
  })

  it('extracts use statements from Rust files', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/main.rs',
      [
        'use std::collections::HashMap;',
        'use crate::config::Config;',
      ].join('\n'),
      'rust',
    )
    const file = index.files.get('src/main.rs')!
    const imports = extractImports(file)
    expect(imports).toContain('std::collections::HashMap')
    expect(imports).toContain('crate::config::Config')
  })

  it('returns empty array for files with no imports', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/empty.ts',
      'export const x = 1',
      'typescript',
    )
    const file = index.files.get('src/empty.ts')!
    const imports = extractImports(file)
    expect(imports).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// extractSignatures
// ---------------------------------------------------------------------------

describe('extractSignatures', () => {
  it('extracts function and class signatures from TypeScript', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/utils.ts',
      [
        'export function greet(name: string): string {',
        '  return `Hello, ${name}`',
        '}',
        '',
        'export class Calculator {',
        '  sum(a: number, b: number) { return a + b }',
        '}',
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/utils.ts')!
    const sigs = extractSignatures(file)
    expect(sigs.some(s => s.startsWith('fn:') && s.includes('greet'))).toBe(true)
    expect(sigs.some(s => s.startsWith('class:') && s.includes('Calculator'))).toBe(true)
  })

  it('extracts interface and type signatures', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/types.ts',
      [
        'export interface User {',
        '  id: string',
        '}',
        '',
        'export type UserId = string',
        '',
        'export enum Role {',
        "  Admin = 'admin',",
        '}',
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/types.ts')!
    const sigs = extractSignatures(file)
    expect(sigs.some(s => s.startsWith('iface:') && s.includes('User'))).toBe(true)
    expect(sigs.some(s => s.startsWith('type:') && s.includes('UserId'))).toBe(true)
    expect(sigs.some(s => s.startsWith('enum:') && s.includes('Role'))).toBe(true)
  })

  it('extracts Python function and class signatures', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'app.py',
      [
        'def process(data):',
        '    pass',
        '',
        'class Handler:',
        '    pass',
        '',
        'MAX_RETRIES = 5',
      ].join('\n'),
      'python',
    )
    const file = index.files.get('app.py')!
    const sigs = extractSignatures(file)
    expect(sigs.some(s => s.startsWith('fn:') && s.includes('process'))).toBe(true)
    expect(sigs.some(s => s.startsWith('class:') && s.includes('Handler'))).toBe(true)
    expect(sigs.some(s => s.startsWith('const:') && s.includes('MAX_RETRIES'))).toBe(true)
  })

  it('extracts Rust fn and struct signatures', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/lib.rs',
      [
        'pub fn run(config: &Config) -> Result<()> {',
        '    todo!()',
        '}',
        '',
        'pub struct Server {',
        '    port: u16,',
        '}',
      ].join('\n'),
      'rust',
    )
    const file = index.files.get('src/lib.rs')!
    const sigs = extractSignatures(file)
    expect(sigs.some(s => s.startsWith('fn:') && s.includes('run'))).toBe(true)
    expect(sigs.some(s => s.startsWith('struct:') && s.includes('Server'))).toBe(true)
  })

  it('returns deduplicated signatures', () => {
    let index = createEmptyIndex()
    index = indexFile(
      index,
      'src/dupe.ts',
      [
        'export function foo() {}',
        '// export function foo() {} — commented out but regex may still match',
      ].join('\n'),
      'typescript',
    )
    const file = index.files.get('src/dupe.ts')!
    const sigs = extractSignatures(file)
    const fooSigs = sigs.filter(s => s.includes('foo'))
    // Should be deduplicated via Set
    expect(new Set(fooSigs).size).toBe(fooSigs.length)
  })
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
