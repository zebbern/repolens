// Characterization: the repository-wide AI tools (findSymbol, analyzeImports,
// generateDiagram topology/import-graph, generateTour) must return exactly these
// outputs for inline and store-backed indexes, however their scans are scheduled.

import { describe, it, expect } from 'vitest'
import {
  batchIndexFiles,
  createEmptyIndex,
  createEmptyIndexWithStore,
  type CodeIndex,
  type ContentStore,
} from '@/lib/code/code-index'
import { executeToolLocally } from '../client-tool-executor'

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function corpus(): Record<string, string> {
  const files: Record<string, string> = {
    'README.md': '# Readme\nexport is not code here',
    'package.json': '{ "name": "fixture" }',
    'src/index.ts': [
      "import { hub } from './core/hub'",
      "import { Widget } from '@/src/ui/widget'",
      'export function main() { return hub(Widget) }',
      'export const VERSION = 1',
    ].join('\n'),
    'src/core/hub.ts': [
      'export function hub(x: unknown) { return x }',
      'export interface Widget { id: string }',
      'export type Shape = { kind: string }',
      'export enum Mode { A, B }',
      'export const handler = async () => hub(1)',
    ].join('\n'),
    'src/core/index.ts': "export * from './hub'\nexport { hub as default } from './hub'",
    'src/ui/widget.tsx': [
      "import { hub } from '../core/hub'",
      'export class Widget { render() { return hub(this) } }',
      'export interface WidgetProps { label: string }',
      'export function HANDLER() {}',
    ].join('\n'),
    'src/ui/layout.tsx': [
      "import { Widget } from './widget'",
      "import config from '../config'",
      'export default function Layout() { return Widget }',
      'export class Config {}',
    ].join('\n'),
    'src/config.ts': 'export interface Config { debug: boolean }\nexport const config = { debug: false }',
    'src/legacy.js': "const hub = require('./core/hub')\nmodule.exports = function handler() { return hub }",
    'src/core/hub.test.ts': "import { hub } from './hub'\ndescribe('hub', () => { it('works', () => hub(1)) })",
    'src/__tests__/widget.spec.ts': "import { Widget } from '../ui/widget'\nexport function handler() {}",
    'app/page.tsx': "import Layout from '@/src/ui/layout'\nexport default function Page() { return Layout }",
    'app/main.ts': 'export function boot() {}\nexport function stop() {}',
    'server/app.py': 'from .models import User\nimport server.util\nclass App:\n    def handler(self): pass',
    'server/models.py': 'class User:\n    pass\ndef handler():\n    pass',
    'server/util.py': 'def helper():\n    pass',
    'server/__init__.py': '',
    'cmd/main.go': 'package main\nimport "fmt"\nfunc main() { fmt.Println("x") }',
  }
  // Many importers of the hub (more than the 30-entry importedBy cap) and many
  // `handler` declarations (more than the 20-result findSymbol cap).
  for (let i = 0; i < 40; i++) {
    const importLine = i % 3 === 0
      ? "import { hub } from '../core/hub'"
      : i % 3 === 1
        ? "export { hub } from '@/src/core/hub'"
        : "const { hub } = require('../core/hub')"
    files[`src/feature/f${i}.ts`] = [
      importLine,
      i % 2 === 0 ? `export function handler() { return ${i} }` : `export const handler = (n: number) => n + ${i}`,
      i % 4 === 0 ? `export class Feature${i} {}` : `export type Feature${i} = { n: ${i} }`,
      ...Array.from({ length: i % 5 }, (_, line) => `export const value${line} = ${line}`),
    ].join('\n')
  }
  return files
}

function inlineIndex(files: Record<string, string>): CodeIndex {
  return batchIndexFiles(createEmptyIndex(), Object.entries(files).map(([path, content]) => ({ path, content })))
}

/** IDB-like store: async getBatch on a macrotask and no inline source. */
function storeIndex(files: Record<string, string>, unavailable: string[] = []): CodeIndex {
  const source = new Map(Object.entries(files).filter(([path]) => !unavailable.includes(path)))
  const store: ContentStore = {
    bulkReadMode: 'complete',
    get: async path => source.get(path) ?? null,
    getSync: () => null,
    getBatch: async paths => {
      await new Promise(resolve => setTimeout(resolve, 0))
      return new Map(paths.flatMap(path => {
        const value = source.get(path)
        return value === undefined ? [] : [[path, value] as [string, string]]
      }))
    },
    put: () => {},
    putBatch: () => {},
    has: path => source.has(path),
    delete: () => {},
    flush: async () => {},
    clear: async () => {},
    size: source.size,
  }
  const index = batchIndexFiles(
    createEmptyIndexWithStore(store),
    Object.entries(files).map(([path, content]) => ({ path, content })),
    { retainContent: false },
  )
  return index
}

async function run(tool: string, input: Record<string, unknown>, index: CodeIndex, allFilePaths?: string[]) {
  return JSON.parse(await executeToolLocally(tool, input, index, allFilePaths)) as Record<string, unknown>
}

