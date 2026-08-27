// Code Index - Manages file content indexing for search and AI context

import type { FileNode, RepositoryCoverage } from '@/types/repository'
import { InMemoryContentStore, type ContentStore, type CodeIndexMeta } from './content-store'
import { matchesSearchPathFilter, type SearchPathFilter } from './search-path-filter'

/** Clone the content store for immutable CodeIndex updates (Wave 1: InMemoryContentStore only). */
function cloneContentStore(store: ContentStore): InMemoryContentStore {
  if (store instanceof InMemoryContentStore) {
    return new InMemoryContentStore(store.getAllSync())
  }
  throw new Error('Cannot clone non-InMemory ContentStore. Phase 3 Wave 2+ requires async content store operations.')
}

/** Count lines in content without allocating a temporary array. */
function countLines(content: string): number {
  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++
  }
  return count
}

export type { ContentStore, CodeIndexMeta } from './content-store'
export { InMemoryContentStore, IDBContentStore, LazyContentStore } from './content-store'

export interface IndexedFile {
  path: string
  name: string
  content?: string
  language?: string
  lineCount: number
  /** False only when metadata did not include a source-derived line count. */
  lineCountKnown?: boolean
}

const linesCache = new WeakMap<IndexedFile, string[]>()

export function getFileLines(file: IndexedFile): string[] {
  let lines = linesCache.get(file)
  if (!lines) {
    lines = typeof file.content === 'string' ? file.content.split('\n') : ['']
    linesCache.set(file, lines)
  }
  return lines
}

export function invalidateLinesCache(file: IndexedFile): void {
  linesCache.delete(file)
}

/** Async content access: tries in-memory `file.content` first, then falls back to contentStore. */
export async function getFileContent(index: CodeIndex, path: string): Promise<string | null> {
  const file = index.files.get(path)
  if (typeof file?.content === 'string') return file.content
  return index.contentStore.get(path)
}

/** Type guard: true when `file.content` is a string, including a loaded empty file. */
export function hasContent(file: IndexedFile): file is IndexedFile & { content: string } {
  return typeof file.content === 'string'
}

/** Sync content access: tries in-memory `file.content` first, then contentStore.getSync(). */
export function getFileContentSync(index: CodeIndex, path: string): string | null {
  const file = index.files.get(path)
  if (typeof file?.content === 'string') return file.content
  return index.contentStore.getSync(path)
}

/** Async version of getFileLines — resolves content from contentStore when not in-memory. */
export async function getFileLinesAsync(index: CodeIndex, path: string): Promise<string[] | null> {
  const content = await getFileContent(index, path)
  if (content == null) return null
  return content.split('\n')
}

export interface SearchResult {
  file: string
  language?: string
  matches: SearchMatch[]
}

export interface SearchMatch {
  line: number
  content: string
  column: number
  length: number
}

// Bound result memory while retaining enough matches for interactive search and AI context.
export const DEFAULT_SEARCH_MAX_MATCHES = 1_000
export const DEFAULT_SEARCH_MAX_MATCHES_PER_FILE = 100
const SEARCH_FILE_BATCH_SIZE = 50
const SEARCH_LINE_BATCH_SIZE = 250
const MAX_SEARCH_LINE_LENGTH = 200_000

function throwIfSearchAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

export interface SearchLimits {
  maxMatches?: number
  maxMatchesPerFile?: number
  /** Restrict the search domain inside the worker before content hydration and match limits. */
  pathFilter?: SearchPathFilter
  signal?: AbortSignal
}

export type SearchOptions = {
  caseSensitive?: boolean
  regex?: boolean
  wholeWord?: boolean
  /** Internal, reviewed scanner rules may bypass the user-pattern guard. */
  trusted?: boolean
} & SearchLimits

/** Async search retains the array API used by existing callers and exposes coverage metadata. */
export interface AsyncSearchResult extends Array<SearchResult> {
  results: SearchResult[]
  unsearchedPaths: string[]
  unavailablePaths: string[]
  truncated: boolean
}

