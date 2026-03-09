// Code Index - Manages file content indexing for search and AI context

import type { FileNode } from '@/types/repository'
import { InMemoryContentStore, type ContentStore, type CodeIndexMeta } from './content-store'

/** Clone the content store for immutable CodeIndex updates (Wave 1: InMemoryContentStore only). */
function cloneContentStore(store: ContentStore | undefined): InMemoryContentStore {
  if (!store) return new InMemoryContentStore()
  if (store instanceof InMemoryContentStore) {
    return new InMemoryContentStore(store.getAllSync())
  }
  throw new Error('Cannot clone non-InMemory ContentStore. Phase 3 Wave 2+ requires async content store operations.')
}

export type { ContentStore, CodeIndexMeta } from './content-store'
export { InMemoryContentStore, IDBContentStore, LazyContentStore } from './content-store'

export interface IndexedFile {
  path: string
  name: string
  content: string
  language?: string
  lineCount: number
}

const linesCache = new WeakMap<IndexedFile, string[]>()

export function getFileLines(file: IndexedFile): string[] {
  let lines = linesCache.get(file)
  if (!lines) {
    lines = file.content.split('\n')
    linesCache.set(file, lines)
  }
  return lines
}

export function invalidateLinesCache(file: IndexedFile): void {
  linesCache.delete(file)
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

export interface CodeIndex {
  files: Map<string, IndexedFile>
  totalFiles: number
  totalLines: number
  isIndexing: boolean
  /** Phase 3: metadata-only records (no content). Populated alongside `files`. */
  meta?: Map<string, CodeIndexMeta>
  /** Phase 3: content storage abstraction. InMemoryContentStore in Wave 1. */
  contentStore?: ContentStore
}

/**
 * Create an empty code index
 */
export function createEmptyIndex(): CodeIndex {
  return {
    files: new Map(),
    totalFiles: 0,
    totalLines: 0,
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
  const lineCount = content.split('\n').length
  
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
  let newContentStore: ContentStore
  if (index.contentStore && !(index.contentStore instanceof InMemoryContentStore)) {
    index.contentStore.put(path, content)
    newContentStore = index.contentStore
  } else {
    newContentStore = cloneContentStore(index.contentStore)
    newContentStore.put(path, content)
  }
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
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
  if (index.contentStore && !(index.contentStore instanceof InMemoryContentStore)) {
    index.contentStore.delete(path)
    newContentStore = index.contentStore
  } else {
    newContentStore = cloneContentStore(index.contentStore)
    newContentStore.delete(path)
  }
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
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
): CodeIndex {
  const newFiles = new Map(index.files)
  const newMeta = new Map(index.meta ?? new Map())

  // IDB stores are mutable shared references — putBatch directly.
  // InMemory stores are cloned for immutability.
  let newContentStore: ContentStore
  if (index.contentStore && !(index.contentStore instanceof InMemoryContentStore)) {
    index.contentStore.putBatch(updates.map(u => ({ path: u.path, content: u.content })))
    newContentStore = index.contentStore
  } else {
    const contentMap = (index.contentStore as InMemoryContentStore)?.getAllSync?.() ?? new Map<string, string>()
    const store = new InMemoryContentStore(contentMap)
    store.putBatch(updates.map(u => ({ path: u.path, content: u.content })))
    newContentStore = store
  }

  for (const { path, content, language } of updates) {
    const lineCount = content.split('\n').length
    const name = path.split('/').pop() || path
    newFiles.set(path, { path, name, content, language, lineCount })
    newMeta.set(path, { path, name, language, lineCount })
  }

  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
    meta: newMeta,
    contentStore: newContentStore,
  }
}

/**
 * Create a metadata-only CodeIndex for lazy-loaded repos (>200MB).
 * Populates `files` with empty content and `meta` with metadata entries.
 * Does NOT write to contentStore — content is fetched on demand.
 *
 * `content: ''` preserves totalFiles counting for UI and is search-safe
 * (empty string matches nothing).
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
    newFiles.set(path, { path, name, content: '', language, lineCount: lc })
    newMeta.set(path, { path, name, language, lineCount: lc })
  }

  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: 0,
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
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {},
  captureGroup = false,
): RegExp | null {
  if (!query.trim()) return null

  const { caseSensitive = false, regex = false, wholeWord = false } = options
  const flags = caseSensitive ? 'g' : 'gi'

  const build = (src: string) => {
    const wrapped = captureGroup ? `(${src})` : src
    return new RegExp(wrapped, flags)
  }

  try {
    if (regex) {
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

/**
 * Search across all indexed files
 */
export function searchIndex(
  index: CodeIndex, 
  query: string, 
  options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean } = {}
): SearchResult[] {
  const searchPattern = buildSearchRegex(query, options)
  if (!searchPattern) return []
  
  const results: SearchResult[] = []
  
  for (const [path, file] of index.files) {
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
        
        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) break
      }
    })
    
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

/** Result of a partial search over a lazy-loaded index. */
export interface PartialSearchResult {
  results: SearchResult[]
  /** Paths that had no content (content === '') and were skipped. */
  unsearchedPaths: string[]
}

/**
 * Search indexed files, separating results from unsearched (empty-content) files.
 * Use this for lazy-loaded repos where some files have content='' (metadata only).
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
    if (file.content === '') {
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
    if (content == null || content === '') {
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
