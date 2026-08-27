import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'
import type { RepositoryCoverage } from '@/types/repository'
import { getFileLines, getFileContent, getFileLinesAsync, resolveFileContentBatches } from '@/lib/code/code-index'
import { coverageNotice } from '@/lib/repository'

export interface RichFileMetadata {
  path: string
  language: string
  lineCount: number
  /** False when the index has no source-derived line count for this file. */
  lineCountKnown?: boolean
  exports?: string[]
  imports?: string[]
  signatures?: string[]
  coverageNotice?: string
  repositoryCoverage?: RepositoryCoverage
}

// Regex patterns for extracting symbol definitions
export const SYMBOL_PATTERNS = [
  { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'fn' },
  { regex: /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g, kind: 'fn' },
  { regex: /(?:export\s+)?class\s+(\w+)/g, kind: 'class' },
  { regex: /(?:export\s+)?interface\s+(\w+)/g, kind: 'iface' },
  { regex: /(?:export\s+)?type\s+(\w+)\s*[=<{]/g, kind: 'type' },
  { regex: /(?:export\s+)?enum\s+(\w+)/g, kind: 'enum' },
] as const

export const IMPORT_REGEX = /import\s+.*?from\s+['"]([^'"]+)['"]/g
const EXPORT_REGEX = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/

const MAX_INDEX_BYTES = 300_000
const STRUCTURAL_BATCH_SIZE = 50
const textEncoder = new TextEncoder()

const INDEX_TRUNCATED_ENTRY: RichFileMetadata = {
  path: '[index-truncated]',
  language: 'metadata',
  lineCount: 0,
  coverageNotice: 'Structural index truncated to the configured byte limit',
}

/** Per-file structural extraction limits. */
const MAX_EXPORTS_PER_FILE = 50
const MAX_IMPORTS_PER_FILE = 15
const MAX_SIGNATURES_PER_FILE = 20

/**
 * Build a compact structural index string from CodeIndex for inclusion in
 * the AI system prompt.  This replaces the old approach of sending raw file
 * contents to the server — the client now executes tools locally and only
 * sends lightweight metadata so the model knows what files exist.
 *
 * The enriched index includes exports, imports, and key symbol definitions
 * so the AI can make informed decisions about which files to read.
 */
export function buildStructuralIndex(
  codeIndex: CodeIndex | null,
  options?: { maxIndexBytes?: number },
): string {
  if (!codeIndex?.files) return ''

  const maxBytes = options?.maxIndexBytes ?? MAX_INDEX_BYTES
  const metadata: RichFileMetadata[] = []
  let usedBytes = 2
  const truncationBytes = encodedJsonBytes(INDEX_TRUNCATED_ENTRY) + 1
  let truncated = false

  for (const [path, file] of codeIndex.files) {
    const entry = buildStructuralEntry(path, file)
    const entryBytes = encodedJsonBytes(entry) + (metadata.length > 0 ? 1 : 0)
    if (usedBytes + entryBytes + truncationBytes > maxBytes) {
      truncated = true
      break
    }
    metadata.push(entry)
    usedBytes += entryBytes
  }

  if (truncated) metadata.push({ ...INDEX_TRUNCATED_ENTRY })

  return serializeStructuralMetadata(metadata, codeIndex.coverage, maxBytes)
}

/** Build the structural index after resolving metadata-only source from ContentStore. */
export async function buildStructuralIndexAsync(
  codeIndex: CodeIndex | null,
  options?: { maxIndexBytes?: number },
): Promise<string> {
  if (!codeIndex?.files) return ''
  const maxBytes = options?.maxIndexBytes ?? MAX_INDEX_BYTES
  const metadata: RichFileMetadata[] = []
  const paths = [...codeIndex.files.keys()]
  const truncationBytes = encodedJsonBytes(INDEX_TRUNCATED_ENTRY) + 1
  let usedBytes = 2
  let missingCount = 0
  let truncated = false

  outer: for (let offset = 0; offset < paths.length; offset += STRUCTURAL_BATCH_SIZE) {
    const batchPaths = paths.slice(offset, offset + STRUCTURAL_BATCH_SIZE)
    const codePaths = batchPaths.filter(isCodeFile)
    const contents = new Map<string, string>()
    const missing = new Set<string>()
    for await (const batch of resolveFileContentBatches(codeIndex, codePaths, { batchSize: STRUCTURAL_BATCH_SIZE })) {
      for (const [path, content] of batch.contents) contents.set(path, content)
      for (const path of batch.missingPaths) missing.add(path)
    }
    missingCount += missing.size

    for (const path of batchPaths) {
      const file = codeIndex.files.get(path)
      if (!file) continue
      const content = contents.get(path)
      const entry = buildStructuralEntry(path, content === undefined
        ? file
        : {
            ...file,
            content,
            lineCount: content.split('\n').length,
            lineCountKnown: true,
          })
      const entryBytes = encodedJsonBytes(entry) + (metadata.length > 0 ? 1 : 0)
      if (usedBytes + entryBytes + truncationBytes > maxBytes) {
        truncated = true
        break outer
      }
      metadata.push(entry)
      usedBytes += entryBytes
    }
  }

  if (missingCount > 0) {
    metadata.unshift({
      path: '[content-coverage]',
      language: 'metadata',
      lineCount: 0,
      coverageNotice: `Content unavailable for ${missingCount} indexed file${missingCount === 1 ? '' : 's'}`,
    })
  }
  if (truncated) metadata.push({ ...INDEX_TRUNCATED_ENTRY })
  return serializeStructuralMetadata(metadata, codeIndex.coverage, maxBytes)
}

function buildStructuralEntry(path: string, file: IndexedFile): RichFileMetadata {
  const entry: RichFileMetadata = {
    path,
    language: file.language || inferLanguage(path),
    lineCount: file.lineCount,
    ...(file.lineCountKnown === false ? { lineCountKnown: false } : {}),
  }

  if (!isCodeFile(path) || typeof file.content !== 'string') return entry

  const exports = extractExports(file)
  const imports = extractImports(file)
  const signatures = extractSignatures(file)
  if (exports.length > MAX_EXPORTS_PER_FILE) {
    entry.exports = [
      ...exports.slice(0, MAX_EXPORTS_PER_FILE),
      `...(${exports.length - MAX_EXPORTS_PER_FILE} more)`,
    ]
  } else if (exports.length > 0) {
    entry.exports = exports
  }
  if (imports.length > 0) entry.imports = imports.slice(0, MAX_IMPORTS_PER_FILE)
  if (signatures.length > 0) entry.signatures = signatures.slice(0, MAX_SIGNATURES_PER_FILE)
  return entry
}

function encodedJsonBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).byteLength
}

