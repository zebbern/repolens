export type SearchPathIncludeRule =
  | { kind: 'suffix'; value: string }
  | { kind: 'prefix'; value: string }
  | { kind: 'contains'; value: string }

/** Compact, structured-clone-safe path rules evaluated inside the search worker. */
export interface SearchPathFilter {
  includes?: readonly SearchPathIncludeRule[]
  excludeGenerated?: boolean
}

const GENERATED_FILE_PATTERNS = [
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /dist\//,
  /\.next\//,
  /node_modules\//,
  /\.map$/,
]

/** Compile the code browser's comma-separated include syntax into worker rules. */
export function buildSearchPathFilter(expression: string): SearchPathFilter | undefined {
  const includes: SearchPathIncludeRule[] = []

  for (const rawFilter of expression.split(',')) {
    const filter = rawFilter.trim().toLowerCase()
    if (!filter) continue
    if (filter.startsWith('*.')) {
      includes.push({ kind: 'suffix', value: filter.slice(1) })
    } else if (filter.endsWith('/*')) {
      includes.push({ kind: 'prefix', value: filter.slice(0, -1) })
    } else {
      includes.push({ kind: 'contains', value: filter })
    }
  }

  return includes.length > 0 ? { includes } : undefined
}

export function matchesSearchPathFilter(path: string, filter?: SearchPathFilter): boolean {
  if (!filter) return true
  if (filter.excludeGenerated && GENERATED_FILE_PATTERNS.some(pattern => pattern.test(path))) {
    return false
  }
  if (!filter.includes || filter.includes.length === 0) return true

  const normalizedPath = path.toLowerCase()
  return filter.includes.some(rule => {
    switch (rule.kind) {
      case 'suffix':
        return normalizedPath.endsWith(rule.value)
      case 'prefix':
        return normalizedPath.startsWith(rule.value)
      case 'contains':
        return normalizedPath.includes(rule.value)
      default: {
        const exhaustiveRule: never = rule
        return exhaustiveRule
      }
    }
  })
}
