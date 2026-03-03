// PHP import extraction — use declarations and require/include statements.

import type { ResolvedImport } from '../types'
import { resolveRelativeImport } from '../utils'

const PHP_USE_REGEX = /^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm
const PHP_REQUIRE_REGEX = /(?:require|include)(?:_once)?\s*(?:\(\s*)?['"]([^'"]+)['"]/gm

export function extractPhpImports(content: string, filePath: string, indexedPaths: Set<string>): ResolvedImport[] {
  const imports: ResolvedImport[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  PHP_USE_REGEX.lastIndex = 0
  while ((m = PHP_USE_REGEX.exec(content)) !== null) {
    const source = m[1]
    if (seen.has(source)) continue
    seen.add(source)
    imports.push({ source, resolvedPath: null, specifiers: [source.split('\\').pop() || source], isExternal: true, isDefault: false })
  }

  PHP_REQUIRE_REGEX.lastIndex = 0
  while ((m = PHP_REQUIRE_REGEX.exec(content)) !== null) {
    const source = m[1]
    if (seen.has(source)) continue
    seen.add(source)
    const resolvedPath = resolveRelativeImport(source, filePath, indexedPaths)
    imports.push({ source, resolvedPath, specifiers: [], isExternal: !resolvedPath, isDefault: false })
  }

  return imports
}
