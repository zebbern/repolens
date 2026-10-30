// Characterization: analyzeCodebase output is pinned for a mixed corpus and must
// stay identical for every index shape the app produces (inline, store-backed,
// edited, renamed, deleted) however the analyzer schedules or reuses its work.

import {
  batchIndexFiles,
  batchIndexMetadataOnly,
  createEmptyIndex,
  createEmptyIndexWithStore,
  indexFile,
  removeFromIndex,
  type CodeIndex,
  type ContentStore,
  type IndexedFile,
} from '../../code-index'
import { InMemoryContentStore, LazyContentStore } from '../../content-store'
import { FetchQueue } from '../../fetch-queue'
import { serializeFullAnalysis } from '../../scanner/serialization'
import { analyzeCodebase, resetAnalysisMemo } from '../analyzer'

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const CORE_FILES: Record<string, string> = {
  'app/dashboard/page.tsx': [
    "import { Header } from '@/components/header'",
    "import { useStore } from '../../src/store'",
    "import Link from 'next/link'",
    'export default function DashboardPage() {',
    '  const store = useStore()',
    '  return <main><Header title={store.title} /><Link href="/">Home</Link></main>',
    '}',
  ].join('\n'),
  'components/header.tsx': [
    "import React from 'react'",
    "import { Button } from './ui/button'",
    'export interface HeaderProps { title: string; subtitle?: string }',
    'export function Header({ title }: HeaderProps) {',
    '  return <header><h1>{title}</h1><Button label="menu" /></header>',
    '}',
  ].join('\n'),
  'components/ui/button.tsx': [
    "import { cn } from '@/lib/utils'",
    'export type ButtonVariant = "primary" | "ghost"',
    'export const Button = ({ label }: { label: string }) => <button className={cn(label)}>{label}</button>',
  ].join('\n'),
  'components/ui/index.ts': [
    "export * from './button'",
    "export { Header } from '../header'",
  ].join('\n'),
  'lib/utils.ts': [
    "import { clsx } from 'clsx'",
    "import { twMerge } from 'tailwind-merge'",
    'export function cn(...inputs: string[]) { return twMerge(clsx(inputs)) }',
    'export const VERSION = 2',
    'export enum Mode { Light, Dark }',
  ].join('\n'),
  'src/store.ts': [
    "import { create } from 'zustand'",
    "import type { User } from './models/user'",
    "import { formatUser } from './format'",
    'export interface StoreState { title: string; user?: User }',
    'export const useStore = create<StoreState>(() => ({ title: formatUser(null) }))',
  ].join('\n'),
  'src/format.ts': [
    "import { useStore } from './store'",
    "import { missing } from './not-yet-there'",
    'export function formatUser(u: unknown) { return String(u ?? useStore) + missing }',
  ].join('\n'),
  'src/models/user.ts': [
    'export interface User extends Base { id: string; name: string }',
    'interface Base { createdAt: number }',
    'export abstract class Repository<T> { abstract find(id: string): T; save(item: T) {} }',
    'export class UserRepository extends Repository<User> implements Disposable {',
    '  private cache = new Map()',
    '  find(id: string) { return this.cache.get(id) }',
    '  dispose() {}',
    '}',
  ].join('\n'),
  'src/legacy.js': [
    "const path = require('path')",
    "const helper = require('./helper')",
    'module.exports = { run: () => helper(path.sep) }',
  ].join('\n'),
  'src/helper.js': [
    'export default function helper(sep) { return sep }',
  ].join('\n'),
  'server/app.py': [
    'from flask import Flask',
    'from .services import user_service',
    'import os, json',
    'class AppFactory:',
    '    name: str',
    '    def create(self):',
    '        return Flask(__name__)',
  ].join('\n'),
  'server/services/user_service.py': [
    'from ..models import User',
    '@dataclass',
    'class UserService:',
    '    repo: object',
    '    def get(self, uid): return User(uid)',
  ].join('\n'),
  'server/services/__init__.py': 'from . import user_service',
  'server/models.py': [
    'class User:',
    '    def __init__(self, uid): self.uid = uid',
  ].join('\n'),
  'cmd/main.go': [
    'package main',
    'import (',
    '  "fmt"',
    '  "github.com/acme/app/internal/api"',
    ')',
    'type Server struct { Port int }',
    'func main() { fmt.Println(api.Version) }',
  ].join('\n'),
  'internal/api/api.go': [
    'package api',
    'import "net/http"',
    'const Version = "1"',
    'type Handler interface { Serve(w http.ResponseWriter) }',
  ].join('\n'),
  'README.md': '# Fixture\n\nNot code.',
  'package.json': '{ "name": "fixture", "dependencies": { "next": "16.0.0" } }',
}

