// Main analysis entry point — orchestrates all parsing phases.

import type { CodeIndex, ContentStore, IndexedFile } from '../code-index'
import { resolveFileContentBatches } from '../code-index'
import { throwIfAborted, yieldToEventLoop } from '../yield'
import type { FileAnalysis, DependencyGraph, FullAnalysis } from './types'
import { detectLang, detectPrimaryLanguage } from './utils'
import { extractImports } from './languages'
import { extractExports } from './extract-exports'
import { extractTypes, extractClasses, extractJsxComponents } from './extract-types'
import { detectCircularDeps } from './graph'
import { computeTopology } from './topology'
import { detectFramework } from './framework-detection'

const JS_TS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx'])

export interface AnalyzeOptions {
  /** Abort a superseded run; the promise rejects with the signal's reason. */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Phase-1 memo
// ---------------------------------------------------------------------------

interface MemoEntry {
  analysis: FileAnalysis
  path: string
  /** Inline source when analyzed; an in-place assignment (lazy/fetch fallback) misses. */
  content: string | undefined
  /** Store the source came from when it was not inline. */
  store: ContentStore
}

interface PhaseOneMemo {
  /** Import resolution depends on the whole indexed path set, so the memo is per set. */
  paths: Set<string>
  entries: WeakMap<IndexedFile, MemoEntry>
}

// Per-file results of the regex extractors, reused across re-analyses of the same
// repository. IndexedFile records are replaced, never edited, by indexFile,
// batchIndexFiles and renameFiles, so an unchanged record means unchanged source.
// The one in-place writer (RepositoryProvider.loadFileContent filling absent source)
// changes `content`, which the entry check catches. Entries hold no source beyond
// the record's own string and are collected with their IndexedFile. Reused
// FileAnalysis objects are shared between FullAnalysis results: treat them as
// immutable. Only analyzeCodebase uses the memo; analyzeCodebaseAsync's Tree-sitter
// results depend on runtime grammar availability.
// Trade-off: if the repo cache deletes an open repository's IndexedDB content, a
// re-analysis keeps the memoized results for unchanged records instead of failing
// with "Content unavailable"; the source they came from was valid when read.
let phaseOneMemo: PhaseOneMemo | null = null

/** Drop every memoized result and the indexed path set (repository reset or disconnect). */
export function resetAnalysisMemo(): void {
  phaseOneMemo = null
}

function memoForPaths(files: Map<string, IndexedFile>): PhaseOneMemo {
  const current = phaseOneMemo
  if (current && current.paths.size === files.size) {
    let samePaths = true
    for (const path of files.keys()) {
      if (!current.paths.has(path)) {
        samePaths = false
        break
      }
    }
    if (samePaths) return current
  }
  const next: PhaseOneMemo = { paths: new Set(files.keys()), entries: new WeakMap() }
  phaseOneMemo = next
  return next
}

function reusableAnalysis(
  entry: MemoEntry | undefined,
  path: string,
  file: IndexedFile,
  store: ContentStore,
): FileAnalysis | undefined {
  if (!entry || entry.path !== path || entry.content !== file.content) return undefined
  if (typeof file.content !== 'string' && entry.store !== store) return undefined
  return entry.analysis
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function analyzeCodebaseInternal(
  codeIndex: CodeIndex,
  enhanceNonJs: boolean,
  options: AnalyzeOptions = {},
): Promise<FullAnalysis> {
  const { signal } = options
  throwIfAborted(signal)
  const indexedPaths = new Set(codeIndex.files.keys())
  const missingPaths: string[] = []
  const asyncExtractors = enhanceNonJs ? await import('./extract-types') : null
  const memo = enhanceNonJs ? null : memoForPaths(codeIndex.files)
  const store = codeIndex.contentStore
  // A resident-only store can drop source it served before; never vouch for it.
  const memoizeStored = store?.bulkReadMode === 'complete'

  const reused = new Map<string, FileAnalysis>()
  const pendingPaths: string[] = []
  for (const [path, file] of codeIndex.files) {
    const hit = memo ? reusableAnalysis(memo.entries.get(file), path, file, store) : undefined
    if (hit) reused.set(path, hit)
    else pendingPaths.push(path)
  }

  // Analyze bounded source batches and retain only structural metadata. Source
  // strings from an IDB-backed repository become collectible after each batch.
  // Yield after every batch: inline batches otherwise resolve as microtasks and
  // the whole pass would run as one long task.
  const analyzed = new Map<string, FileAnalysis>()
  for await (const batch of resolveFileContentBatches(codeIndex, pendingPaths, { signal })) {
    missingPaths.push(...batch.missingPaths)
    for (const path of batch.paths) {
      const content = batch.contents.get(path)
      if (content === undefined) continue
      const lang = detectLang(path)
      const imports = extractImports(content, path, lang, indexedPaths)
      const exports = extractExports(content, lang)
      let types = extractTypes(content, lang)
      let classes = extractClasses(content, lang)
      const jsxComponents = extractJsxComponents(content, lang)

      if (asyncExtractors && !JS_TS_LANGS.has(lang)) {
        const [asyncTypes, asyncClasses] = await Promise.all([
          asyncExtractors.extractTypesAsync(content, lang),
          asyncExtractors.extractClassesAsync(content, lang),
        ])
        if (asyncTypes.length > types.length) types = asyncTypes
        if (asyncClasses.length > classes.length) classes = asyncClasses
      }

      const analysis: FileAnalysis = { path, imports, exports, types, classes, jsxComponents, language: lang }
      analyzed.set(path, analysis)
      const file = codeIndex.files.get(path)
      if (memo && file && (typeof file.content === 'string' || memoizeStored)) {
        memo.entries.set(file, { analysis, path, content: file.content, store })
      }
    }
    await yieldToEventLoop()
    throwIfAborted(signal)
  }

  if (missingPaths.length > 0) {
    throw new Error(`Content unavailable for indexed files: ${missingPaths.join(', ')}`)
  }

  // Keep index order regardless of which files came from the memo.
  const files = new Map<string, FileAnalysis>()
  for (const path of codeIndex.files.keys()) {
    const analysis = reused.get(path) ?? analyzed.get(path)
    if (analysis) files.set(path, analysis)
  }

  // Phase 2: Build dependency graph
  const edges = new Map<string, Set<string>>()
  const reverseEdges = new Map<string, Set<string>>()
  const externalDeps = new Map<string, Set<string>>()

  for (const [path, analysis] of files) {
    if (!edges.has(path)) edges.set(path, new Set())
    for (const imp of analysis.imports) {
      if (imp.isExternal) {
        const pkgName = imp.source.startsWith('@')
          ? imp.source.split('/').slice(0, 2).join('/')
          : imp.source.split('/')[0]
        if (!externalDeps.has(pkgName)) externalDeps.set(pkgName, new Set())
        externalDeps.get(pkgName)!.add(path)
      } else if (imp.resolvedPath) {
        edges.get(path)!.add(imp.resolvedPath)
        if (!reverseEdges.has(imp.resolvedPath)) reverseEdges.set(imp.resolvedPath, new Set())
        reverseEdges.get(imp.resolvedPath)!.add(path)
      }
    }
  }

  // Phase 3: Detect circular deps
  const circular = detectCircularDeps(edges)
  const graph: DependencyGraph = { edges, reverseEdges, circular, externalDeps }
  await yieldToEventLoop()
  throwIfAborted(signal)

  // Phase 4: Topology
  const allPaths = Array.from(files.keys())
  const topology = computeTopology(graph, allPaths)
  await yieldToEventLoop()
  throwIfAborted(signal)

  // Phase 5: Framework detection
  const detectedFramework = detectFramework(files, graph)
  const primaryLanguage = detectPrimaryLanguage(files)

  return { files, graph, topology, detectedFramework, primaryLanguage }
}

export async function analyzeCodebase(codeIndex: CodeIndex, options?: AnalyzeOptions): Promise<FullAnalysis> {
  return analyzeCodebaseInternal(codeIndex, false, options)
}

/**
 * Async variant of `analyzeCodebase` — enhances non-JS/TS files with
 * Tree-sitter–based type and class extraction for richer class diagrams.
 */
export async function analyzeCodebaseAsync(codeIndex: CodeIndex, options?: AnalyzeOptions): Promise<FullAnalysis> {
  return analyzeCodebaseInternal(codeIndex, true, options)
}
