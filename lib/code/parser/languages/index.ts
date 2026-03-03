// Import extraction dispatcher — routes to the appropriate language parser.

import type { ResolvedImport } from '../types'
import { extractJsImports } from './javascript'
import { extractPythonImports } from './python'
import { extractGoImports } from './go'
import { extractRustImports } from './rust'
import { extractPhpImports } from './php'

export function extractImports(content: string, filePath: string, lang: string, indexedPaths: Set<string>): ResolvedImport[] {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return extractJsImports(content, filePath, indexedPaths)
    case 'python':
      return extractPythonImports(content, filePath, indexedPaths)
    case 'go':
      return extractGoImports(content, filePath, indexedPaths)
    case 'rust':
      return extractRustImports(content, filePath, indexedPaths)
    case 'php':
      return extractPhpImports(content, filePath, indexedPaths)
    default:
      // Attempt JS-style extraction as fallback
      return extractJsImports(content, filePath, indexedPaths)
  }
}