/** Generated modules: a chain plus a shared hub, enough files to span several batches. */
function generatedFiles(count: number): Record<string, string> {
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const lines = [`import { cn } from '@/lib/utils'`]
    if (i > 0) lines.push(`import { mod${i - 1} } from './mod${i - 1}'`)
    if (i % 7 === 0) lines.push(`import { Header } from '../../components/header'`)
    if (i % 11 === 0) lines.push(`import lodash from 'lodash/fp'`)
    lines.push(`export function mod${i}() { return cn('m${i}') }`)
    if (i % 5 === 0) lines.push(`export class Service${i} { run() { return ${i} } }`)
    if (i % 9 === 0) lines.push(`export type Shape${i} = { id: ${i} }`)
    files[`src/gen/mod${i}.ts`] = lines.join('\n')
  }
  return files
}

const CORPUS: Record<string, string> = { ...CORE_FILES, ...generatedFiles(130) }

// ---------------------------------------------------------------------------
// Index builders
// ---------------------------------------------------------------------------

function inlineIndex(files: Record<string, string>): CodeIndex {
  return batchIndexFiles(createEmptyIndex(), Object.entries(files).map(([path, content]) => ({ path, content })))
}

/** Fresh objects, fresh store: the reference an analysis must equal. */
function freshReference(index: CodeIndex, contents: Record<string, string>): CodeIndex {
  return inlineIndex(Object.fromEntries([...index.files.keys()].map(path => [path, contents[path]])))
}

/** IDB-like store: async getBatch on a macrotask, content kept out of IndexedFile. */
class SlowStore implements ContentStore {
  readonly bulkReadMode = 'complete' as const
  readonly source = new Map<string, string>()
  readonly batchCalls: string[][] = []

  async get(path: string) { return this.source.get(path) ?? null }
  getSync() { return null }
  async getBatch(paths: string[]) {
    this.batchCalls.push([...paths])
    await new Promise(resolve => setTimeout(resolve, 0))
    return new Map(paths.flatMap(path => {
      const value = this.source.get(path)
      return value === undefined ? [] : [[path, value] as [string, string]]
    }))
  }
  put(path: string, content: string) { this.source.set(path, content) }
  putBatch(entries: Array<{ path: string; content: string }>) {
    for (const { path, content } of entries) this.source.set(path, content)
  }
  has(path: string) { return this.source.has(path) }
  delete(path: string) { this.source.delete(path) }
  async flush() {}
  async clear() { this.source.clear() }
  get size() { return this.source.size }
}

function storeBackedIndex(files: Record<string, string>): { index: CodeIndex; store: SlowStore } {
  const store = new SlowStore()
  const index = batchIndexFiles(
    createEmptyIndexWithStore(store),
    Object.entries(files).map(([path, content]) => ({ path, content })),
    { retainContent: false },
  )
  return { index, store }
}

/** Mirrors RepositoryProvider.renameFiles: re-keyed files are new objects carrying their source. */
function renameInIndex(index: CodeIndex, from: string, to: string, content: string): CodeIndex {
  const files = new Map(index.files)
  const meta = new Map(index.meta)
  const file = files.get(from)!
  const fileMeta = meta.get(from)
  files.delete(from)
  meta.delete(from)
  const name = to.split('/').pop() || to
  files.set(to, { ...file, path: to, name, content })
  if (fileMeta) meta.set(to, { ...fileMeta, path: to, name })
  index.contentStore.delete(from)
  index.contentStore.put(to, content)
  return { ...index, files, meta }
}

