import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'
import { createEmptyIndex, indexFile, searchIndex, getFileLines } from '@/lib/code/code-index'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { LANG_EXTENSIONS } from '@/lib/code/scanner/constants'
import { SYMBOL_PATTERNS } from '@/lib/ai/structural-index'
import {
  readFileSchema,
  readFilesSchema,
  searchFilesSchema,
  listDirectorySchema,
  findSymbolSchema,
  getFileStatsSchema,
  analyzeImportsSchema,
  scanIssuesSchema,
  generateDiagramSchema,
} from '@/lib/ai/tool-schemas'
import { generateTourSchema } from '@/lib/ai/tour-schemas'
import type { Tour, TourStop } from '@/types/tours'

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

/** Options for executeToolLocally to pass additional context without signature bloat. */
export interface ToolExecutorOptions {
  /** Repository metadata from GitHub API. */
  repoMeta?: { stars?: number; forks?: number; description?: string; topics?: string[]; license?: string; language?: string }
  /** Current indexing progress for incomplete-index warnings. */
  indexingProgress?: { filesIndexed: number; totalFiles: number }
  /** Optional codebase analysis context for scanIssues. */
  codebaseAnalysis?: Record<string, unknown> | null
  /** Validated repository name for tour generation. */
  repoName?: string
  /** Repository info for GitHub fetch fallback when files are missing from the index. */
  repoInfo?: { owner: string; name: string; defaultBranch: string; token?: string }
  /** Callback to fetch content for files not in the in-memory index (lazy repos). */
  fetchFileContent?: (paths: string[]) => Promise<Map<string, string>>
}

/** Maximum characters returned for a full file read (F5). */
export const MAX_FILE_CONTENT_CHARS = 100_000

// ---------------------------------------------------------------------------
// Zod validation helper
// ---------------------------------------------------------------------------

