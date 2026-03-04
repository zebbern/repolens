import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'

interface FileMetadata {
  path: string
  language: string
  lineCount: number
  exports?: string[]
  imports?: string[]
  symbols?: string[]
}

// Regex patterns for extracting symbol definitions (mirrored in client-tool-executor.ts executeFindSymbol with different kind labels)
const SYMBOL_PATTERNS = [
  { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'fn' },
  { regex: /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g, kind: 'fn' },
  { regex: /(?:export\s+)?class\s+(\w+)/g, kind: 'class' },
  { regex: /(?:export\s+)?interface\s+(\w+)/g, kind: 'iface' },
  { regex: /(?:export\s+)?type\s+(\w+)\s*[=<{]/g, kind: 'type' },
  { regex: /(?:export\s+)?enum\s+(\w+)/g, kind: 'enum' },
] as const

const IMPORT_REGEX = /import\s+.*?from\s+['"]([^'"]+)['"]/g
const EXPORT_REGEX = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/

const MAX_INDEX_BYTES = 300_000

/**
 * Build a compact structural index string from CodeIndex for inclusion in
 * the AI system prompt.  This replaces the old approach of sending raw file
 * contents to the server — the client now executes tools locally and only
 * sends lightweight metadata so the model knows what files exist.
 *
 * The enriched index includes exports, imports, and key symbol definitions
 * so the AI can make informed decisions about which files to read.
 */
export function buildStructuralIndex(codeIndex: CodeIndex | null): string {
  if (!codeIndex?.files || codeIndex.files.size === 0) return ''

  const metadata: FileMetadata[] = []

  for (const [path, file] of codeIndex.files) {
    const entry: FileMetadata = {
      path,
      language: file.language || inferLanguage(path),
      lineCount: file.lineCount,
    }

    // Extract structural info for code files (skip non-code like JSON, markdown, etc.)
    if (isCodeFile(path)) {
      const extracted = extractStructure(file)
      if (extracted.exports.length > 0) entry.exports = extracted.exports
      if (extracted.imports.length > 0) entry.imports = extracted.imports
      if (extracted.symbols.length > 0) entry.symbols = extracted.symbols
    }

    metadata.push(entry)
  }

  // Filter out code files with no structural info (no exports, imports, or symbols)
  const filtered = metadata.filter(
    entry => !isCodeFile(entry.path) || entry.exports || entry.imports || entry.symbols,
  )

  let result = JSON.stringify(filtered)
  if (result.length <= MAX_INDEX_BYTES) return result

  // Progressive trimming: drop symbols → imports → exports,
  // starting from files with fewest exports
  const sortedByExports = [...filtered].sort(
    (a, b) => (a.exports?.length ?? 0) - (b.exports?.length ?? 0),
  )

  for (const field of ['symbols', 'imports', 'exports'] as const) {
    for (const entry of sortedByExports) {
      if (entry[field]) {
        delete entry[field]
        result = JSON.stringify(filtered)
        if (result.length <= MAX_INDEX_BYTES) return result
      }
    }
  }

  return result
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

/** Extract exports, imports, and symbol definitions from a file. */
function extractStructure(file: IndexedFile): {
  exports: string[]
  imports: string[]
  symbols: string[]
} {
  const exports: string[] = []
  const imports: string[] = []
  const symbols = new Set<string>()

  // Extract imports
  IMPORT_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMPORT_REGEX.exec(file.content)) !== null) {
    imports.push(m[1])
  }

  // Extract exports + symbols line-by-line
  for (const line of file.lines) {
    // Named exports
    const exportMatch = EXPORT_REGEX.exec(line)
    if (exportMatch) {
      exports.push(exportMatch[1])
    }

    // Symbol definitions (exported or not)
    for (const pat of SYMBOL_PATTERNS) {
      pat.regex.lastIndex = 0
      let sm: RegExpExecArray | null
      while ((sm = pat.regex.exec(line)) !== null) {
        const sig = extractSignature(line, sm[1], pat.kind)
        symbols.add(`${pat.kind}:${sig}`)
      }
    }
  }

  // Also catch `export default` and `export { ... }` patterns
  const reExportRegex = /export\s*\{([^}]+)\}/g
  reExportRegex.lastIndex = 0
  while ((m = reExportRegex.exec(file.content)) !== null) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean)
    for (const name of names) {
      if (name) exports.push(name)
    }
  }

  return {
    exports: [...new Set(exports)].slice(0, 15),
    imports: imports.slice(0, 15),
    symbols: [...symbols].slice(0, 15),
  }
}

/** Check if a file is a code file worth extracting structure from. */
function isCodeFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs', 'py', 'rs', 'go', 'java'].includes(ext)
}

/** Infer language from file extension when metadata is missing. */
function inferLanguage(filePath: string): string {
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
