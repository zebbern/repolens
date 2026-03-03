// Scanner constants — language extension mappings and detection helpers

import type { CodeIndex } from '../code-index'

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export const LANG_EXTENSIONS: Record<string, string[]> = {
  'JavaScript/TypeScript': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  'Python': ['.py', '.pyw'],
  'Go': ['.go'],
  'Rust': ['.rs'],
  'Java': ['.java'],
  'Kotlin': ['.kt', '.kts'],
  'C/C++': ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
  'C#': ['.cs'],
  'Ruby': ['.rb', '.rake'],
  'PHP': ['.php'],
  'Shell': ['.sh', '.bash', '.zsh'],
  'Swift': ['.swift'],
  'Dart': ['.dart'],
}

export function detectLanguages(codeIndex: CodeIndex): string[] {
  const found = new Set<string>()
  for (const path of codeIndex.files.keys()) {
    const ext = '.' + (path.split('.').pop() || '')
    for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
      if (exts.includes(ext.toLowerCase())) found.add(lang)
    }
  }
  return Array.from(found)
}

// ---------------------------------------------------------------------------
// File extension groups (used by scan rules)
// ---------------------------------------------------------------------------

export const JS_TS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
export const TS_ONLY = ['.ts', '.tsx']
export const PY = ['.py', '.pyw']
export const GO = ['.go']
export const RUST = ['.rs']
export const JAVA = ['.java']
export const KOTLIN = ['.kt', '.kts']
export const C_CPP = ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp']
export const CSHARP = ['.cs']
export const RUBY = ['.rb', '.rake']
export const PHP = ['.php']
export const SHELL = ['.sh', '.bash', '.zsh']
export const SWIFT = ['.swift']
export const ALL_CODE = [...JS_TS, ...PY, ...GO, ...RUST, ...JAVA, ...KOTLIN, ...C_CPP, ...CSHARP, ...RUBY, ...PHP, ...SHELL, ...SWIFT]

export const SKIP_VENDORED = /node_modules|vendor|dist|build|\.min\.|\.lock$|package-lock|yarn\.lock|pnpm-lock|__pycache__|\.pyc|target\/debug|target\/release/i