/** Format Zod issues into a single actionable error string. */
function formatZodError(issues: Array<{ message: string }>): string {
  return `Validation failed: ${issues.map(i => i.message).join(', ')}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes tool calls locally using the client-side CodeIndex.
 * Async to support on-demand content fetching for lazy repos.
 */
export async function executeToolLocally(
  toolName: string,
  input: Record<string, unknown>,
  codeIndex: CodeIndex | null,
  allFilePaths?: string[],
  options?: ToolExecutorOptions,
): Promise<string> {
  if (!codeIndex?.files || (codeIndex.files.size === 0 && (!codeIndex.meta || codeIndex.meta.size === 0))) {
    return JSON.stringify({ error: 'No codebase loaded' })
  }

  // F4: Detect incomplete indexing and prepare warning
  let indexWarning: string | undefined
  if (options?.indexingProgress) {
    const { filesIndexed, totalFiles } = options.indexingProgress
    if (totalFiles > 0 && filesIndexed < totalFiles) {
      indexWarning = `Code index is incomplete (${filesIndexed}/${totalFiles} files). Results may be partial.`
    }
  }

  let output: Record<string, unknown>

  switch (toolName) {
    case 'readFile': {
      const result = readFileSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = await executeReadFile(result.data, codeIndex, options?.fetchFileContent)
      break
    }
    case 'readFiles': {
      const result = readFilesSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = await executeReadFiles(result.data, codeIndex, options?.fetchFileContent)
      break
    }
    case 'searchFiles': {
      const result = searchFilesSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeSearchFiles(result.data, codeIndex, allFilePaths)
      break
    }
    case 'listDirectory': {
      const result = listDirectorySchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeListDirectory(result.data, codeIndex, allFilePaths)
      break
    }
    case 'findSymbol': {
      const result = findSymbolSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeFindSymbol(result.data, codeIndex, allFilePaths)
      break
    }
    case 'getFileStats': {
      const result = getFileStatsSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeGetFileStats(result.data, codeIndex)
      break
    }
    case 'analyzeImports': {
      const result = analyzeImportsSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeAnalyzeImports(result.data, codeIndex)
      break
    }
    case 'scanIssues': {
      const result = scanIssuesSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeScanIssues(result.data, codeIndex, options?.codebaseAnalysis ?? null)
      break
    }
    case 'generateDiagram': {
      const result = generateDiagramSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeGenerateDiagram(result.data, codeIndex)
      break
    }
    case 'getProjectOverview':
      output = executeGetProjectOverview(codeIndex, options?.repoMeta, allFilePaths)
      break
    case 'generateTour': {
      const result = generateTourSchema.safeParse(input)
      if (!result.success) { output = { error: formatZodError(result.error.issues) }; break }
      output = executeGenerateTour(result.data, codeIndex, options?.repoName ? { name: options.repoName } : undefined)
      break
    }
    default:
      output = { error: `Unknown tool: ${toolName}` }
  }

  // F4: Attach indexing warning to successful results
  if (indexWarning && !output.error) {
    output.indexWarning = indexWarning
  }

  return JSON.stringify(output)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allPaths(codeIndex: CodeIndex): string[] {
  const keys = new Set(codeIndex.files.keys())
  if (codeIndex.meta) {
    for (const k of codeIndex.meta.keys()) keys.add(k)
  }
  return Array.from(keys).sort()
}

function getContent(codeIndex: CodeIndex, path: string): string | undefined {
  const file = codeIndex.files.get(path)
  return file?.content
}

function findFile(codeIndex: CodeIndex, path: string): IndexedFile | undefined {
  const direct = codeIndex.files.get(path)
  if (direct) return direct

  // Tiered fuzzy matching: full-segment suffix first, then bare suffix
  let suffixMatch: IndexedFile | undefined
  for (const [p, file] of codeIndex.files) {
    if (p.endsWith('/' + path)) return file
    if (!suffixMatch && p.endsWith(path)) suffixMatch = file
  }
  return suffixMatch
}

/**
 * Resolve a user-provided path to the canonical path in the index,
 * checking both `files` and `meta` maps with fuzzy matching.
 */
function resolvePath(codeIndex: CodeIndex, path: string): string | undefined {
  if (codeIndex.files.has(path) || codeIndex.meta?.has(path)) return path

  const allKeys = [...codeIndex.files.keys(), ...(codeIndex.meta?.keys() ?? [])]
  let suffixMatch: string | undefined
  for (const p of allKeys) {
    if (p.endsWith('/' + path)) return p
    if (!suffixMatch && p.endsWith(path)) suffixMatch = p
  }
  return suffixMatch
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function executeReadFile(
  input: { path: string; startLine?: number; endLine?: number },
  codeIndex: CodeIndex,
  fetchContent?: (paths: string[]) => Promise<Map<string, string>>,
): Promise<Record<string, unknown>> {
  const usedPath = resolvePath(codeIndex, input.path)
  if (!usedPath) {
    return { error: `File not found: ${input.path}. Use searchFiles or check the file tree.` }
  }

  let content = getContent(codeIndex, usedPath)

  // On-demand fetch for lazy repos when content is not in memory
  if (!content && fetchContent) {
    const fetched = await fetchContent([usedPath])
    content = fetched.get(usedPath)
  }

  if (!content) {
    return { error: `File content not available for: ${usedPath}. Content has not been loaded yet.` }
  }

  const lines = content.split('\n')
  const totalLines = lines.length

  if (input.startLine !== undefined || input.endLine !== undefined) {
    const start = Math.max(1, input.startLine ?? 1) - 1 // 0-based
    const end = Math.min(totalLines, input.endLine ?? totalLines)
    const sliced = lines.slice(start, end)
    return { path: usedPath, content: sliced.join('\n'), startLine: start + 1, endLine: end, totalLines }
  }

  // F5: Truncate large files when reading in full (no startLine/endLine)
  if (content.length > MAX_FILE_CONTENT_CHARS) {
    return {
      path: usedPath,
      content: content.slice(0, MAX_FILE_CONTENT_CHARS),
      lineCount: totalLines,
      totalLines,
      warning: `File truncated from ${content.length} to ${MAX_FILE_CONTENT_CHARS} characters. Use startLine/endLine to read specific sections.`,
    }
  }

  return { path: usedPath, content, lineCount: totalLines, totalLines }
}

async function executeReadFiles(
  input: { paths: string[] },
  codeIndex: CodeIndex,
  fetchContent?: (paths: string[]) => Promise<Map<string, string>>,
): Promise<Record<string, unknown>> {
  // Resolve all paths and identify which need fetching (batch, no N+1)
  const resolved = input.paths.map(p => ({ original: p, resolved: resolvePath(codeIndex, p) }))
  const needFetch = resolved
    .filter(r => r.resolved && !getContent(codeIndex, r.resolved))
    .map(r => r.resolved!)

  let fetched = new Map<string, string>()
  if (needFetch.length > 0 && fetchContent) {
    fetched = await fetchContent(needFetch)
  }

  const results = resolved.map(({ original, resolved: rp }) => {
    if (!rp) {
      return { error: `File not found: ${original}. Use searchFiles or check the file tree.` }
    }
    let content = getContent(codeIndex, rp)
    if (!content) content = fetched.get(rp)
    if (!content) {
      return { error: `File content not available for: ${rp}. Content has not been loaded yet.` }
    }

    const lines = content.split('\n')
    const totalLines = lines.length
    if (content.length > MAX_FILE_CONTENT_CHARS) {
      return {
        path: rp,
        content: content.slice(0, MAX_FILE_CONTENT_CHARS),
        lineCount: totalLines,
        totalLines,
        warning: `File truncated from ${content.length} to ${MAX_FILE_CONTENT_CHARS} characters. Use startLine/endLine to read specific sections.`,
      }
    }
    return { path: rp, content, lineCount: totalLines, totalLines }
  })

  return { files: results }
}

function executeSearchFiles(
  input: { query: string; maxResults?: number; isRegex?: boolean },
  codeIndex: CodeIndex,
  allFilePaths?: string[],
): Record<string, unknown> {
  const limit = input.maxResults ?? 15
  const paths = allFilePaths && allFilePaths.length > 0 ? allFilePaths : allPaths(codeIndex)
  const results: Array<{ path: string; matchType: 'path' | 'content'; matches?: Array<{ line: number; content: string; context?: string[] }>; totalMatches?: number }> = []
  let warning: string | undefined

  // Determine matching strategy with ReDoS protection
  let pathRegex: RegExp | null = null
  let useRegex = input.isRegex === true

  if (useRegex) {
    if (input.query.length > 200) {
      warning = 'Regex pattern exceeds 200 characters, falling back to text search'
      useRegex = false
    } else {
      try {
        pathRegex = new RegExp(input.query, 'i')
      } catch {
        warning = 'Invalid regex, falling back to text search'
        useRegex = false
      }
    }
  }

  // Path matching: regex or case-insensitive substring
  const queryLower = input.query.toLowerCase()
  for (const path of paths) {
    if (results.length >= limit) break
    const isMatch = pathRegex ? pathRegex.test(path) : path.toLowerCase().includes(queryLower)
    if (isMatch) {
      results.push({ path, matchType: 'path' })
    }
  }

  // Content matching: delegate to searchIndex for accurate regex/substring search
  if (results.length < limit) {
    const searchResults = searchIndex(codeIndex, input.query, { regex: useRegex })
    const pathsAlreadyMatched = new Set(results.map(r => r.path))

    for (const sr of searchResults) {
      if (results.length >= limit) break
      if (pathsAlreadyMatched.has(sr.file)) continue

      const file = codeIndex.files.get(sr.file)
      if (!file) continue

      const totalMatches = sr.matches.length
      const matches: Array<{ line: number; content: string; context?: string[] }> = []

      // Show up to 5 match locations per file with ±3 lines of context
      for (const match of sr.matches.slice(0, 5)) {
        const contextLines: string[] = []
        const lineIdx = match.line - 1 // 0-based index into file lines
        const fileLines = getFileLines(file)

        for (let offset = -3; offset <= 3; offset++) {
          const idx = lineIdx + offset
          if (idx >= 0 && idx < fileLines.length) {
            contextLines.push(`L${idx + 1}: ${fileLines[idx].trim().slice(0, 200)}`)
          }
        }

        matches.push({
          line: match.line,
          content: match.content.trim().slice(0, 200),
          context: contextLines,
        })
      }

      results.push({ path: sr.file, matchType: 'content', matches, totalMatches })
    }
  }

  // Sort: path matches first, then by match count descending
  results.sort((a, b) => {
    if (a.matchType === 'path' && b.matchType !== 'path') return -1
    if (a.matchType !== 'path' && b.matchType === 'path') return 1
    return (b.totalMatches ?? 0) - (a.totalMatches ?? 0)
  })

  const output: Record<string, unknown> = { totalFiles: paths.length, matchCount: results.length, results }
  if (warning) output.warning = warning

  // Partial coverage: when meta has paths not in files, content search is incomplete
  const metaSize = codeIndex.meta?.size ?? 0
  const filesWithContent = codeIndex.files.size
  if (metaSize > 0 && filesWithContent < metaSize) {
    output.contentCoverage = {
      searchedFiles: filesWithContent,
      totalFiles: metaSize,
      note: `Content search covered ${filesWithContent}/${metaSize} files. Path matching covers all files.`,
    }
  }

  return output
}

function executeListDirectory(
  input: { path: string },
  codeIndex: CodeIndex,
  allFilePaths?: string[],
): Record<string, unknown> {
  const prefix = input.path ? (input.path.endsWith('/') ? input.path : input.path + '/') : ''
  const entries = new Set<string>()
  const paths = allFilePaths && allFilePaths.length > 0 ? allFilePaths : allPaths(codeIndex)

  for (const filePath of paths) {
    if (!filePath.startsWith(prefix)) continue
    const rest = filePath.slice(prefix.length)
    const firstPart = rest.split('/')[0]
    if (firstPart) {
      const isDir = rest.includes('/')
      entries.add(isDir ? firstPart + '/' : firstPart)
    }
  }

  if (entries.size === 0 && input.path) {
    return { error: `Directory not found: ${input.path}. Use listDirectory with an empty path to see the root.` }
  }

  return {
    directory: input.path || '(root)',
    entries: Array.from(entries).sort((a, b) => {
      const aDir = a.endsWith('/')
      const bDir = b.endsWith('/')
      if (aDir && !bDir) return -1
      if (!aDir && bDir) return 1
      return a.localeCompare(b)
    }),
  }
}

/** Map structural-index kind labels to the labels used by findSymbolSchema. */
const KIND_MAP: Record<string, string> = { fn: 'function', iface: 'interface' }

function executeFindSymbol(
  input: { name: string; kind?: string },
  codeIndex: CodeIndex,
  allFilePaths?: string[],
): Record<string, unknown> {
  const results: Array<{ path: string; line: number; kind: string; match: string }> = []
  // Derive patterns from the shared SYMBOL_PATTERNS, remapping kind labels and
  // cloning each RegExp to avoid shared /g lastIndex state across iterations.
  const patterns = SYMBOL_PATTERNS.map(p => ({
    regex: new RegExp(p.regex.source, p.regex.flags),
    kind: KIND_MAP[p.kind] ?? p.kind,
  }))
  const nameL = input.name.toLowerCase()

  for (const [filePath, file] of codeIndex.files) {
    const lines = getFileLines(file)
    for (let i = 0; i < lines.length; i++) {
      for (const pat of patterns) {
        if (input.kind && input.kind !== 'any' && pat.kind !== input.kind) continue
        pat.regex.lastIndex = 0
        let m
        while ((m = pat.regex.exec(lines[i])) !== null) {
          if (m[1].toLowerCase() === nameL) {
            results.push({ path: filePath, line: i + 1, kind: pat.kind, match: lines[i].trim() })
          }
        }
      }
    }
    if (results.length >= 20) break
  }

  const output: Record<string, unknown> = { symbolName: input.name, matchCount: results.length, results: results.slice(0, 20) }

  // F3: Warn when index is partial
  if (allFilePaths && allFilePaths.length > 0 && codeIndex.files.size < allFilePaths.length) {
    output.warning = `Index covers ${codeIndex.files.size}/${allFilePaths.length} files. Some symbols may be missing.`
  }

  // Warn about lazy repos where content is not loaded for all metadata paths
  const metaSize = codeIndex.meta?.size ?? 0
  if (metaSize > 0 && codeIndex.files.size < metaSize) {
    output.contentCoverage = {
      searchedFiles: codeIndex.files.size,
      totalFiles: metaSize,
      note: `Symbol search covered ${codeIndex.files.size}/${metaSize} files with loaded content.`,
    }
  }

  return output
}

function executeGetFileStats(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  const lines = getFileLines(file)
  const ext = file.path.split('.').pop() || ''
  const importLines = lines.filter(l => l.match(/^import\s/))
  const exportLines = lines.filter(l => l.match(/^export\s/))

  return {
    path: file.path,
    lineCount: lines.length,
    language: ext,
    importCount: importLines.length,
    exportCount: exportLines.length,
    imports: importLines.slice(0, 20).map(l => l.trim()),
    exports: exportLines.slice(0, 20).map(l => l.trim()),
  }
}

// ---------------------------------------------------------------------------
// Import resolution helpers
// ---------------------------------------------------------------------------

/**
 * Pre-built lookup structure for efficient import path resolution.
 * Built once per analyzeImports call, reused across all files.
 */
interface PathLookup {
  /** Normalized path -> original path */
  exact: Map<string, string>
  /** Normalized path without extension -> original path */
  withoutExt: Map<string, string>
  /** Directory path (for index / __init__ barrel files) -> original path */
  indexDirs: Map<string, string>
}

function buildPathLookup(paths: string[]): PathLookup {
  const exact = new Map<string, string>()
  const withoutExt = new Map<string, string>()
  const indexDirs = new Map<string, string>()

  for (const p of paths) {
    const normalized = p.replace(/\\/g, '/')
    exact.set(normalized, p)

    const stripped = normalized.replace(/\.(tsx?|jsx?|mts|mjs|py|rs|go|java)$/i, '')
    // First file wins to avoid overwriting with later duplicates
    if (!withoutExt.has(stripped)) {
      withoutExt.set(stripped, p)
    }

    // Map directory to barrel/index file
    const indexMatch = stripped.match(/^(.+)\/(index|__init__)$/)
    if (indexMatch && !indexDirs.has(indexMatch[1])) {
      indexDirs.set(indexMatch[1], p)
    }
  }

  return { exact, withoutExt, indexDirs }
}

/** Resolve a relative path (with ./ or ../ segments) against a base directory. Returns null if '..' exceeds root. */
function resolveRelativePath(fromDir: string, relativePath: string): string | null {
  const parts = fromDir.split('/').filter(Boolean)
  const relParts = relativePath.split('/').filter(Boolean)

  for (const part of relParts) {
    if (part === '..') {
      if (parts.length === 0) return null // can't go above root
      parts.pop()
    } else if (part !== '.') {
      parts.push(part)
    }
  }

  return parts.join('/')
}

/**
 * Resolve an import source string to the actual file path in the code index.
 *
 * Handles:
 * - Relative imports (`./foo`, `../bar`)
 * - Alias imports (`@/lib/utils`)
 * - Extension-less imports (tries .ts, .tsx, .js, .jsx, .mts, .mjs, .py, etc.)
 * - Index / barrel file imports (`./components` -> `components/index.ts`)
 *
 * Returns `null` if no matching file is found (external package).
 */
function resolveImportToFilePath(
  importSource: string,
  importerPath: string,
  lookup: PathLookup,
): string | null {
  let candidateBase: string

  if (importSource.startsWith('@/')) {
    // Alias — treat as project-root-relative
    candidateBase = importSource.slice(2)
  } else if (importSource.startsWith('.')) {
    // Relative import — resolve against importer's directory
    const importerDir = importerPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const resolved = resolveRelativePath(importerDir, importSource)
    if (resolved === null) return null // unresolvable — '..' exceeded root
    candidateBase = resolved
  } else {
    // Bare specifier — unlikely to match project files but try anyway
    candidateBase = importSource
  }

  const normalized = candidateBase.replace(/\\/g, '/')

  // 1. Exact match (import source already includes extension)
  const exactMatch = lookup.exact.get(normalized)
  if (exactMatch) return exactMatch

  // 2. Extension-less match (most common: `import './utils'` -> `utils.ts`)
  const extMatch = lookup.withoutExt.get(normalized)
  if (extMatch) return extMatch

  // 3. Index/barrel file resolution (`import './components'` -> `components/index.ts`)
  const indexMatch = lookup.indexDirs.get(normalized)
  if (indexMatch) return indexMatch

  return null
}

// ---------------------------------------------------------------------------
// executeAnalyzeImports
// ---------------------------------------------------------------------------

function executeAnalyzeImports(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  const resolvedPath = file.path

  // --- Outgoing imports from the target file ---
  // Non-greedy .*? matches IMPORT_REGEX in structural-index.ts
  const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g
  const imports: string[] = []
  let m: RegExpExecArray | null
  while ((m = importRegex.exec(file.content)) !== null) imports.push(m[1])

  // --- Reverse lookup: which files import the target ---
  const paths = allPaths(codeIndex)
  const lookup = buildPathLookup(paths)

  // JS/TS import & re-export patterns
  const JS_IMPORT_RE = /import\s+.*?from\s+['"]([^'"]+)['"]/g
  const RE_EXPORT_RE = /export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/g
  const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  // Python import patterns
  const PY_IMPORT_RE = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g

  // F6: The reverse-lookup loop below is O(N) per call where N = total files in the index.
  // For repeated calls, caching the full reverse-import map per execution context would help.
  const importedBy: string[] = []

  for (const [filePath, otherFile] of codeIndex.files) {
    if (filePath === resolvedPath) continue

    let isImporter = false
    const ext = filePath.split('.').pop()?.toLowerCase() || ''

    if (['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs'].includes(ext)) {
      // JS/TS: check import statements, re-exports, and require() calls
      const regexes = [JS_IMPORT_RE, RE_EXPORT_RE, REQUIRE_RE]
      for (const baseRe of regexes) {
        if (isImporter) break
        // Create fresh instance to avoid shared lastIndex state
        const re = new RegExp(baseRe.source, baseRe.flags)
        let match: RegExpExecArray | null
        while ((match = re.exec(otherFile.content)) !== null) {
          if (resolveImportToFilePath(match[1], filePath, lookup) === resolvedPath) {
            isImporter = true
            break
          }
        }
      }
    } else if (ext === 'py') {
      // Python: convert dot-separated module path to file path
      const re = new RegExp(PY_IMPORT_RE.source, PY_IMPORT_RE.flags)
      let match: RegExpExecArray | null
      while ((match = re.exec(otherFile.content)) !== null) {
        const rawSource = match[1] || match[2]
        let importPath: string

        // Handle Python relative imports (.foo, ..foo)
        const relativeMatch = rawSource.match(/^(\.+)(.*)$/)
        if (relativeMatch) {
          const level = relativeMatch[1].length
          const rest = relativeMatch[2] ? relativeMatch[2].replace(/\./g, '/') : ''
          const prefix = level === 1 ? './' : '../'.repeat(level - 1)
          importPath = prefix + rest
        } else {
          // Absolute Python import: foo.bar.baz -> foo/bar/baz
          importPath = rawSource.replace(/\./g, '/')
        }

        if (resolveImportToFilePath(importPath, filePath, lookup) === resolvedPath) {
          isImporter = true
          break
        }
      }
    }
    // Rust/Go/Java: import paths are package-level and don't map cleanly
    // to file paths without language-specific resolution. Skipped for now.

    if (isImporter) {
      importedBy.push(filePath)
    }
  }

  return { path: resolvedPath, imports, importedBy: importedBy.slice(0, 30) }
}

function executeScanIssues(
  input: { path: string },
  codeIndex: CodeIndex,
  codebaseAnalysis?: Record<string, unknown> | null,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  // Build a single-file CodeIndex and run the real scanner
  let miniIndex = createEmptyIndex()
  miniIndex = indexFile(miniIndex, file.path, file.content, detectLang(file.path))
  const result = scanIssues(miniIndex, null)

  // Map CodeIssue to backward-compatible output shape
  const issues = result.issues.slice(0, 50).map(issue => ({
    line: issue.line,
    severity: issue.severity,
    message: issue.title,
    ruleId: issue.ruleId,
    confidence: issue.confidence,
    fix: issue.fix,
  }))

  return {
    path: file.path,
    issueCount: result.issues.length,
    issues,
    ...(codebaseAnalysis ? { codebaseContext: codebaseAnalysis } : {}),
  }
}

/**
 * Detect language from file extension for indexing.
 */
function detectLang(filePath: string): string {
  const ext = '.' + (filePath.split('.').pop() || '').toLowerCase()
  for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
    if (exts.includes(ext)) return lang.toLowerCase()
  }
  return 'text'
}

function executeGenerateDiagram(
  input: { type: string; focusFile?: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const paths = allPaths(codeIndex)

  if (input.type === 'summary') {
    const languages: Record<string, number> = {}
    for (const path of paths) {
      const ext = path.split('.').pop() || 'other'
      languages[ext] = (languages[ext] || 0) + 1
    }
    const sorted = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 8)
    let mermaid = 'pie title File Distribution\n'
    for (const [lang, count] of sorted) {
      mermaid += `  "${lang}" : ${count}\n`
    }
    return { type: input.type, mermaid, fileCount: paths.length }
  }

  if (input.type === 'topology' || input.type === 'import-graph') {
    const nodes = new Set<string>()
    const edges: Array<{ from: string; to: string }> = []

    for (const [filePath, file] of codeIndex.files) {
      const dir = filePath.split('/').slice(0, -1).join('/') || '(root)'
      nodes.add(dir)
      const importRegex = /import\s+.*from\s+['"](@\/[^'"]+|\.\.?\/[^'"]+)['"]/g
      let m
      while ((m = importRegex.exec(file.content)) !== null) {
        const importPath = m[1].replace(/\.\w+$/, '')
        const parts = importPath.split('/')
        const targetDir = parts.slice(0, -1).join('/') || '(root)'
        if (targetDir !== dir) {
          nodes.add(targetDir)
          edges.push({ from: dir, to: targetDir })
        }
      }
    }

    const allUniqueEdges = [...new Set(edges.map(e => `${e.from}|||${e.to}`))]
      .map(e => {
        const [from, to] = e.split('|||')
        return { from, to }
      })
    const totalEdges = allUniqueEdges.length
    const uniqueEdges = allUniqueEdges.slice(0, 30)

    let mermaid = 'graph LR\n'
    for (const edge of uniqueEdges) {
      const fromId = edge.from.replace(/[^a-zA-Z0-9]/g, '_')
      const toId = edge.to.replace(/[^a-zA-Z0-9]/g, '_')
      mermaid += `  ${fromId}["${edge.from}"] --> ${toId}["${edge.to}"]\n`
    }
    return { type: input.type, mermaid, nodeCount: nodes.size, edgeCount: uniqueEdges.length, totalEdges }
  }

  return { error: `Unsupported diagram type: ${input.type}` }
}

function executeGetProjectOverview(
  codeIndex: CodeIndex,
  repoMeta?: ToolExecutorOptions['repoMeta'],
  allFilePaths?: string[],
): Record<string, unknown> {
  const paths = allPaths(codeIndex)
  // F11: Use allFilePaths for pattern detection when available
  const detectionPaths = allFilePaths && allFilePaths.length > 0 ? allFilePaths : paths
  const languages: Record<string, number> = {}
  const folders: Record<string, number> = {}
  let totalLines = 0

  for (const [path, file] of codeIndex.files) {
    const ext = path.split('.').pop() || 'other'
    languages[ext] = (languages[ext] || 0) + 1
    const dir = path.split('/')[0] || '(root)'
    folders[dir] = (folders[dir] || 0) + 1
    totalLines += file.lineCount
  }

  return {
    totalFiles: paths.length,
    totalLines,
    languages: Object.entries(languages).sort((a, b) => b[1] - a[1]),
    topFolders: Object.entries(folders).sort((a, b) => b[1] - a[1]).slice(0, 15),
    hasTests: detectionPaths.some(p => p.includes('.test.') || p.includes('.spec.') || p.includes('__tests__')),
    hasConfig: detectionPaths.some(p => p.includes('tsconfig') || p.includes('package.json')),
    entryPoints: paths.filter(p => p.match(/(index|main|app|page)\.(ts|tsx|js|jsx)$/)).slice(0, 10),
    ...(repoMeta ? { repoMeta } : {}),
  }
}

// ---------------------------------------------------------------------------
// generateTour
// ---------------------------------------------------------------------------

/** Patterns for locating architecturally significant declarations in a file. */
const DECLARATION_PATTERNS = [
  // Exported declarations (highest priority)
  /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
  /^export\s+(?:default\s+)?class\s+(\w+)/,
  /^export\s+(?:default\s+)?(?:const|let)\s+(\w+)/,
  /^export\s+(?:default\s+)?interface\s+(\w+)/,
  /^export\s+(?:default\s+)?type\s+(\w+)/,
  /^export\s+(?:default\s+)?enum\s+(\w+)/,
  // Non-exported declarations (fallback)
  /^(?:async\s+)?function\s+(\w+)/,
  /^class\s+(\w+)/,
  /^(?:const|let)\s+(\w+)\s*=/,
  /^def\s+(\w+)/,
]

/** File name patterns that indicate architecturally significant files. */
const SIGNIFICANT_FILE_PATTERNS = [
  /readme/i,
  /^index\.(ts|tsx|js|jsx)$/,
  /^main\.(ts|tsx|js|jsx)$/,
  /^app\.(ts|tsx|js|jsx)$/,
  /^page\.(ts|tsx|js|jsx)$/,
  /config/i,
  /^layout\.(ts|tsx|js|jsx)$/,
  /^route\.(ts|tsx|js|jsx)$/,
]

/**
 * Find the first significant declaration in a file and return its line range.
 * Falls back to lines 1–20 if nothing matches.
 */
function findSignificantRange(
  lines: string[],
): { startLine: number; endLine: number; title: string } {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    for (const pattern of DECLARATION_PATTERNS) {
      const match = pattern.exec(trimmed)
      if (match) {
        const name = match[1] || 'default export'
        // Capture the declaration + a reasonable amount of body
        const endLine = Math.min(lines.length, i + 15)
        return { startLine: i + 1, endLine, title: name }
      }
    }
  }
  return { startLine: 1, endLine: Math.min(20, lines.length), title: 'File overview' }
}

/**
 * Score a file for architectural significance. Higher is more significant.
 */
function significanceScore(path: string, file: { lineCount: number; content: string }): number {
  let score = 0
  const fileName = path.split('/').pop() || ''

  for (const pattern of SIGNIFICANT_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      score += 10
      break
    }
  }

  // Files with many exports are likely important modules
  const exportCount = (file.content.match(/^export\s/gm) || []).length
  score += Math.min(exportCount, 10)

  // Prefer files that aren't tests
  if (path.includes('.test.') || path.includes('.spec.') || path.includes('__tests__')) {
    score -= 20
  }

  // Prefer source files over generated/config
  if (path.endsWith('.json') || path.endsWith('.lock') || path.endsWith('.md')) {
    score -= 5
  }

  return score
}

/**
 * Generate a brief annotation for a tour stop describing the file's role.
 */
/** Escape characters that have special meaning in markdown. */
function escapeMd(text: string): string {
  return text.replace(/[\[\]()_*`]/g, '\\$&')
}