export interface CodeIndex {
  files: Map<string, IndexedFile>
  totalFiles: number
  totalLines: number
  /** Files excluded from totalLines because their source-derived count is unavailable. */
  unknownLineCountFiles?: number
  isIndexing: boolean
  /** Phase 3: metadata-only records (no content). Populated alongside `files`. */
  meta: Map<string, CodeIndexMeta>
  /** Phase 3: content storage abstraction. InMemoryContentStore in Wave 1. */
  contentStore: ContentStore
  /** Repository-level discovery/loading truth for scanners, exports, and AI tools. */
  coverage?: RepositoryCoverage
}

export interface HydratedCodeIndex {
  index: CodeIndex
  missingPaths: string[]
}

export interface ResolvedFileContents {
  contents: Map<string, string>
  missingPaths: string[]
  residentOnly: boolean
}

export interface ResolvedFileContentBatch extends ResolvedFileContents {
  paths: string[]
}

export interface ResolveFileContentBatchOptions {
  batchSize?: number
  signal?: AbortSignal
}

export const DEFAULT_CONTENT_RESOLUTION_BATCH_SIZE = 50
export const MAX_CONTENT_RESOLUTION_BATCH_SIZE = 100

function throwIfContentResolutionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Content resolution cancelled', 'AbortError')
}

/**
 * Resolve source in bounded batches so consumers can process and release each
 * batch without materializing an entire IDB-backed repository in heap.
 */
export async function* resolveFileContentBatches(
  index: CodeIndex,
  paths: readonly string[],
  options: ResolveFileContentBatchOptions = {},
): AsyncGenerator<ResolvedFileContentBatch> {
  const requestedBatchSize = options.batchSize ?? DEFAULT_CONTENT_RESOLUTION_BATCH_SIZE
  if (!Number.isFinite(requestedBatchSize) || requestedBatchSize < 1) {
    throw new RangeError('Content resolution batchSize must be a positive finite number')
  }
  const batchSize = Math.min(Math.floor(requestedBatchSize), MAX_CONTENT_RESOLUTION_BATCH_SIZE)
  const uniquePaths = Array.from(new Set(paths))

  for (let offset = 0; offset < uniquePaths.length; offset += batchSize) {
    throwIfContentResolutionAborted(options.signal)
    const batchPaths = uniquePaths.slice(offset, offset + batchSize)
    const missingInline = batchPaths.filter(path => typeof index.files.get(path)?.content !== 'string')
    const stored = missingInline.length > 0
      ? await index.contentStore.getBatch(missingInline)
      : new Map<string, string>()
    throwIfContentResolutionAborted(options.signal)
    const contents = new Map<string, string>()
    const missingPaths: string[] = []

    for (const path of batchPaths) {
      let source = index.files.get(path)?.content
      if (typeof source !== 'string') source = stored.get(path)
      if (typeof source !== 'string' && index.contentStore.bulkReadMode === 'complete') {
        source = await index.contentStore.get(path) ?? undefined
      }
      throwIfContentResolutionAborted(options.signal)
      if (typeof source === 'string') contents.set(path, source)
      else missingPaths.push(path)
    }

    yield {
      paths: batchPaths,
      contents,
      missingPaths,
      residentOnly: index.contentStore.bulkReadMode === 'resident-only',
    }
  }
}

/** Resolve a selected set without turning an on-demand store into a bulk network fetch. */
export async function resolveFileContents(
  index: CodeIndex,
  paths: readonly string[],
  options: ResolveFileContentBatchOptions = {},
): Promise<ResolvedFileContents> {
  const contents = new Map<string, string>()
  const missingPaths: string[] = []

  for await (const batch of resolveFileContentBatches(index, paths, options)) {
    for (const [path, source] of batch.contents) contents.set(path, source)
    missingPaths.push(...batch.missingPaths)
  }

  return {
    contents,
    missingPaths,
    residentOnly: index.contentStore.bulkReadMode === 'resident-only',
  }
}

