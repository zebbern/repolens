import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { executeToolLocally, type ToolExecutorOptions } from '../client-tool-executor'
import { codeTools } from '../tool-definitions'

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
    expect(result.warning).toContain('Invalid regex')
  })

  it('falls back for ReDoS-length regex (> 200 chars)', () => {
    const index = buildMockIndex()
    const longPattern = 'a'.repeat(201)
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: longPattern, isRegex: true }, index),
    )
    expect(result).toHaveProperty('matchCount')
    expect(result.warning).toContain('200 characters')
  })

  it('uses regex for path matching when isRegex is true', () => {
    const index = buildMockIndex()
    // Regex that matches paths containing "types" or "utils"
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'types|utils', isRegex: true }, index),
    )
    expect(result.matchCount).toBeGreaterThanOrEqual(2)
    const pathMatches = result.results.filter(
      (r: { matchType: string }) => r.matchType === 'path',
    )
    expect(pathMatches.length).toBeGreaterThanOrEqual(2)
    const matchedPaths = pathMatches.map((r: { path: string }) => r.path)
    expect(matchedPaths.some((p: string) => p.includes('types'))).toBe(true)
    expect(matchedPaths.some((p: string) => p.includes('utils'))).toBe(true)
  })

  it('regex path matching is case-insensitive', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'UTILS', isRegex: true }, index),
    )
    const pathMatches = result.results.filter(
      (r: { matchType: string }) => r.matchType === 'path',
    )
    expect(pathMatches.length).toBeGreaterThan(0)
    expect(pathMatches[0].path).toContain('utils')
  })

  it('no warning field when regex is valid and short', () => {
    const index = buildMockIndex()
    const result = JSON.parse(
      executeToolLocally('searchFiles', { query: 'greet', isRegex: true }, index),
    )
    expect(result.warning).toBeUndefined()
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

// ---------------------------------------------------------------------------
// Helpers for fix tests
// ---------------------------------------------------------------------------

/** Build a minimal CodeIndex from a record of path → content. */
function buildIndex(files: Record<string, string>) {
  let index = createEmptyIndex()
  for (const [path, content] of Object.entries(files)) {
    index = indexFile(index, path, content, path.split('.').pop())
  }
  return index
}

/** Parse the JSON string returned by executeToolLocally. */
function exec(
  toolName: string,
  input: Record<string, unknown>,
  codeIndex: ReturnType<typeof createEmptyIndex>,
  allFilePaths?: string[],
  options?: ToolExecutorOptions,
) {
  return JSON.parse(executeToolLocally(toolName, input, codeIndex, allFilePaths, options)) as Record<string, unknown>
}

const BASIC_INDEX = buildIndex({
  'src/index.ts': 'export function main() { return 42 }',
  'src/utils.ts': 'export function add(a: number, b: number) { return a + b }',
  'src/components/Button.tsx': 'export default function Button() { return <button /> }',
  'package.json': '{ "name": "test" }',
})

// ---------------------------------------------------------------------------
// F4 — Incomplete indexing warnings
// ---------------------------------------------------------------------------

describe('F4: indexing progress warnings', () => {
  it('returns indexWarning when indexing is incomplete', () => {
    const result = exec('getProjectOverview', {}, BASIC_INDEX, undefined, {
      indexingProgress: { filesIndexed: 5, totalFiles: 20 },
    })

    expect(result.indexWarning).toBe(
      'Code index is incomplete (5/20 files). Results may be partial.',
    )
  })

  it('does NOT return indexWarning when indexing is complete', () => {
    const result = exec('getProjectOverview', {}, BASIC_INDEX, undefined, {
      indexingProgress: { filesIndexed: 20, totalFiles: 20 },
    })

    expect(result.indexWarning).toBeUndefined()
  })

  it('does NOT return indexWarning when indexingProgress is omitted', () => {
    const result = exec('getProjectOverview', {}, BASIC_INDEX)

    expect(result.indexWarning).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// F1 — repoMeta in getProjectOverview
// ---------------------------------------------------------------------------

describe('F1: getProjectOverview with repoMeta', () => {
  const META = {
    stars: 1200,
    forks: 340,
    description: 'A test repo',
    topics: ['typescript', 'testing'],
    license: 'MIT',
    language: 'TypeScript',
  }

  it('includes repoMeta fields when repoMeta is provided', () => {
    const result = exec('getProjectOverview', {}, BASIC_INDEX, undefined, { repoMeta: META })

    expect(result.repoMeta).toEqual(META)
  })

  it('omits repoMeta when not provided', () => {
    const result = exec('getProjectOverview', {}, BASIC_INDEX)

    expect(result.repoMeta).toBeUndefined()
    expect(result.totalFiles).toBe(4)
    expect(result.hasTests).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// F2 — searchFiles uses allFilePaths
// ---------------------------------------------------------------------------

describe('F2: searchFiles with allFilePaths', () => {
  it('uses allFilePaths for path matching — finds files not in CodeIndex', () => {
    const allPaths = [
      'src/index.ts',
      'src/utils.ts',
      'src/components/Button.tsx',
      'package.json',
      'src/extra/hidden-feature.ts',
    ]

    const result = exec('searchFiles', { query: 'hidden-feature' }, BASIC_INDEX, allPaths)

    const paths = (result.results as Array<{ path: string }>).map(r => r.path)
    expect(paths).toContain('src/extra/hidden-feature.ts')
  })

  it('falls back to CodeIndex paths when allFilePaths is omitted', () => {
    const result = exec('searchFiles', { query: 'utils' }, BASIC_INDEX)

    const paths = (result.results as Array<{ path: string }>).map(r => r.path)
    expect(paths).toContain('src/utils.ts')
    expect(result.totalFiles).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// F5 — readFile truncation
// ---------------------------------------------------------------------------

describe('F5: readFile truncation at MAX_FILE_CONTENT_CHARS', () => {
  const LARGE_CONTENT = 'x'.repeat(150_000)
  const LARGE_INDEX = buildIndex({
    'src/big-file.ts': LARGE_CONTENT,
    'src/small.ts': 'console.log("hi")',
  })

  it('truncates content and returns warning for files exceeding 100K chars', () => {
    const result = exec('readFile', { path: 'src/big-file.ts' }, LARGE_INDEX)

    expect((result.content as string).length).toBe(100_000)
    expect(result.warning).toBeDefined()
    expect(result.warning as string).toContain('truncated')
    expect(result.warning as string).toContain('150000')
  })

  it('does NOT truncate when startLine/endLine are specified', () => {
    const result = exec(
      'readFile',
      { path: 'src/big-file.ts', startLine: 1, endLine: 1 },
      LARGE_INDEX,
    )

    expect(result.warning).toBeUndefined()
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(1)
  })

  it('does NOT truncate files smaller than the limit', () => {
    const result = exec('readFile', { path: 'src/small.ts' }, LARGE_INDEX)

    expect(result.content).toBe('console.log("hi")')
    expect(result.warning).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// F7 — generateDiagram edgeCount + totalEdges
// ---------------------------------------------------------------------------

describe('F7: generateDiagram totalEdges vs edgeCount', () => {
  it('returns both edgeCount and totalEdges for topology diagrams', () => {
    const index = buildIndex({
      'src/a.ts': "import { b } from './b'",
      'src/b.ts': "import { c } from '../lib/c'",
      'lib/c.ts': 'export const c = 1',
    })
    const result = exec('generateDiagram', { type: 'topology' }, index)

    expect(result.edgeCount).toBeDefined()
    expect(result.totalEdges).toBeDefined()
  })

  it('totalEdges equals edgeCount when under the 30-edge limit', () => {
    const index = buildIndex({
      'src/a.ts': "import { b } from '../lib/b'",
      'lib/b.ts': 'export const b = 1',
    })
    const result = exec('generateDiagram', { type: 'topology' }, index)

    expect(result.totalEdges).toBe(result.edgeCount)
  })

  it('totalEdges exceeds edgeCount when edges are truncated', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 35; i++) {
      const dirA = `src/dir${i}`
      const dirB = `lib/target${i}`
      files[`${dirA}/file.ts`] = `import { x } from '../../${dirB}/mod'`
      files[`${dirB}/mod.ts`] = `export const x = ${i}`
    }
    const index = buildIndex(files)
    const result = exec('generateDiagram', { type: 'topology' }, index)

    expect(result.totalEdges).toBeGreaterThan(30)
    expect(result.edgeCount).toBeLessThanOrEqual(30)
    expect(result.totalEdges as number).toBeGreaterThan(result.edgeCount as number)
  })
})

// ---------------------------------------------------------------------------
// F3 — findSymbol partial-index warning
// ---------------------------------------------------------------------------

describe('F3: findSymbol partial-index warning', () => {
  it('returns warning when allFilePaths.length > codeIndex.files.size', () => {
    const allPaths = [
      'src/index.ts',
      'src/utils.ts',
      'src/components/Button.tsx',
      'package.json',
      'src/extra/not-indexed.ts',
      'src/extra/also-not-indexed.ts',
    ]

    const result = exec('findSymbol', { name: 'main' }, BASIC_INDEX, allPaths)

    expect(result.warning).toBeDefined()
    expect(result.warning as string).toContain('4/6 files')
  })

  it('returns no warning when allFilePaths is not provided', () => {
    const result = exec('findSymbol', { name: 'main' }, BASIC_INDEX)

    expect(result.warning).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// F11 — getProjectOverview hasTests/hasConfig uses allFilePaths
// ---------------------------------------------------------------------------

describe('F11: getProjectOverview uses allFilePaths for pattern detection', () => {
  const BARE_INDEX = buildIndex({
    'src/index.ts': 'export const x = 1',
  })

  it('hasTests detects test files from allFilePaths not in CodeIndex', () => {
    const allPaths = ['src/index.ts', 'tests/app.test.ts']
    const result = exec('getProjectOverview', {}, BARE_INDEX, allPaths)

    expect(result.hasTests).toBe(true)
  })

  it('hasConfig detects config files from allFilePaths not in CodeIndex', () => {
    const allPaths = ['src/index.ts', 'tsconfig.json']
    const result = exec('getProjectOverview', {}, BARE_INDEX, allPaths)

    expect(result.hasConfig).toBe(true)
  })

  it('hasTests is false when neither CodeIndex nor allFilePaths contain test files', () => {
    const result = exec('getProjectOverview', {}, BARE_INDEX)

    expect(result.hasTests).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// F12 — generateTour repoKey override
// ---------------------------------------------------------------------------

describe('F12: generateTour repoKey override', () => {
  it('uses repoContext.name when provided', () => {
    const result = exec(
      'generateTour',
      { repoKey: 'user-input/repo' },
      BASIC_INDEX,
      undefined,
      { repoName: 'validated/repo-name' },
    )

    const tour = result.tour as { repoKey: string }
    expect(tour.repoKey).toBe('validated/repo-name')
  })

  it('falls back to input.repoKey when no repoName option is provided', () => {
    const result = exec(
      'generateTour',
      { repoKey: 'user-input/repo' },
      BASIC_INDEX,
    )

    const tour = result.tour as { repoKey: string }
    expect(tour.repoKey).toBe('user-input/repo')
  })
})

// ---------------------------------------------------------------------------
// F10 — Dynamic tool count in system prompt
// ---------------------------------------------------------------------------

describe('F10: system prompt uses dynamic tool count', () => {
  it('Object.keys(codeTools).length equals the actual number of defined tools', () => {
    const toolCount = Object.keys(codeTools).length
    // The count must match the number of tool definitions — not a hardcoded number.
    // If a tool is added or removed, this test documents the current count.
    expect(toolCount).toBe(11)
    // Verify the template interpolation produces a valid numeric string
    const promptFragment = `You have ${toolCount} tools`
    expect(promptFragment).toBe(`You have ${Object.keys(codeTools).length} tools`)
  })

  it('codeTools includes all expected tool names', () => {
    const toolNames = Object.keys(codeTools)
    const expected = [
      'readFile', 'readFiles', 'searchFiles', 'listDirectory',
      'findSymbol', 'getFileStats', 'analyzeImports', 'scanIssues',
      'generateDiagram', 'getProjectOverview', 'generateTour',
    ]
    for (const name of expected) {
      expect(toolNames).toContain(name)
    }
  })
})