function generateAnnotation(path: string, lines: string[], title: string): string {
  const fileName = path.split('/').pop() || path
  const dir = path.split('/').slice(0, -1).join('/') || '(root)'

  const safeFileName = escapeMd(fileName)
  const safeDir = escapeMd(dir)
  const safeTitle = escapeMd(title)

  // Count imports/exports for context
  const exportCount = lines.filter(l => l.trimStart().startsWith('export ')).length
  const importCount = lines.filter(l => l.trimStart().startsWith('import ')).length

  let description = `**${safeFileName}** in \`${safeDir}\``
  if (exportCount > 0) {
    description += ` — exports ${exportCount} symbol${exportCount > 1 ? 's' : ''}`
  }
  if (importCount > 0) {
    description += `, imports from ${importCount} module${importCount > 1 ? 's' : ''}`
  }
  description += '.'

  if (title !== 'File overview') {
    description += ` This stop highlights the \`${safeTitle}\` declaration.`
  }

  return description
}

function executeGenerateTour(
  input: { repoKey: string; theme?: string; maxStops?: number },
  codeIndex: CodeIndex,
  repoContext?: { name: string },
): Record<string, unknown> {
  // F12: Override repoKey with validated repo name when available
  const repoKey = repoContext?.name || input.repoKey
  const maxStops = input.maxStops ?? 8
  const paths = allPaths(codeIndex)

  if (paths.length === 0) {
    return { error: 'No files in code index' }
  }

  // Select files based on theme or architectural significance
  let candidateFiles: Array<{ path: string; file: IndexedFile }>

  if (input.theme) {
    // Theme-based: search the index for relevant files
    const searchResults = searchIndex(codeIndex, input.theme)
    const matched = new Set<string>()

    candidateFiles = []
    for (const sr of searchResults) {
      if (matched.has(sr.file)) continue
      matched.add(sr.file)
      const file = codeIndex.files.get(sr.file)
      if (file) {
        candidateFiles.push({ path: sr.file, file })
      }
    }

    // If theme search yields too few results, supplement with significant files
    if (candidateFiles.length < maxStops) {
      for (const [path, file] of codeIndex.files) {
        if (matched.has(path)) continue
        if (candidateFiles.length >= maxStops * 2) break
        candidateFiles.push({ path, file })
      }
    }
  } else {
    // General tour: rank all files by architectural significance
    candidateFiles = Array.from(codeIndex.files.entries()).map(([path, file]) => ({
      path,
      file,
    }))
  }

  // Filter out test files and non-source assets for cleaner tours
  candidateFiles = candidateFiles.filter(({ path }) => {
    if (path.includes('.test.') || path.includes('.spec.') || path.includes('__tests__')) return false
    if (path.endsWith('.lock') || path.endsWith('.map')) return false
    return true
  })

  // Score and sort candidates
  candidateFiles.sort((a, b) => {
    const scoreA = significanceScore(a.path, a.file)
    const scoreB = significanceScore(b.path, b.file)
    return scoreB - scoreA
  })

  // Take top candidates
  const selected = candidateFiles.slice(0, maxStops)

  // Build tour stops
  const stops: TourStop[] = selected.map(({ path, file }) => {
    const { startLine, endLine, title } = findSignificantRange(getFileLines(file))
    const annotation = generateAnnotation(path, getFileLines(file), title)

    return {
      id: crypto.randomUUID(),
      filePath: path,
      startLine,
      endLine,
      title,
      annotation,
    }
  })

  const tourName = input.theme
    ? `${input.theme.charAt(0).toUpperCase() + input.theme.slice(1)} Tour`
    : 'Architecture Tour'

  const tourDescription = input.theme
    ? `A guided tour focused on ${input.theme} in this codebase.`
    : 'A guided tour of the key architectural files in this codebase.'

  const now = Date.now()

  const tour: Tour = {
    id: crypto.randomUUID(),
    name: tourName,
    description: tourDescription,
    repoKey,
    stops,
    createdAt: now,
    updatedAt: now,
  }

  return { tour, stopCount: stops.length }
}