/**
 * Resolve resident and external source into an isolated in-memory index.
 * Prefer resolveFileContentBatches for repository-wide consumers; this legacy
 * compatibility helper still materializes the final aggregate in memory.
 */
export async function hydrateCodeIndexContent(
  index: CodeIndex,
): Promise<HydratedCodeIndex> {
  const resolved = await resolveFileContents(index, Array.from(index.files.keys()))
  const files = new Map(index.files)
  for (const [path, source] of resolved.contents) {
    const file = files.get(path)
    if (file) files.set(path, { ...file, content: source })
  }

  return {
    index: {
      ...index,
      files,
      contentStore: new InMemoryContentStore(resolved.contents),
    },
    missingPaths: resolved.missingPaths,
  }
}

/**
 * Create an empty code index
 */
export function createEmptyIndex(): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
    unknownLineCountFiles: 0,
    isIndexing: false,
    meta: new Map(),
    contentStore: new InMemoryContentStore(),
  }
}

/** Create an empty code index with a specific content store. */
export function createEmptyIndexWithStore(contentStore: ContentStore): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
    unknownLineCountFiles: 0,
    isIndexing: false,
    meta: new Map(),
    contentStore,
  }
}

/**
 * Add a file to the index
 */
export function indexFile(index: CodeIndex, path: string, content: string, language?: string): CodeIndex {
  const name = path.split('/').pop() || path
  const lineCount = countLines(content)
  
  const indexed: IndexedFile = {
    path,
    name,
    content,
    language,
    lineCount,
  }
  
  const newFiles = new Map(index.files)
  newFiles.set(path, indexed)

  // Phase 3: dual-write to meta + contentStore
  const newMeta = new Map(index.meta ?? new Map())
  newMeta.set(path, { path, name, language, lineCount })

  // IDB stores are mutable shared references — mutate in-place.
  // InMemory stores are cloned for immutability.
  // Fallback: legacy callers may pass CodeIndex without contentStore at runtime.
  let newContentStore: ContentStore
  if (!index.contentStore || index.contentStore instanceof InMemoryContentStore) {
    newContentStore = cloneContentStore(index.contentStore ?? new InMemoryContentStore())
    newContentStore.put(path, content)
  } else {
    index.contentStore.put(path, content)
    newContentStore = index.contentStore
  }
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
    unknownLineCountFiles: Array.from(newFiles.values()).filter(file => file.lineCountKnown === false).length,
    meta: newMeta,
    contentStore: newContentStore,
  }
}

/**
 * Remove a file from the index
 */
export function removeFromIndex(index: CodeIndex, path: string): CodeIndex {
  const newFiles = new Map(index.files)
  newFiles.delete(path)

  // Phase 3: dual-delete from meta + contentStore
  const newMeta = new Map(index.meta ?? new Map())
  newMeta.delete(path)

  let newContentStore: ContentStore
  if (!index.contentStore || index.contentStore instanceof InMemoryContentStore) {
    newContentStore = cloneContentStore(index.contentStore ?? new InMemoryContentStore())
    newContentStore.delete(path)
  } else {
    index.contentStore.delete(path)
    newContentStore = index.contentStore
  }
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
    unknownLineCountFiles: Array.from(newFiles.values()).filter(file => file.lineCountKnown === false).length,
    meta: newMeta,
    contentStore: newContentStore,
  }
}

/**
 * Index (or re-index) many files in a single pass, returning a new CodeIndex.
 * Much cheaper than calling `indexFile` N times because it only computes
 * `totalLines` once at the end instead of N times.
 */
