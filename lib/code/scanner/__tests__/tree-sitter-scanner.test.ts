import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IndexedFile } from '@/lib/code/code-index'

// Mock the tree-sitter module before importing the scanner
vi.mock('@/lib/parsers/tree-sitter', () => ({
  initTreeSitter: vi.fn().mockResolvedValue(undefined),
  getLanguageForFile: vi.fn((path: string) => {
    if (path.endsWith('.py')) return 'python'
    if (path.endsWith('.java')) return 'java'
    if (path.endsWith('.go')) return 'go'
    if (path.endsWith('.rs')) return 'rust'
    if (path.endsWith('.rb')) return 'ruby'
    return undefined
  }),
  parseFile: vi.fn(),
  queryTree: vi.fn(),
}))

import { scanWithTreeSitter } from '@/lib/code/scanner/tree-sitter-scanner'
import { initTreeSitter, parseFile, queryTree, getLanguageForFile } from '@/lib/parsers/tree-sitter'

const mockedInitTreeSitter = vi.mocked(initTreeSitter)
const mockedParseFile = vi.mocked(parseFile)
const mockedQueryTree = vi.mocked(queryTree)
const mockedGetLanguageForFile = vi.mocked(getLanguageForFile)

function makeFile(content: string): IndexedFile {
  return {
    content,
    language: 'python',
    path: 'test.py',
    size: content.length,
  } as unknown as IndexedFile
}

function makeFakeTree() {
  return { delete: vi.fn() } as unknown as import('web-tree-sitter').Tree
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: parseFile returns a fake tree, queryTree returns empty
  mockedParseFile.mockResolvedValue(makeFakeTree())
  mockedQueryTree.mockResolvedValue([])
})

