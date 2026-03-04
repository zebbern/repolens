import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { executeToolLocally } from '../client-tool-executor'

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
      "import { User } from './types'",
      '',
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`',
      '}',
      '',
      'export const add = (a: number, b: number): number => a + b',
      '',
      'export class Calculator {',
      '  sum(a: number, b: number) { return a + b }',
      '}',
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
    'src/components/index.ts',
    [
      "import { greet } from '../utils'",
      '',
      'export function App() {',
      "  return greet('world')",
      '}',
    ].join('\n'),
    'typescript',
  )
  return index
}

// ---------------------------------------------------------------------------
// null / empty codeIndex
// ---------------------------------------------------------------------------

describe('executeToolLocally — empty index', () => {
  it('returns error JSON for null codeIndex', () => {
    const result = JSON.parse(executeToolLocally('readFile', { path: 'foo' }, null))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('No codebase loaded')
  })

  it('returns error JSON for codeIndex with 0 files', () => {
    const empty = createEmptyIndex()
    const result = JSON.parse(executeToolLocally('readFile', { path: 'foo' }, empty))
    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

describe('executeToolLocally — readFile', () => {
  it('returns file content for a valid path', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('readFile', { path: 'src/utils.ts' }, index))
    expect(result.path).toBe('src/utils.ts')
    expect(result.content).toContain('export function greet')
  })

  it('returns error for a missing file path', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('readFile', { path: 'nonexistent.ts' }, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('File not found')
  })

  it('respects startLine / endLine range', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('readFile', { path: 'src/utils.ts', startLine: 1, endLine: 3 }, index),
    )
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(3)
    // Content should be only the first 3 lines
    const lines = result.content.split('\n')
    expect(lines.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// readFiles
// ---------------------------------------------------------------------------

describe('executeToolLocally — readFiles', () => {
  it('returns multiple files', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('readFiles', { paths: ['src/utils.ts', 'src/types.ts'] }, index),
    )
    expect(result.files).toHaveLength(2)
    expect(result.files[0].path).toBe('src/utils.ts')
    expect(result.files[1].path).toBe('src/types.ts')
  })

  it('returns error entries for invalid paths', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('readFiles', { paths: ['missing.ts'] }, index),
    )
    expect(result.files[0]).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// searchFiles
// ---------------------------------------------------------------------------

describe('executeToolLocally — searchFiles', () => {
  it('finds path matches', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'utils' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    const pathMatches = result.results.filter(
      (r: { matchType: string }) => r.matchType === 'path',
    )
    expect(pathMatches.length).toBeGreaterThan(0)
    expect(pathMatches[0].path).toContain('utils')
  })

  it('finds content matches', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'greet' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
  })

  it('respects maxResults', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'export', maxResults: 1 }, index),
    )
    expect(result.results.length).toBeLessThanOrEqual(1)
  })

  it('returns validation error for missing query', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('searchFiles', {}, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Validation failed')
  })
})

// ---------------------------------------------------------------------------
// searchFiles with isRegex
// ---------------------------------------------------------------------------

describe('executeToolLocally — searchFiles with isRegex', () => {
  it('works with a valid regex', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'greet|add', isRegex: true }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
  })

  it('falls back gracefully for invalid regex', () => {
    const index = buildMockIndex()
    // Invalid regex — searchIndex falls back to escaped literal
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: '[invalid(', isRegex: true }, index),
    )
    // Should not throw; result may have 0 matches but no error property
    expect(result).toHaveProperty('matchCount')
  })
})

// ---------------------------------------------------------------------------
// listDirectory
// ---------------------------------------------------------------------------

describe('executeToolLocally — listDirectory', () => {
  it('returns entries for a valid directory', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('listDirectory', { path: 'src' }, index),
    )
    expect(result.entries).toBeDefined()
    expect(result.entries.length).toBeGreaterThan(0)
    // Should contain files and subdirectories
    expect(result.entries).toContain('utils.ts')
    expect(result.entries).toContain('types.ts')
  })

  it('returns error for a nonexistent directory', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('listDirectory', { path: 'nonexistent' }, index),
    )
    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// findSymbol
// ---------------------------------------------------------------------------

describe('executeToolLocally — findSymbol', () => {
  it('finds function definitions', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'greet' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.results[0].kind).toBe('function')
  })

  it('finds class definitions', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'Calculator' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.results[0].kind).toBe('class')
  })

  it('finds interface definitions', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'User' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.results[0].kind).toBe('interface')
  })

  it('finds type alias definitions', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'UserId' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.results[0].kind).toBe('type')
  })

  it('finds enum definitions', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'Role' }, index),
    )
    expect(result.matchCount).toBeGreaterThan(0)
    expect(result.results[0].kind).toBe('enum')
  })

  it('filters by kind correctly', () => {
    const index = buildMockIndex()
    // 'User' exists as both an interface and an enum member line — filter to interface only
    const result = JSON.parse(
      executeToolLocally('findSymbol', { name: 'greet', kind: 'class' }, index),
    )
    // greet is a function, not a class, so 0 matches expected
    expect(result.matchCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getFileStats
// ---------------------------------------------------------------------------

describe('executeToolLocally — getFileStats', () => {
  it('returns line count, language, import and export counts', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('getFileStats', { path: 'src/utils.ts' }, index),
    )
    expect(result.path).toBe('src/utils.ts')
    expect(result.lineCount).toBeGreaterThan(0)
    expect(result).toHaveProperty('language')
    expect(result.importCount).toBeGreaterThanOrEqual(1)
    expect(result.exportCount).toBeGreaterThanOrEqual(1)
  })

  it('returns error for missing file', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('getFileStats', { path: 'nope.ts' }, index),
    )
    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// getProjectOverview
// ---------------------------------------------------------------------------

describe('executeToolLocally — getProjectOverview', () => {
  it('returns totalFiles, totalLines, and languages', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('getProjectOverview', {}, index))
    expect(result.totalFiles).toBe(3)
    expect(result.totalLines).toBeGreaterThan(0)
    expect(Array.isArray(result.languages)).toBe(true)
    expect(result.languages.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------

describe('executeToolLocally — unknown tool', () => {
  it('returns error JSON for unknown tool name', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('nonexistentTool', {}, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Unknown tool')
  })
})

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

describe('executeToolLocally — Zod validation', () => {
  it('returns actionable error when readFile is called without path', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('readFile', {}, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Validation failed')
  })

  it('returns actionable error when searchFiles is called with empty object', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('searchFiles', {}, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Validation failed')
  })

  it('returns actionable error when findSymbol is called without name', () => {
    const index = buildMockIndex()
    const result = JSON.parse(executeToolLocally('findSymbol', {}, index))
    expect(result).toHaveProperty('error')
    expect(result.error).toContain('Validation failed')
  })
})