export function batchIndexFiles(
  index: CodeIndex,
  updates: Array<{ path: string; content: string; language?: string }>,
  options: { retainContent?: boolean } = {},
): CodeIndex {
  const retainContent = options.retainContent ?? true
  const newFiles = new Map(index.files)
  const newMeta = new Map(index.meta ?? new Map())

  // IDB stores are mutable shared references — putBatch directly.
  // InMemory stores are cloned for immutability.
  let newContentStore: ContentStore
  if (!index.contentStore || index.contentStore instanceof InMemoryContentStore) {
    const contentMap = (index.contentStore as InMemoryContentStore | undefined)?.getAllSync?.() ?? new Map<string, string>()
    const store = new InMemoryContentStore(contentMap)
    store.putBatch(updates.map(u => ({ path: u.path, content: u.content })))
    newContentStore = store
  } else {
    index.contentStore.putBatch(updates.map(u => ({ path: u.path, content: u.content })))
    newContentStore = index.contentStore
  }

  for (const { path, content, language } of updates) {
    const lineCount = countLines(content)
    const name = path.split('/').pop() || path
    newFiles.set(path, {
      path,
      name,
      ...(retainContent ? { content } : {}),
      language,
      lineCount,
    })
    newMeta.set(path, { path, name, language, lineCount })
  }

  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
    unknownLineCountFiles: Array.from(newFiles.values()).filter(file => file.lineCountKnown === false).length,
    meta: newMeta,
    contentStore: newContentStore,
  }
}

/**
 * Create a metadata-only CodeIndex for lazy-loaded repos (at least 250 MB).
 * Populates `files` and `meta` with metadata entries and leaves content absent.
 * Does NOT write to contentStore — content is fetched on demand.
 *
 * Omitting content distinguishes a metadata-only record from a real empty file.
 */
export function batchIndexMetadataOnly(
  index: CodeIndex,
  entries: Array<{ path: string; language?: string; lineCount?: number }>,
): CodeIndex {
  const newFiles = new Map(index.files)
  const newMeta = new Map(index.meta ?? new Map())

  for (const { path, language, lineCount } of entries) {
    const name = path.split('/').pop() || path
    const lc = lineCount ?? 0
    const lineCountKnown = lineCount !== undefined
    newFiles.set(path, { path, name, language, lineCount: lc, lineCountKnown })
    newMeta.set(path, { path, name, language, lineCount: lc, lineCountKnown })
  }

  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, file) => sum + file.lineCount, 0),
    unknownLineCountFiles: Array.from(newFiles.values()).filter(file => file.lineCountKnown === false).length,
    meta: newMeta,
    contentStore: index.contentStore,
  }
}

/**
 * Build a search RegExp from a query string and options.
 * Centralizes all regex construction so every call site behaves identically.
 *
 * @param query        The raw search string
 * @param options      caseSensitive / regex / wholeWord flags
 * @param captureGroup If true the pattern is wrapped in a capture group –
 *                     useful for `.split()` in highlight functions.
 */
