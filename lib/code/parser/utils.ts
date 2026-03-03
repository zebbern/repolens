// Parser utilities — language detection and path resolution helpers.

import type { FileAnalysis } from './types'

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.dart': 'dart',
  '.vue': 'typescript', '.svelte': 'typescript',
}

export function detectLang(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'))
  return EXT_TO_LANG[ext] || 'unknown'
}

export function detectPrimaryLanguage(files: Map<string, FileAnalysis>): string {
  const counts = new Map<string, number>()
  for (const f of files.values()) {
    counts.set(f.language, (counts.get(f.language) || 0) + 1)
  }
  let best = 'unknown'
  let max = 0
  for (const [lang, n] of counts) {
    if (lang !== 'unknown' && n > max) { best = lang; max = n }
  }
  return best
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.rs', '.php']

export function normalizePath(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

export function resolveRelativeImport(source: string, importerPath: string, indexedPaths: Set<string>): string | null {
  const dir = importerPath.includes('/') ? importerPath.slice(0, importerPath.lastIndexOf('/')) : ''
  const raw = normalizePath(dir ? `${dir}/${source}` : source)
  if (indexedPaths.has(raw)) return raw
  for (const ext of CODE_EXTENSIONS) {
    if (indexedPaths.has(raw + ext)) return raw + ext
  }
  for (const ext of CODE_EXTENSIONS) {
    if (indexedPaths.has(`${raw}/index${ext}`)) return `${raw}/index${ext}`
  }
  // Python: foo.bar -> foo/bar.py or foo/bar/__init__.py
  const asPy = raw.replace(/\./g, '/')
  if (asPy !== raw) {
    if (indexedPaths.has(asPy + '.py')) return asPy + '.py'
    if (indexedPaths.has(asPy + '/__init__.py')) return asPy + '/__init__.py'
  }
  return null
}

export function resolveAliasImport(source: string, indexedPaths: Set<string>): string | null {
  const match = source.match(/^[@~#]\/(.+)$/)
  if (!match) return null
  const rest = match[1]
  const bases = ['', 'src/', 'app/']
  for (const base of bases) {
    const raw = normalizePath(`${base}${rest}`)
    if (indexedPaths.has(raw)) return raw
    for (const ext of CODE_EXTENSIONS) {
      if (indexedPaths.has(raw + ext)) return raw + ext
    }
    for (const ext of CODE_EXTENSIONS) {
      if (indexedPaths.has(`${raw}/index${ext}`)) return `${raw}/index${ext}`
    }
  }
  return null
}