function serializeStructuralMetadata(
  metadata: RichFileMetadata[],
  coverage: RepositoryCoverage | undefined,
  maxBytes: number,
): string {
  if (!Number.isFinite(maxBytes) || maxBytes < 2) return ''
  const working = metadata.map(entry => ({ ...entry }))
  const notice = coverageNotice(coverage)
  if (notice) {
    working.unshift({
      path: '[repository-coverage]',
      language: 'metadata',
      lineCount: 0,
      coverageNotice: notice,
      repositoryCoverage: coverage,
    })
  }

  if (working.length === 0) return ''

  let result = JSON.stringify(working)
  if (textEncoder.encode(result).byteLength <= maxBytes) return result

  // Progressive trimming: drop signatures → imports → exports,
  // starting from files with fewest exports
  const sortedByExports = [...working].sort(
    (a, b) => (a.exports?.length ?? 0) - (b.exports?.length ?? 0),
  )

  for (const field of ['signatures', 'imports', 'exports'] as const) {
    for (const entry of sortedByExports) {
      if (entry[field]) {
        delete entry[field]
        result = JSON.stringify(working)
        if (textEncoder.encode(result).byteLength <= maxBytes) return result
      }
    }
  }

  let removedFile = false
  while (textEncoder.encode(result).byteLength > maxBytes) {
    const index = working.findLastIndex(entry => !entry.path.startsWith('['))
    if (index < 0) break
    working.splice(index, 1)
    removedFile = true
    result = JSON.stringify(working)
  }

  if (removedFile && !working.some(entry => entry.path === INDEX_TRUNCATED_ENTRY.path)) {
    working.push({ ...INDEX_TRUNCATED_ENTRY })
    result = JSON.stringify(working)
    while (textEncoder.encode(result).byteLength > maxBytes) {
      const index = working.findLastIndex(entry => !entry.path.startsWith('['))
      if (index < 0) break
      working.splice(index, 1)
      result = JSON.stringify(working)
    }
  }

  for (const entry of working) delete entry.repositoryCoverage
  result = JSON.stringify(working)
  if (textEncoder.encode(result).byteLength <= maxBytes) return result

  // Preserve a valid JSON array and the most important truncation signal even
  // for very small caller budgets.
  const minimal = [{ ...INDEX_TRUNCATED_ENTRY }]
  let low = 0
  let high = INDEX_TRUNCATED_ENTRY.coverageNotice!.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    minimal[0].coverageNotice = INDEX_TRUNCATED_ENTRY.coverageNotice!.slice(0, mid)
    if (encodedJsonBytes(minimal) <= maxBytes) low = mid
    else high = mid - 1
  }
  minimal[0].coverageNotice = INDEX_TRUNCATED_ENTRY.coverageNotice!.slice(0, low)
  return encodedJsonBytes(minimal) <= maxBytes ? JSON.stringify(minimal) : '[]'
}

