// Code Index - Manages file content indexing for search and AI context

import type { FileNode } from '@/types/repository'

export interface IndexedFile {
  path: string
  name: string
  content: string
  language?: string
  lines: string[]
  lineCount: number
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
  }
}

/**
 * Add a file to the index
 */
export function indexFile(index: CodeIndex, path: string, content: string, language?: string): CodeIndex {
  const lines = content.split('\n')
  const name = path.split('/').pop() || path
  
  const indexed: IndexedFile = {
    path,
    name,
    content,
    language,
    lines,
    lineCount: lines.length,
  }
  
  const newFiles = new Map(index.files)
  newFiles.set(path, indexed)
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
  }
}

/**
 * Remove a file from the index
 */
export function removeFromIndex(index: CodeIndex, path: string): CodeIndex {
  const newFiles = new Map(index.files)
  newFiles.delete(path)
  
  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
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

  for (const { path, content, language } of updates) {
    const lines = content.split('\n')
    const name = path.split('/').pop() || path
    newFiles.set(path, { path, name, content, language, lines, lineCount: lines.length })
  }

  return {
    ...index,
    files: newFiles,
    totalFiles: newFiles.size,
    totalLines: Array.from(newFiles.values()).reduce((sum, f) => sum + f.lineCount, 0),
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
    
    file.lines.forEach((line, lineIndex) => {
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
  
  const start = Math.max(0, line - 1 - contextLines)
  const end = Math.min(file.lines.length, line + contextLines)
  
  return file.lines.slice(start, end).join('\n')
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