describe('scanWithTreeSitter', () => {
  it('returns empty array for empty file map', async () => {
    const result = await scanWithTreeSitter(new Map())
    expect(result).toEqual([])
  })

  it('skips files with unsupported languages', async () => {
    const files = new Map<string, IndexedFile>()
    files.set('readme.md', makeFile('# Hello'))
    files.set('data.csv', makeFile('a,b,c'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
    expect(mockedInitTreeSitter).not.toHaveBeenCalled()
  })

  it('skips vendored files (node_modules, vendor, dist)', async () => {
    const files = new Map<string, IndexedFile>()
    files.set('node_modules/lib/main.py', makeFile('eval(x)'))
    files.set('vendor/util.py', makeFile('eval(x)'))
    files.set('dist/bundle.py', makeFile('eval(x)'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
    expect(mockedInitTreeSitter).not.toHaveBeenCalled()
  })

  it('skips files exceeding MAX_FILE_SIZE', async () => {
    const bigContent = 'x'.repeat(600_000) // > 512KB
    const files = new Map<string, IndexedFile>()
    files.set('huge.py', makeFile(bigContent))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
  })

  it('handles init failure gracefully (returns empty, no throw)', async () => {
    mockedInitTreeSitter.mockRejectedValueOnce(new Error('WASM load failed'))

    const files = new Map<string, IndexedFile>()
    files.set('app.py', makeFile('eval(x)'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
  })

  it('handles parse failure gracefully (continues to next file)', async () => {
    mockedParseFile.mockRejectedValueOnce(new Error('Parse error'))

    const files = new Map<string, IndexedFile>()
    files.set('bad.py', makeFile('!!!invalid'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
  })

  it('handles parseFile returning null', async () => {
    mockedParseFile.mockResolvedValueOnce(null as unknown as import('web-tree-sitter').Tree)

    const files = new Map<string, IndexedFile>()
    files.set('empty.py', makeFile('# empty'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
  })

  it('produces valid CodeIssue objects with correct fields', async () => {
    const fakeNode = {
      text: 'eval',
      startPosition: { row: 4, column: 0 },
      namedChildren: [],
    }

    mockedQueryTree.mockResolvedValue([
      { captures: { fn: [fakeNode] } },
    ] as unknown[])

    const pyContent = 'import os\n\n\ndef run():\n    eval(x)\n'
    const files = new Map<string, IndexedFile>()
    files.set('src/app.py', makeFile(pyContent))

    const result = await scanWithTreeSitter(files)

    expect(result.length).toBeGreaterThan(0)
    const issue = result[0]

    // Required CodeIssue fields
    expect(issue.id).toBeTruthy()
    expect(issue.ruleId).toMatch(/^ts-/)
    expect(issue.category).toBeTruthy()
    expect(issue.severity).toBeTruthy()
    expect(issue.title).toBeTruthy()
    expect(issue.description).toBeTruthy()
    expect(issue.file).toBe('src/app.py')
    expect(issue.line).toBe(5) // row 4 + 1
    expect(typeof issue.column).toBe('number')
    expect(typeof issue.snippet).toBe('string')
  })

  it('calls tree.delete() after processing each file', async () => {
    const fakeTree = makeFakeTree()
    mockedParseFile.mockResolvedValue(fakeTree)

    const files = new Map<string, IndexedFile>()
    files.set('a.py', makeFile('pass'))

    await scanWithTreeSitter(files)

    expect(fakeTree.delete).toHaveBeenCalledTimes(1)
  })

  it('calls tree.delete() even when query throws', async () => {
    const fakeTree = makeFakeTree()
    mockedParseFile.mockResolvedValue(fakeTree)
    mockedQueryTree.mockRejectedValue(new Error('Bad query'))

    const files = new Map<string, IndexedFile>()
    files.set('a.py', makeFile('pass'))

    const result = await scanWithTreeSitter(files)
    expect(result).toEqual([])
    expect(fakeTree.delete).toHaveBeenCalledTimes(1)
  })

  it('applies MAX_PER_RULE cap (15 max per rule per file)', async () => {
    // Generate 20 matches for one rule
    const manyMatches = Array.from({ length: 20 }, (_, i) => ({
      captures: {
        fn: [{
          text: 'eval',
          startPosition: { row: i, column: 0 },
          namedChildren: [],
        }],
      },
    }))

    mockedQueryTree.mockResolvedValue(manyMatches as unknown[])

    const files = new Map<string, IndexedFile>()
    const lines = Array.from({ length: 25 }, () => 'eval(x)')
    files.set('many.py', makeFile(lines.join('\n')))

    const result = await scanWithTreeSitter(files)

    // Count issues for any single rule
    const countByRule = new Map<string, number>()
    for (const issue of result) {
      countByRule.set(issue.ruleId, (countByRule.get(issue.ruleId) ?? 0) + 1)
    }

    for (const [, count] of countByRule) {
      expect(count).toBeLessThanOrEqual(15)
    }
  })

  it('deduplicates issues by id (same rule + file + line)', async () => {
    // Two matches at the same line should generate same id
    const duplicateMatches = [
      {
        captures: {
          fn: [{
            text: 'eval',
            startPosition: { row: 0, column: 0 },
            namedChildren: [],
          }],
        },
      },
      {
        captures: {
          fn: [{
            text: 'eval',
            startPosition: { row: 0, column: 5 },
            namedChildren: [],
          }],
        },
      },
    ]

    mockedQueryTree.mockResolvedValue(duplicateMatches as unknown[])

    const files = new Map<string, IndexedFile>()
    files.set('dup.py', makeFile('eval(x); eval(y)'))

    const result = await scanWithTreeSitter(files)

    // Both matches produce the same issue id (same rule + file + line 1)
    // so only one should appear
    const ruleIds = result.filter(i => i.file === 'dup.py').map(i => i.id)
    const uniqueIds = new Set(ruleIds)
    expect(uniqueIds.size).toBe(ruleIds.length)
  })

  it('groups by language and does not call getLanguageForFile redundantly', async () => {
    const files = new Map<string, IndexedFile>()
    files.set('a.py', makeFile('pass'))
    files.set('b.py', makeFile('pass'))
    files.set('c.java', makeFile('class X {}'))

    await scanWithTreeSitter(files)

    // getLanguageForFile should be called once per file
    expect(mockedGetLanguageForFile).toHaveBeenCalledTimes(3)
    // initTreeSitter only once
    expect(mockedInitTreeSitter).toHaveBeenCalledTimes(1)
  })

  it('processes multiple languages in one scan', async () => {
    const fakeNode = (row: number) => ({
      text: 'exec',
      startPosition: { row, column: 0 },
      namedChildren: [],
    })

    mockedQueryTree.mockResolvedValue([
      { captures: { _fn: [fakeNode(0)] } },
    ] as unknown[])

    const files = new Map<string, IndexedFile>()
    files.set('app.py', makeFile('os.system("ls")'))
    files.set('Main.java', makeFile('runtime.exec("cmd")'))

    const result = await scanWithTreeSitter(files)

    const pyIssues = result.filter(i => i.file === 'app.py')
    const javaIssues = result.filter(i => i.file === 'Main.java')
    expect(pyIssues.length).toBeGreaterThan(0)
    expect(javaIssues.length).toBeGreaterThan(0)
  })

  it('issue id includes rule id, file path, and line', async () => {
    const fakeNode = {
      text: 'eval',
      startPosition: { row: 9, column: 0 },
      namedChildren: [],
    }

    mockedQueryTree.mockResolvedValue([
      { captures: { fn: [fakeNode] } },
    ] as unknown[])

    const lines = Array.from({ length: 15 }, () => 'pass')
    lines[9] = 'eval(x)'
    const files = new Map<string, IndexedFile>()
    files.set('src/util.py', makeFile(lines.join('\n')))

    const result = await scanWithTreeSitter(files)
    expect(result.length).toBeGreaterThan(0)

    const issue = result[0]
    expect(issue.id).toContain(issue.ruleId)
    expect(issue.id).toContain('src/util.py')
    expect(issue.id).toContain('10') // line = row 9 + 1
  })
})