/**
 * Extract a clean signature from a source line for a detected symbol.
 * For functions: captures name, params, and return type.
 * For classes/interfaces: captures name plus extends/implements.
 * For types: captures name plus generic parameters.
 * Signatures are capped at 100 characters.
 */
export function extractSignature(line: string, name: string, kind: string): string {
  const nameIdx = line.indexOf(name)
  if (nameIdx === -1) return name
  const fromName = line.substring(nameIdx)

  if (kind === 'fn' || kind === 'function') {
    // Arrow / const function: name = [async] (params)[: ReturnType] [=>]
    const arrowMatch = fromName.match(
      /^(\w+)\s*=\s*(?:async\s+)?\(([^()]*(?:\([^()]*\)[^()]*)*)\)(?:\s*:\s*(.+?))?(?:\s*=>|\s*$)/,
    )
    if (arrowMatch) {
      const sig = arrowMatch[3]
        ? `${arrowMatch[1]}(${arrowMatch[2]}): ${arrowMatch[3].trim()}`
        : `${arrowMatch[1]}(${arrowMatch[2]})`
      return sig.slice(0, 100)
    }
    // Function declaration: name[<generics>](params)[: ReturnType] [{]
    const funcMatch = fromName.match(
      /^(\w+(?:<[^>]*>)?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)(?:\s*:\s*(.+?))?(?:\s*\{|\s*$)/,
    )
    if (funcMatch) {
      const sig = funcMatch[3]
        ? `${funcMatch[1]}(${funcMatch[2]}): ${funcMatch[3].trim()}`
        : `${funcMatch[1]}(${funcMatch[2]})`
      return sig.slice(0, 100)
    }
  }

  if (kind === 'class' || kind === 'iface' || kind === 'interface') {
    const sigMatch = fromName.match(
      /^(\w+(?:<[^>]*>)?(?:\s+extends\s+\S+)?(?:\s+implements\s+[^{]+)?)/,
    )
    if (sigMatch) return sigMatch[1].trim().slice(0, 100)
  }

  if (kind === 'type') {
    const sigMatch = fromName.match(/^(\w+(?:<[^>]+>)?)/)
    if (sigMatch) return sigMatch[1].trim().slice(0, 100)
  }

  return name
}

/** Get language-specific symbol patterns for structural extraction. */
export function getLanguagePatterns(language: string): ReadonlyArray<{ regex: RegExp; kind: string }> {
  switch (language) {
    case 'python':
      return [
        { regex: /(?:async\s+)?def\s+(\w+)/g, kind: 'fn' },
        { regex: /class\s+(\w+)/g, kind: 'class' },
        { regex: /^([A-Z]\w*)\s*=/gm, kind: 'const' },
      ]
    case 'rust':
      return [
        { regex: /(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/g, kind: 'fn' },
        { regex: /(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/g, kind: 'struct' },
        { regex: /(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/g, kind: 'enum' },
        { regex: /(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/g, kind: 'trait' },
        { regex: /impl(?:<[^>]*>)?\s+(?:\w+\s+for\s+)?(\w+)/g, kind: 'impl' },
        { regex: /(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)/g, kind: 'type' },
        { regex: /(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/g, kind: 'mod' },
      ]
    case 'go':
      return [
        { regex: /func\s+(?:\([^)]+\)\s+)?(\w+)/g, kind: 'fn' },
        { regex: /type\s+(\w+)\s+struct/g, kind: 'struct' },
        { regex: /type\s+(\w+)\s+interface/g, kind: 'iface' },
      ]
    case 'java':
      return [
        { regex: /(?:public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/g, kind: 'class' },
        { regex: /(?:public|private|protected)\s+(?:static\s+)?interface\s+(\w+)/g, kind: 'iface' },
        { regex: /(?:public|private|protected)\s+(?:static\s+)?enum\s+(\w+)/g, kind: 'enum' },
        { regex: /(?:public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/g, kind: 'fn' },
      ]
    default:
      // TypeScript / JavaScript — return fresh instances to avoid shared /g state
      return SYMBOL_PATTERNS.map(pat => ({
        regex: new RegExp(pat.regex.source, pat.regex.flags),
        kind: pat.kind,
      }))
  }
}

/** Get the import regex for a specific language. */
export function getImportRegex(language: string): RegExp | null {
  switch (language) {
    case 'python':
      return /(?:from\s+(\S+)\s+import|import\s+(\S+))/g
    case 'rust':
      return /use\s+([^;{]+)/g
    case 'go':
      return /import\s+"([^"]+)"/g
    case 'java':
      return /import\s+([^;]+)/g
    default:
      return new RegExp(IMPORT_REGEX.source, IMPORT_REGEX.flags) // fresh instance to avoid shared /g state
  }
}

/** Get the export regex for a specific language. Returns null for languages without explicit exports. */
export function getExportRegex(language: string): RegExp | null {
  switch (language) {
    case 'python':
    case 'go':
      return null // No explicit export syntax; all top-level defs are "exports"
    case 'rust':
      return /^pub\s+(?:(?:async\s+)?fn|struct|enum|trait|type|const|static|mod)\s+(\w+)/
    case 'java':
      return /^public\s+(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum|(?:\w+(?:<[^>]*>)?)\s+)(\w+)/
    default:
      return new RegExp(EXPORT_REGEX.source, EXPORT_REGEX.flags)
  }
}

/** Extract exported symbol names from a file. */
export function extractExports(file: IndexedFile): string[] {
  const language = inferLanguage(file.path)
  const symbolPatterns = getLanguagePatterns(language)
  const exportRegex = getExportRegex(language)
  const exports: string[] = []

  for (const line of getFileLines(file)) {
    if (exportRegex) {
      const exportMatch = exportRegex.exec(line)
      if (exportMatch) {
        exports.push(exportMatch[1])
      }
    } else if (language === 'python' || language === 'go') {
      // For Python/Go: treat top-level defs as exports
      for (const pat of symbolPatterns) {
        pat.regex.lastIndex = 0
        const sm = pat.regex.exec(line)
        if (sm && !line.startsWith(' ') && !line.startsWith('\t')) {
          exports.push(sm[1])
        }
      }
    }
  }

  // Also catch re-exports for JS/TS
  if (language === 'typescript' || language === 'tsx' || language === 'javascript' || language === 'jsx') {
    const reExportRegex = /export\s*\{([^}]+)\}/g
    reExportRegex.lastIndex = 0
    let m: RegExpExecArray | null
    const content = file.content
    while (typeof content === 'string' && (m = reExportRegex.exec(content)) !== null) {
      const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean)
      for (const name of names) {
        if (name) exports.push(name)
      }
    }
  }

  return [...new Set(exports)]
}

/** Extract import source paths from a file. */
export function extractImports(file: IndexedFile): string[] {
  const language = inferLanguage(file.path)
  const importRegex = getImportRegex(language)
  const imports: string[] = []

  if (importRegex) {
    importRegex.lastIndex = 0
    let m: RegExpExecArray | null
    const content = file.content
    while (typeof content === 'string' && (m = importRegex.exec(content)) !== null) {
      // Some language regexes have multiple capture groups (e.g. Python)
      const importName = m[1] || m[2]
      if (importName) imports.push(importName.trim())
    }
  }

  return imports
}

/** Extract symbol signatures (function, class, type definitions) from a file. */
export function extractSignatures(file: IndexedFile): string[] {
  const language = inferLanguage(file.path)
  const symbolPatterns = getLanguagePatterns(language)
  const symbols = new Set<string>()

  for (const line of getFileLines(file)) {
    for (const pat of symbolPatterns) {
      pat.regex.lastIndex = 0
      let sm: RegExpExecArray | null
      while ((sm = pat.regex.exec(line)) !== null) {
        const sig = extractSignature(line, sm[1], pat.kind)
        symbols.add(`${pat.kind}:${sig}`)
      }
    }
  }

  return [...symbols]
}

/** Async variant of extractExports — resolves content from contentStore. */
export async function extractExportsAsync(path: string, index: CodeIndex): Promise<string[]> {
  const language = inferLanguage(path)
  const symbolPatterns = getLanguagePatterns(language)
  const exportRegex = getExportRegex(language)
  const exports: string[] = []

  const lines = await getFileLinesAsync(index, path)
  if (!lines) return []

  for (const line of lines) {
    if (exportRegex) {
      const exportMatch = exportRegex.exec(line)
      if (exportMatch) {
        exports.push(exportMatch[1])
      }
    } else if (language === 'python' || language === 'go') {
      for (const pat of symbolPatterns) {
        pat.regex.lastIndex = 0
        const sm = pat.regex.exec(line)
        if (sm && !line.startsWith(' ') && !line.startsWith('\t')) {
          exports.push(sm[1])
        }
      }
    }
  }

  if (language === 'typescript' || language === 'tsx' || language === 'javascript' || language === 'jsx') {
    const content = await getFileContent(index, path)
    if (content !== null) {
      const reExportRegex = /export\s*\{([^}]+)\}/g
      reExportRegex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = reExportRegex.exec(content)) !== null) {
        const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean)
        for (const name of names) {
          if (name) exports.push(name)
        }
      }
    }
  }

  return [...new Set(exports)]
}

/** Async variant of extractImports — resolves content from contentStore. */
export async function extractImportsAsync(path: string, index: CodeIndex): Promise<string[]> {
  const language = inferLanguage(path)
  const importRegex = getImportRegex(language)
  const imports: string[] = []

  if (importRegex) {
    const content = await getFileContent(index, path)
    if (content !== null) {
      importRegex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = importRegex.exec(content)) !== null) {
        const importName = m[1] || m[2]
        if (importName) imports.push(importName.trim())
      }
    }
  }

  return imports
}

/** Async variant of extractSignatures — resolves content from contentStore. */
export async function extractSignaturesAsync(path: string, index: CodeIndex): Promise<string[]> {
  const language = inferLanguage(path)
  const symbolPatterns = getLanguagePatterns(language)
  const symbols = new Set<string>()

  const lines = await getFileLinesAsync(index, path)
  if (!lines) return []

  for (const line of lines) {
    for (const pat of symbolPatterns) {
      pat.regex.lastIndex = 0
      let sm: RegExpExecArray | null
      while ((sm = pat.regex.exec(line)) !== null) {
        const sig = extractSignature(line, sm[1], pat.kind)
        symbols.add(`${pat.kind}:${sig}`)
      }
    }
  }

  return [...symbols]
}

/** Check if a file is a code file worth extracting structure from. */
export function isCodeFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'py', 'rs', 'go', 'java'].includes(ext)
}

/** Infer language from file extension when metadata is missing. */
export function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
  }
  return map[ext] || ext || 'unknown'
}