export function buildSearchRegex(
  query: string,
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean; trusted?: boolean } = {},
  captureGroup = false,
): RegExp | null {
  if (!query.trim()) return null

  const { caseSensitive = false, regex = false, wholeWord = false, trusted = false } = options
  const flags = caseSensitive ? 'g' : 'gi'
  const useRegex = regex && (trusted || validateSearchRegex(query) === 'valid')

  const build = (src: string) => {
    const wrapped = captureGroup ? `(${src})` : src
    return new RegExp(wrapped, flags)
  }

  try {
    if (useRegex) {
      return build(query)
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped
    return build(pattern)
  } catch {
    // Invalid regex – fall back to escaped literal
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return build(escaped)
  }
}

/** Conservative guard against patterns with unbounded nested backtracking. */
function isUnsafeSearchRegex(pattern: string): boolean {
  if (pattern.length > 200) return true
  if (/\\[1-9]/.test(pattern)) return true
  if (/\([^()]*[+*][^()]*\)[+*?{]/.test(pattern)) return true
  if (/\([^()]*\|[^()]*\)(?:[+*]|\{\d*,\})/.test(pattern)) return true
  if (countUnboundedQuantifiers(pattern) > 1) return true
  return false
}

function countUnboundedQuantifiers(pattern: string): number {
  let count = 0
  let inCharacterClass = false
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    if (character === '\\') {
      index++
      continue
    }
    if (character === '[') {
      inCharacterClass = true
      continue
    }
    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (character === '*' || character === '+') {
      count++
      continue
    }
    if (character === '{' && /^\{\d+,\}/.test(pattern.slice(index))) count++
  }
  return count
}

/** Validate a user regex without ever compiling a pattern that failed the safety guard. */
export function validateSearchRegex(pattern: string): 'valid' | 'invalid' | 'unsafe' {
  if (isUnsafeSearchRegex(pattern)) return 'unsafe'
  try {
    new RegExp(pattern)
    return 'valid'
  } catch {
    return 'invalid'
  }
}

/** Update line metadata after previously absent source becomes available. */
export function recordResolvedFileLineCount(index: CodeIndex, path: string, content: string): void {
  const file = index.files.get(path)
  if (!file) return
  const wasUnknown = file.lineCountKnown === false
  const previousLineCount = wasUnknown ? 0 : file.lineCount
  const lineCount = countLines(content)
  file.lineCount = lineCount
  file.lineCountKnown = true
  const metadata = index.meta.get(path)
  if (metadata) {
    metadata.lineCount = lineCount
    metadata.lineCountKnown = true
  }
  index.totalLines += lineCount - previousLineCount
  if (wasUnknown) {
    const unknownCount = index.unknownLineCountFiles
      ?? Array.from(index.files.values()).filter(indexed => indexed.lineCountKnown === false).length + 1
    index.unknownLineCountFiles = Math.max(0, unknownCount - 1)
  }
}

/**
 * Search across all indexed files
 */
export function searchIndex(
  index: CodeIndex, 
  query: string, 
  options: SearchOptions = {},
): SearchResult[] {
  const searchPattern = buildSearchRegex(query, options)
  if (!searchPattern) return []
  
  const results: SearchResult[] = []
  const maxMatches = options.maxMatches ?? DEFAULT_SEARCH_MAX_MATCHES
  const maxMatchesPerFile = options.maxMatchesPerFile ?? DEFAULT_SEARCH_MAX_MATCHES_PER_FILE
  let totalMatches = 0
  
  for (const [path, file] of index.files) {
    if (typeof file.content !== 'string') continue

    const matches: SearchMatch[] = []
    
    const lines = getFileLines(file)
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (totalMatches >= maxMatches) break
      const line = lines[lineIndex]
      searchPattern.lastIndex = 0
      let match: RegExpExecArray | null
      
      while ((match = searchPattern.exec(line)) !== null) {
        if (matches.length >= maxMatchesPerFile || totalMatches >= maxMatches) break
        matches.push({
          line: lineIndex + 1,
          content: line,
          column: match.index,
          length: match[0].length,
        })
        totalMatches++
        
        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) break
      }
    }
    
    if (matches.length > 0) {
      results.push({
        file: path,
        language: file.language,
        matches,
      })
    }
  }
  
  // Sort by number of matches (most matches first)
  results.sort((a, b) => b.matches.length - a.matches.length)
  
  return results
}

/**
 * Search every indexed file after resolving source through its ContentStore.
 * Unlike the synchronous fast path, metadata-only IDB/lazy records are hydrated.
 */
