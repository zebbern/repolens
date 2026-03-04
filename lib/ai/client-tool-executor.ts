import type { CodeIndex, IndexedFile } from '@/lib/code/code-index'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes tool calls locally using the client-side CodeIndex.
 */
export function executeToolLocally(
  toolName: string,
  input: Record<string, unknown>,
  codeIndex: CodeIndex | null,
): string {
  if (!codeIndex?.files || codeIndex.files.size === 0) {
    return JSON.stringify({ error: 'No codebase loaded' })
  }

  switch (toolName) {
    case 'readFile':
      return JSON.stringify(executeReadFile(input as { path: string; startLine?: number; endLine?: number }, codeIndex))
    case 'readFiles':
      return JSON.stringify(executeReadFiles(input as { paths: string[] }, codeIndex))
    case 'searchFiles':
      return JSON.stringify(executeSearchFiles(input as { query: string; maxResults?: number | null; isRegex?: boolean }, codeIndex))
    case 'listDirectory':
      return JSON.stringify(executeListDirectory(input as { path: string }, codeIndex))
    case 'findSymbol':
      return JSON.stringify(executeFindSymbol(input as { name: string; kind?: string }, codeIndex))
    case 'getFileStats':
      return JSON.stringify(executeGetFileStats(input as { path: string }, codeIndex))
    case 'analyzeImports':
      return JSON.stringify(executeAnalyzeImports(input as { path: string }, codeIndex))
    case 'scanIssues':
      return JSON.stringify(executeScanIssues(input as { path: string }, codeIndex))
    case 'generateDiagram':
      return JSON.stringify(executeGenerateDiagram(input as { type: string; focusFile?: string }, codeIndex))
    case 'getProjectOverview':
      return JSON.stringify(executeGetProjectOverview(codeIndex))
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allPaths(codeIndex: CodeIndex): string[] {
  return Array.from(codeIndex.files.keys()).sort()
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

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function executeReadFile(
  input: { path: string; startLine?: number; endLine?: number },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const resolvedPath = input.path
  let content = getContent(codeIndex, resolvedPath)
  let usedPath = resolvedPath

  if (!content) {
    const paths = allPaths(codeIndex)
    const match = paths.find(p => p.endsWith('/' + resolvedPath)) ?? paths.find(p => p.endsWith(resolvedPath))
    if (match) {
      content = getContent(codeIndex, match)!
      usedPath = match
    } else {
      return { error: `File not found: ${resolvedPath}. Use searchFiles or check the file tree.` }
    }
  }

  const lines = content.split('\n')
  const totalLines = lines.length

  if (input.startLine !== undefined || input.endLine !== undefined) {
    const start = Math.max(1, input.startLine ?? 1) - 1 // 0-based
    const end = Math.min(totalLines, input.endLine ?? totalLines)
    const sliced = lines.slice(start, end)
    return { path: usedPath, content: sliced.join('\n'), startLine: start + 1, endLine: end, totalLines }
  }

  return { path: usedPath, content, lineCount: totalLines, totalLines }
}

function executeReadFiles(
  input: { paths: string[] },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const results = input.paths.map(p => executeReadFile({ path: p }, codeIndex))
  return { files: results }
}

function executeSearchFiles(
  input: { query: string; maxResults?: number | null; isRegex?: boolean },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const limit = input.maxResults ?? 15
  const paths = allPaths(codeIndex)
  const results: Array<{ path: string; matchType: 'path' | 'content'; matches?: Array<{ line: number; content: string; context?: string[] }>; totalMatches?: number }> = []

  // Build matcher: regex or plain case-insensitive substring
  const matcher = buildMatcher(input.query, input.isRegex)
  if (matcher.error) {
    return { error: matcher.error }
  }
  const { test, warning } = matcher

  for (const path of paths) {
    if (results.length >= limit) break
    if (test(path)) {
      results.push({ path, matchType: 'path' })
    }
  }

  if (results.length < limit) {
    for (const [path, file] of codeIndex.files) {
      if (results.length >= limit) break
      if (results.some(r => r.path === path)) continue
      const lines = file.lines
      const matches: Array<{ line: number; content: string; context?: string[] }> = []
      let totalMatches = 0
      for (let i = 0; i < lines.length; i++) {
        if (test(lines[i])) {
          totalMatches++
          if (matches.length < 3) {
            const contextLines: string[] = []
            if (i > 0) contextLines.push(`L${i}: ${lines[i - 1].trim().slice(0, 120)}`)
            contextLines.push(`L${i + 1}: ${lines[i].trim().slice(0, 120)}`)
            if (i < lines.length - 1) contextLines.push(`L${i + 2}: ${lines[i + 1].trim().slice(0, 120)}`)
            matches.push({ line: i + 1, content: lines[i].trim().slice(0, 120), context: contextLines })
          }
        }
      }
      if (totalMatches > 0) {
        results.push({ path, matchType: 'content', matches, totalMatches })
      }
    }
  }

  // Sort content matches by totalMatches descending for relevance
  results.sort((a, b) => {
    if (a.matchType === 'path' && b.matchType !== 'path') return -1
    if (a.matchType !== 'path' && b.matchType === 'path') return 1
    return (b.totalMatches ?? 0) - (a.totalMatches ?? 0)
  })

  return { totalFiles: paths.length, matchCount: results.length, results, ...(warning && { warning }) }
}

/** Build a test function for search: regex or case-insensitive substring. */
function buildMatcher(query: string, isRegex?: boolean): { test: (s: string) => boolean; error?: string; warning?: string } {
  if (isRegex) {
    if (query.length > 200) {
      return { test: () => false, error: 'Regex query too long (max 200 characters)' }
    }
    try {
      const re = new RegExp(query, 'i')
      return { test: (s: string) => re.test(s) }
    } catch (e) {
      // Fall back to case-insensitive substring matching
      const q = query.toLowerCase()
      return {
        test: (s: string) => s.toLowerCase().includes(q),
        warning: `Invalid regex (${e instanceof Error ? e.message : 'unknown error'}), falling back to substring match`,
      }
    }
  }
  const q = query.toLowerCase()
  return { test: (s: string) => s.toLowerCase().includes(q) }
}

function executeListDirectory(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const prefix = input.path ? (input.path.endsWith('/') ? input.path : input.path + '/') : ''
  const entries = new Set<string>()
  const paths = allPaths(codeIndex)

  for (const filePath of paths) {
    if (!filePath.startsWith(prefix)) continue
    const rest = filePath.slice(prefix.length)
    const firstPart = rest.split('/')[0]
    if (firstPart) {
      const isDir = rest.includes('/')
      entries.add(isDir ? firstPart + '/' : firstPart)
    }
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

function executeFindSymbol(
  input: { name: string; kind?: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const results: Array<{ path: string; line: number; kind: string; match: string }> = []
  const patterns = [
    { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'function' },
    { regex: /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g, kind: 'function' },
    { regex: /(?:export\s+)?class\s+(\w+)/g, kind: 'class' },
    { regex: /(?:export\s+)?interface\s+(\w+)/g, kind: 'interface' },
    { regex: /(?:export\s+)?type\s+(\w+)\s*[=<{]/g, kind: 'type' },
    { regex: /(?:export\s+)?enum\s+(\w+)/g, kind: 'enum' },
  ]
  const nameL = input.name.toLowerCase()

  for (const [filePath, file] of codeIndex.files) {
    const lines = file.lines
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

  return { symbolName: input.name, matchCount: results.length, results: results.slice(0, 20) }
}

function executeGetFileStats(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  const lines = file.lines
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

function executeAnalyzeImports(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  const resolvedPath = file.path
  const importRegex = /import\s+.*from\s+['"](.*)['"]/g
  const imports: string[] = []
  let m
  while ((m = importRegex.exec(file.content)) !== null) imports.push(m[1])

  const baseName = resolvedPath.replace(/\.(ts|tsx|js|jsx)$/, '')
  const fileName = resolvedPath.split('/').pop()?.replace(/\.\w+$/, '')
  const importedBy: string[] = []

  for (const [filePath, otherFile] of codeIndex.files) {
    if (filePath === resolvedPath) continue
    if (otherFile.content.includes(baseName) || (fileName && otherFile.content.includes('./' + fileName))) {
      importedBy.push(filePath)
    }
  }

  return { path: resolvedPath, imports, importedBy: importedBy.slice(0, 30) }
}

function executeScanIssues(
  input: { path: string },
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const file = findFile(codeIndex, input.path)
  if (!file) return { error: `File not found: ${input.path}` }

  const issues: Array<{ line: number; severity: string; message: string }> = []
  const lines = file.lines

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('eval(')) issues.push({ line: i + 1, severity: 'critical', message: 'Use of eval() is a security risk' })
    if (line.includes('innerHTML')) issues.push({ line: i + 1, severity: 'warning', message: 'innerHTML can cause XSS vulnerabilities' })
    if (line.match(/console\.(log|debug|info)\(/)) issues.push({ line: i + 1, severity: 'info', message: 'Console statement (remove before production)' })
    if (line.includes('any') && line.match(/:\s*any\b/)) issues.push({ line: i + 1, severity: 'warning', message: 'TypeScript `any` type reduces type safety' })
    if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) issues.push({ line: i + 1, severity: 'info', message: `Code annotation: ${line.trim().slice(0, 80)}` })
    if (line.includes('password') && line.match(/['"]\w+['"]/)) issues.push({ line: i + 1, severity: 'critical', message: 'Possible hardcoded credential' })
  }

  return { path: file.path, issueCount: issues.length, issues: issues.slice(0, 50) }
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
      const importRegex = /import\s+.*from\s+['"](\.\.?\/[^'"]+)['"]/g
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

    const uniqueEdges = [...new Set(edges.map(e => `${e.from}|||${e.to}`))]
      .map(e => {
        const [from, to] = e.split('|||')
        return { from, to }
      })
      .slice(0, 30)

    let mermaid = 'graph LR\n'
    for (const edge of uniqueEdges) {
      const fromId = edge.from.replace(/[^a-zA-Z0-9]/g, '_')
      const toId = edge.to.replace(/[^a-zA-Z0-9]/g, '_')
      mermaid += `  ${fromId}["${edge.from}"] --> ${toId}["${edge.to}"]\n`
    }
    return { type: input.type, mermaid, nodeCount: nodes.size, edgeCount: uniqueEdges.length }
  }

  return {
    type: input.type,
    note: `Diagram type '${input.type}' requires complex analysis. Here's the file structure you can reference in a Mermaid diagram:`,
    structure: paths.slice(0, 100),
    totalFiles: paths.length,
  }
}

function executeGetProjectOverview(
  codeIndex: CodeIndex,
): Record<string, unknown> {
  const paths = allPaths(codeIndex)
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
    hasTests: paths.some(p => p.includes('.test.') || p.includes('.spec.') || p.includes('__tests__')),
    hasConfig: paths.some(p => p.includes('tsconfig') || p.includes('package.json')),
    entryPoints: paths.filter(p => p.match(/(index|main|app|page)\.(ts|tsx|js|jsx)$/)).slice(0, 10),
  }
}