async function analyzed(index: CodeIndex) {
  return serializeFullAnalysis(await analyzeCodebase(index))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeCodebase golden output', () => {
  it('matches the stored reference for the core corpus', async () => {
    // KNOWN BUG pinned here (pre-existing; docs/improvements/core-correctness-and-bugs.md):
    // Python relative imports (`.services`, `..models`, `.`) resolve to null because
    // languages/python.ts passes the dotted module to the JS-style resolver. Fixing it
    // changes this snapshot on purpose — update it then.
    expect(await analyzed(inlineIndex(CORE_FILES))).toMatchSnapshot()
  })

  it('matches the stored reference digest for the full corpus', async () => {
    const result = await analyzed(inlineIndex(CORPUS))
    expect({
      fileOrder: result.files.map(([path]) => path),
      edgeCount: result.graph.edges.reduce((sum, [, targets]) => sum + targets.length, 0),
      circular: result.graph.circular,
      externalDeps: result.graph.externalDeps,
      topology: result.topology,
      detectedFramework: result.detectedFramework,
      primaryLanguage: result.primaryLanguage,
    }).toMatchSnapshot()
  })

  it('produces the same output for an inline index and an IDB-like store', async () => {
    const reference = await analyzed(inlineIndex(CORPUS))
    const { index, store } = storeBackedIndex(CORPUS)
    expect([...index.files.values()].every(file => file.content === undefined)).toBe(true)

    expect(await analyzed(index)).toStrictEqual(reference)
    expect(store.batchCalls.length).toBeGreaterThan(1)
  })

  it('stays equal to a fresh analysis across edits, renames, additions and deletions', async () => {
    const contents = { ...CORPUS }
    let index = inlineIndex(contents)
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // 1. Single edit that changes imports, exports and types.
    contents['src/store.ts'] = [
      "import { create } from 'zustand'",
      "import { cn } from '@/lib/utils'",
      'export type Title = string',
      'export const useStore = create(() => ({ title: cn("x") }))',
    ].join('\n')
    index = indexFile(index, 'src/store.ts', contents['src/store.ts'])
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // 2. Batch edit of several files at once.
    const batch = ['src/gen/mod3.ts', 'src/gen/mod77.ts', 'server/models.py'].map(path => {
      contents[path] = `${contents[path]}\nexport const edited = '${path}'`
      return { path, content: contents[path] }
    })
    index = batchIndexFiles(index, batch)
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // 3. Rename: importers of the old path stop resolving, the new path is a new node.
    contents['src/formatting.ts'] = contents['src/format.ts']
    delete contents['src/format.ts']
    index = renameInIndex(index, 'src/format.ts', 'src/formatting.ts', contents['src/formatting.ts'])
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // 4. Adding a file makes a previously unresolved import resolve.
    contents['src/not-yet-there.ts'] = 'export const missing = 1'
    index = indexFile(index, 'src/not-yet-there.ts', contents['src/not-yet-there.ts'])
    const afterAdd = await analyzed(index)
    expect(afterAdd).toStrictEqual(await analyzed(freshReference(index, contents)))
    const formatting = afterAdd.files.find(([path]) => path === 'src/formatting.ts')![1]
    expect(formatting.imports.find(imp => imp.source === './not-yet-there')?.resolvedPath).toBe('src/not-yet-there.ts')

    // 5. Deleting a hub file unresolves its importers.
    delete contents['lib/utils.ts']
    index = removeFromIndex(index, 'lib/utils.ts')
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // 6. Same path set again (the delete reverted) must not reuse stale resolution.
    contents['lib/utils.ts'] = CORPUS['lib/utils.ts']
    index = indexFile(index, 'lib/utils.ts', contents['lib/utils.ts'])
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))
  })

  it('reflects source assigned in place to an existing IndexedFile', async () => {
    const contents = { ...CORE_FILES }
    const index = inlineIndex(contents)
    await analyzed(index)

    // RepositoryProvider.loadFileContent writes fetched source onto the existing object.
    contents['src/helper.js'] = "import { cn } from '@/lib/utils'\nexport class Late {}"
    const file = index.files.get('src/helper.js') as IndexedFile
    file.content = contents['src/helper.js']
    index.contentStore.put('src/helper.js', contents['src/helper.js'])

    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))
  })

  it('stays equal to a fresh analysis across edits on the IDB-like tier', async () => {
    const contents = { ...CORPUS }
    const { index: initial } = storeBackedIndex(contents)
    let index = initial
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    contents['components/header.tsx'] = `${contents['components/header.tsx']}\nexport class Late {}`
    index = batchIndexFiles(index, [{ path: 'components/header.tsx', content: contents['components/header.tsx'] }], { retainContent: false })
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    contents['src/gen/mod9.ts'] = `${contents['src/gen/mod9.ts']}\nexport interface Added { ok: true }`
    index = indexFile(index, 'src/gen/mod9.ts', contents['src/gen/mod9.ts'])
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))

    // The provider's fetch fallback fills a content-less record in place.
    contents['src/legacy.js'] = "const fs = require('fs')\nmodule.exports = fs"
    const legacy = index.files.get('src/legacy.js') as IndexedFile
    legacy.content = contents['src/legacy.js']
    index.contentStore.put('src/legacy.js', contents['src/legacy.js'])
    expect(await analyzed(index)).toStrictEqual(await analyzed(freshReference(index, contents)))
  })

  it('rejects an on-demand index with the same missing paths every time, without fetching', async () => {
    const fetchFile = vi.fn(async (path: string) => CORE_FILES[path] ?? '')
    const store = new LazyContentStore('owner/repo', new FetchQueue({ fetchFn: fetchFile }))
    const paths = ['src/store.ts', 'src/format.ts', 'lib/utils.ts']
    store.registerPaths(paths)
    let index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), paths.map(path => ({ path, lineCount: 1 })))
    // One file is resident (loaded through the code browser), two are not.
    index = indexFile(index, 'lib/utils.ts', CORE_FILES['lib/utils.ts'])

    const message = 'Content unavailable for indexed files: src/store.ts, src/format.ts'
    await expect(analyzeCodebase(index)).rejects.toThrow(message)
    await expect(analyzeCodebase(index)).rejects.toThrow(message)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('analyzes an in-memory store whose records carry no inline source', async () => {
    const store = new InMemoryContentStore(new Map(Object.entries(CORE_FILES)))
    const files = new Map<string, IndexedFile>(Object.keys(CORE_FILES).map(path => [
      path,
      { path, name: path.split('/').pop()!, lineCount: 1 },
    ]))
    const index: CodeIndex = { ...createEmptyIndexWithStore(store), files, totalFiles: files.size }
    expect(await analyzed(index)).toStrictEqual(await analyzed(inlineIndex(CORE_FILES)))
  })
})