export async function searchIndexAsync(
  index: CodeIndex,
  query: string,
  options: SearchOptions = {},
): Promise<AsyncSearchResult> {
  const searchPattern = buildSearchRegex(query, options)
  if (!searchPattern) return createAsyncSearchResult([], [])

  const maxMatches = options.maxMatches ?? DEFAULT_SEARCH_MAX_MATCHES
  const maxMatchesPerFile = options.maxMatchesPerFile ?? DEFAULT_SEARCH_MAX_MATCHES_PER_FILE
  const signal = options.signal
  const results: SearchResult[] = []
  const unsearchedPaths: string[] = []
  const unavailablePaths: string[] = []
  let totalMatches = 0
  let truncated = false
  const paths = Array.from(index.files.keys()).filter(path => (
    matchesSearchPathFilter(path, options.pathFilter)
  ))

  searchBatches: for (let offset = 0; offset < paths.length; offset += SEARCH_FILE_BATCH_SIZE) {
    if (offset > 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    throwIfSearchAborted(signal)
    if (totalMatches >= maxMatches) {
      unsearchedPaths.push(...paths.slice(offset))
      truncated = true
      break
    }
    const batch = paths.slice(offset, offset + SEARCH_FILE_BATCH_SIZE)
    const missing = batch.filter(path => typeof index.files.get(path)?.content !== 'string')
    const stored = await index.contentStore.getBatch(missing)
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      if (totalMatches >= maxMatches) {
        unsearchedPaths.push(...batch.slice(batchIndex), ...paths.slice(offset + batch.length))
        truncated = true
        break searchBatches
      }
      const path = batch[batchIndex]
      throwIfSearchAborted(signal)
      let content = index.files.get(path)?.content
      if (typeof content !== 'string') content = stored.get(path)
      if (typeof content !== 'string') {
        unsearchedPaths.push(path)
        unavailablePaths.push(path)
        continue
      }

      const matches: SearchMatch[] = []
      const lines = content.split('\n')
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (lineIndex > 0 && lineIndex % SEARCH_LINE_BATCH_SIZE === 0) {
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          throwIfSearchAborted(signal)
        }
        if (totalMatches >= maxMatches) {
          truncated = true
          break
        }
        const line = lines[lineIndex]
        if (line.length > MAX_SEARCH_LINE_LENGTH) {
          truncated = true
          continue
        }
        searchPattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = searchPattern.exec(line)) !== null) {
          if (matches.length >= maxMatchesPerFile || totalMatches >= maxMatches) {
            truncated = true
            break
          }
          matches.push({ line: lineIndex + 1, content: line, column: match.index, length: match[0].length })
          totalMatches++
          if (match[0].length === 0) break
        }
      }
      if (matches.length > 0) {
        results.push({ file: path, language: index.files.get(path)?.language, matches })
      }
    }
  }

  results.sort((a, b) => b.matches.length - a.matches.length)
  return createAsyncSearchResult(results, unsearchedPaths, truncated, unavailablePaths)
}

export function createAsyncSearchResult(
  results: SearchResult[],
  unsearchedPaths: string[],
  truncated = false,
  unavailablePaths: string[] = [],
): AsyncSearchResult {
  const output = [...results] as AsyncSearchResult
  Object.defineProperties(output, {
    results: { value: results, enumerable: false },
    unsearchedPaths: { value: unsearchedPaths, enumerable: false },
    unavailablePaths: { value: unavailablePaths, enumerable: false },
    truncated: { value: truncated, enumerable: false },
  })
  return output
}

/** Result of a partial search over a lazy-loaded index. */
export interface PartialSearchResult {
  results: SearchResult[]
  /** Paths with absent content that were skipped. Genuine empty files are searched. */
  unsearchedPaths: string[]
}

/**
 * Search indexed files, separating results from metadata-only files.
 * Use this for lazy-loaded repos where some files have absent content.
 * The original `searchIndex` is unchanged and still available for full indexes.
 */
