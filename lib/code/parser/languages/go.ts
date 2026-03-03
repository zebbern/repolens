// Go import extraction — single and block import statements.

import type { ResolvedImport } from '../types'
import { resolveRelativeImport } from '../utils'

const GO_SINGLE_IMPORT = /^import\s+"([^"]+)"/gm
const GO_BLOCK_IMPORT = /import\s*\(\s*([\s\S]*?)\)/g

export function extractGoImports(content: string, filePath: string, indexedPaths: Set<string>): ResolvedImport[] {
  const imports: ResolvedImport[] = []
  const seen = new Set<string>()

  let m: RegExpExecArray | null
  GO_SINGLE_IMPORT.lastIndex = 0
  while ((m = GO_SINGLE_IMPORT.exec(content)) !== null) {
    const source = m[1]
    if (seen.has(source)) continue
    seen.add(source)
    const resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
    imports.push({ source, resolvedPath, specifiers: [source.split('/').pop() || source], isExternal: !resolvedPath, isDefault: false })
  }

  GO_BLOCK_IMPORT.lastIndex = 0
  while ((m = GO_BLOCK_IMPORT.exec(content)) !== null) {
    const block = m[1]
    const lines = block.split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*(?:\w+\s+)?"([^"]+)"/)
      if (!match) continue
      const source = match[1]
      if (seen.has(source)) continue
      seen.add(source)
      const resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
      imports.push({ source, resolvedPath, specifiers: [source.split('/').pop() || source], isExternal: !resolvedPath, isDefault: false })
    }
  }

  return imports
}