describe('analyzeCodebase scheduling and reuse', () => {
  it('yields to the event loop while analyzing an in-memory index', async () => {
    // A macrotask queued before the run can only execute before the run settles
    // if the analysis yields; inline batches otherwise resolve as microtasks.
    const index = inlineIndex(CORPUS)
    let macrotaskRan = false
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      macrotaskRan = true
      channel.port1.close()
    }
    channel.port2.postMessage(null)
    const ranBeforeSettled = await analyzeCodebase(index).then(() => macrotaskRan)
    expect(ranBeforeSettled).toBe(true)
  })

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(analyzeCodebase(inlineIndex(CORE_FILES), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops reading batches once a running analysis is aborted', async () => {
    const { index, store } = storeBackedIndex(CORPUS)
    const controller = new AbortController()
    const run = analyzeCodebase(index, { signal: controller.signal })
    await vi.waitFor(() => expect(store.batchCalls.length).toBeGreaterThan(0))
    controller.abort()

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.batchCalls.length).toBeLessThan(Math.ceil(index.files.size / 50))
  })

  it('reuses per-file results and re-reads only edited files on the IDB-like tier', async () => {
    const contents = { ...CORPUS }
    const { index: initial, store } = storeBackedIndex(contents)
    const first = await analyzeCodebase(initial)

    contents['src/gen/mod42.ts'] = `${contents['src/gen/mod42.ts']}\nexport const edited = true`
    const edited = batchIndexFiles(initial, [{ path: 'src/gen/mod42.ts', content: contents['src/gen/mod42.ts'] }], { retainContent: false })
    store.batchCalls.length = 0
    const second = await analyzeCodebase(edited)

    expect(store.batchCalls).toEqual([['src/gen/mod42.ts']])
    expect(second.files.get('src/store.ts')).toBe(first.files.get('src/store.ts'))
    expect(second.files.get('src/gen/mod42.ts')).not.toBe(first.files.get('src/gen/mod42.ts'))
    expect(serializeFullAnalysis(second)).toStrictEqual(await analyzed(freshReference(edited, contents)))
  })

  it('forgets per-file results after resetAnalysisMemo (repository reset or disconnect)', async () => {
    const { index, store } = storeBackedIndex({ ...CORPUS })
    await analyzeCodebase(index)

    resetAnalysisMemo()
    store.batchCalls.length = 0
    await analyzeCodebase(index)

    expect(store.batchCalls.flat().sort()).toEqual(Object.keys(CORPUS).sort())
  })

  it('does not reuse results across a changed path set', async () => {
    const index = inlineIndex(CORE_FILES)
    const first = await analyzeCodebase(index)
    const grown = indexFile(index, 'src/extra.ts', 'export const extra = 1')
    const second = await analyzeCodebase(grown)
    expect(second.files.get('src/store.ts')).not.toBe(first.files.get('src/store.ts'))
    expect(second.files.get('src/store.ts')).toStrictEqual(first.files.get('src/store.ts'))
  })
})