export function searchIndexPartial(
  index: CodeIndex,
  query: string,
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {},
): PartialSearchResult {
  const searchPattern = buildSearchRegex(query, options)
  if (!searchPattern) return { results: [], unsearchedPaths: [] }

  const results: SearchResult[] = []
  const unsearchedPaths: string[] = []

  for (const [path, file] of index.files) {
    if (typeof file.content !== 'string') {
      unsearchedPaths.push(path)
      continue
    }

    const matches: SearchMatch[] = []
    const lines = getFileLines(file)
    lines.forEach((line, lineIndex) => {
      searchPattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = searchPattern.exec(line)) !== null) {
        matches.push({
          line: lineIndex + 1,
          content: line,
          column: match.index,
          length: match[0].length,
        })
        if (match[0].length === 0) break
      }
    })

    if (matches.length > 0) {
      results.push({ file: path, language: file.language, matches })
    }
  }

  results.sort((a, b) => b.matches.length - a.matches.length)
  return { results, unsearchedPaths }
}

/**
 * Search additional files whose content has been loaded into a ContentStore.
 * Pure utility — no React/provider imports. Caller is responsible for ensuring
 * content is available in the store before calling.
 *
 * @param contentStore  Store to read content from (via getBatch)
 * @param paths         Unsearched paths to attempt
 * @param query         Search query string
 * @param options       Search options (caseSensitive, regex, wholeWord)
 * @param meta          Optional metadata map for language info
 * @param batchSize     Max paths to search in one call (default 100)
 * @returns results found + paths that still had no content + paths not attempted
 */
export async function searchMore(
  contentStore: ContentStore,
  paths: string[],
  query: string,
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {},
  meta?: Map<string, CodeIndexMeta>,
  batchSize = 100,
): Promise<{
  results: SearchResult[]
  searchedPaths: string[]
  remainingPaths: string[]
}> {
  const searchPattern = buildSearchRegex(query, options)
  if (!searchPattern) return { results: [], searchedPaths: [], remainingPaths: paths }

  const batch = paths.slice(0, batchSize)
  const notAttempted = paths.slice(batchSize)

  const contents = await contentStore.getBatch(batch)

  const results: SearchResult[] = []
  const searchedPaths: string[] = []
  const stillMissing: string[] = []

  for (const path of batch) {
    const content = contents.get(path)
    if (content == null) {
      stillMissing.push(path)
      continue
    }

    searchedPaths.push(path)
    const matches: SearchMatch[] = []
    const lines = content.split('\n')
    lines.forEach((line, lineIndex) => {
      searchPattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = searchPattern.exec(line)) !== null) {
        matches.push({
          line: lineIndex + 1,
          content: line,
          column: match.index,
          length: match[0].length,
        })
        if (match[0].length === 0) break
      }
    })

    if (matches.length > 0) {
      results.push({
        file: path,
        language: meta?.get(path)?.language,
        matches,
      })
    }
  }

  results.sort((a, b) => b.matches.length - a.matches.length)
  return { results, searchedPaths, remainingPaths: [...stillMissing, ...notAttempted] }
}

/**
 * Get context around a specific line for AI
 */
export function getLineContext(
  index: CodeIndex, 
  path: string, 
  line: number, 
  contextLines: number = 5
): string {
  const file = index.files.get(path)
  if (!file) return ''
  
  const fileLines = getFileLines(file)
  const start = Math.max(0, line - 1 - contextLines)
  const end = Math.min(fileLines.length, line + contextLines)
  
  return fileLines.slice(start, end).join('\n')
}

/**
 * Get all file paths that match a pattern
 */
export function getMatchingPaths(files: FileNode[], pattern: string): string[] {
  const matches: string[] = []
  const lowerPattern = pattern.toLowerCase()
  
  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.path.toLowerCase().includes(lowerPattern) || 
          node.name.toLowerCase().includes(lowerPattern)) {
        matches.push(node.path)
      }
      if (node.children) {
        traverse(node.children)
      }
    }
  }
  
  traverse(files)
  return matches
}

/**
 * Flatten file tree to get all file paths
 */
export function flattenFiles(files: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  
  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.type === 'file') {
        result.push(node)
      }
      if (node.children) {
        traverse(node.children)
      }
    }
  }
  
  traverse(files)
  return result
}