/** Tour ids and timestamps are random; everything else is the characterized output. */
function stableTour(output: Record<string, unknown>) {
  const tour = output.tour as { stops: Array<Record<string, unknown>> } & Record<string, unknown> | undefined
  if (!tour) return output
  return {
    ...output,
    tour: {
      ...tour,
      id: '<id>',
      createdAt: '<time>',
      updatedAt: '<time>',
      stops: tour.stops.map(stop => ({ ...stop, id: '<id>' })),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FIND_SYMBOL_CASES: Array<Record<string, unknown>> = [
  { name: 'handler' },
  { name: 'HANDLER' },
  { name: 'handler', kind: 'function' },
  { name: 'handler', kind: 'class' },
  { name: 'Widget' },
  { name: 'widget', kind: 'class' },
  { name: 'Widget', kind: 'interface' },
  { name: 'Config', kind: 'any' },
  { name: 'Shape', kind: 'type' },
  { name: 'Mode', kind: 'enum' },
  { name: 'Feature12' },
  { name: 'han' },
  { name: 'zzNoSuchSymbolZz' },
]

describe('findSymbol characterization', () => {
  it.each(FIND_SYMBOL_CASES)('returns the pinned result for %o', async input => {
    const files = corpus()
    const inline = await run('findSymbol', input, inlineIndex(files))
    expect(inline).toMatchSnapshot()
    expect(await run('findSymbol', input, storeIndex(files))).toStrictEqual(inline)
  })

  it('pins the partial-index and partial-content warnings', async () => {
    const files = corpus()
    const index = inlineIndex(files)
    const extraMeta = new Map(index.meta)
    extraMeta.set('src/not-indexed.ts', { path: 'src/not-indexed.ts', name: 'not-indexed.ts', lineCount: 3 })
    const allFilePaths = [...index.files.keys(), 'src/not-indexed.ts', 'src/also-missing.ts']

    expect(await run('findSymbol', { name: 'handler' }, { ...index, meta: extraMeta }, allFilePaths)).toMatchSnapshot()
    expect(await run(
      'findSymbol',
      { name: 'handler' },
      storeIndex(files, ['src/feature/f0.ts', 'src/feature/f39.ts', 'server/models.py']),
    )).toMatchSnapshot()
  })
})

describe('analyzeImports characterization', () => {
  it.each([
    'src/core/hub.ts',
    'core/hub.ts',
    'src/ui/widget.tsx',
    'server/models.py',
    'server/util.py',
    'src/config.ts',
    'cmd/main.go',
  ])('returns the pinned result for %s', async path => {
    const files = corpus()
    const inline = await run('analyzeImports', { path }, inlineIndex(files))
    expect(inline).toMatchSnapshot()
    expect(await run('analyzeImports', { path }, storeIndex(files))).toStrictEqual(inline)
  })

  it('pins reverse-lookup coverage when some importers are unavailable', async () => {
    const files = corpus()
    expect(await run(
      'analyzeImports',
      { path: 'src/core/hub.ts' },
      storeIndex(files, ['src/feature/f3.ts', 'src/feature/f30.ts']),
    )).toMatchSnapshot()
  })
})

describe('generateDiagram topology characterization', () => {
  it.each(['topology', 'import-graph'])('returns the pinned %s diagram', async type => {
    const files = corpus()
    const inline = await run('generateDiagram', { type }, inlineIndex(files))
    // KNOWN BUG pinned here (pre-existing; docs/improvements/core-correctness-and-bugs.md):
    // diagram nodes use raw unresolved specifiers ('./core', '../core', '.') and lossy
    // mermaid ids, so '@/src/ui' and './src/ui' collide. A fix changes this snapshot.
    expect(inline).toMatchSnapshot()
    expect(await run('generateDiagram', { type }, storeIndex(files))).toStrictEqual(inline)
  })

  it('pins the unavailable-content error', async () => {
    expect(await run('generateDiagram', { type: 'topology' }, storeIndex(corpus(), ['src/index.ts']))).toMatchSnapshot()
  })
})

describe('generateTour ranking characterization', () => {
  it.each([
    { repoKey: 'owner/repo' },
    { repoKey: 'owner/repo', maxStops: 3 },
    { repoKey: 'owner/repo', maxStops: 25 },
    { repoKey: 'owner/repo', theme: 'hub' },
    { repoKey: 'owner/repo', theme: 'widget', maxStops: 4 },
    { repoKey: 'owner/repo', theme: 'nothing-matches-this' },
  ])('returns the pinned stop order for %o', async input => {
    const files = corpus()
    const inline = stableTour(await run('generateTour', input, inlineIndex(files)))
    expect(inline).toMatchSnapshot()
    expect(stableTour(await run('generateTour', input, storeIndex(files)))).toStrictEqual(inline)
  })

  it('keeps index order among tied scores', async () => {
    // Every file scores the same, so a stable sort must keep insertion order.
    const files: Record<string, string> = {}
    for (const name of ['zeta', 'alpha', 'mid', 'beta', 'omega']) files[`lib/${name}.ts`] = 'export const x = 1'
    const output = await run('generateTour', { repoKey: 'r', maxStops: 5 }, inlineIndex(files))
    const stops = (output.tour as { stops: Array<{ filePath: string }> }).stops
    expect(stops.map(stop => stop.filePath)).toEqual(['lib/zeta.ts', 'lib/alpha.ts', 'lib/mid.ts', 'lib/beta.ts', 'lib/omega.ts'])
  })

  it('pins the unavailable-content error', async () => {
    expect(await run('generateTour', { repoKey: 'r' }, storeIndex(corpus(), ['app/main.ts']))).toMatchSnapshot()
  })
})
