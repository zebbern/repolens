import { describe, it, expect } from 'vitest'
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
  getProjectOverviewSchema,
} from '../tool-schemas'

// ---------------------------------------------------------------------------
// readFileSchema
// ---------------------------------------------------------------------------

describe('readFileSchema', () => {
  it('accepts valid input with path only', () => {
    const result = readFileSchema.safeParse({ path: 'src/utils.ts' })
    expect(result.success).toBe(true)
  })

  it('accepts valid input with path, startLine, and endLine', () => {
    const result = readFileSchema.safeParse({ path: 'src/utils.ts', startLine: 1, endLine: 10 })
    expect(result.success).toBe(true)
  })

  it('rejects input with missing path', () => {
    const result = readFileSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects input with path as number', () => {
    const result = readFileSchema.safeParse({ path: 123 })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// readFilesSchema
// ---------------------------------------------------------------------------

describe('readFilesSchema', () => {
  it('accepts valid paths array', () => {
    const result = readFilesSchema.safeParse({ paths: ['a.ts', 'b.ts'] })
    expect(result.success).toBe(true)
  })

  it('rejects missing paths', () => {
    const result = readFilesSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects non-array paths', () => {
    const result = readFilesSchema.safeParse({ paths: 'a.ts' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// searchFilesSchema
// ---------------------------------------------------------------------------

describe('searchFilesSchema', () => {
  it('accepts valid input with query', () => {
    const result = searchFilesSchema.safeParse({ query: 'hello' })
    expect(result.success).toBe(true)
  })

  it('accepts optional maxResults and isRegex', () => {
    const result = searchFilesSchema.safeParse({ query: 'test', maxResults: 5, isRegex: true })
    expect(result.success).toBe(true)
  })

  it('rejects empty object', () => {
    const result = searchFilesSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listDirectorySchema
// ---------------------------------------------------------------------------

describe('listDirectorySchema', () => {
  it('accepts valid input with path', () => {
    const result = listDirectorySchema.safeParse({ path: 'src' })
    expect(result.success).toBe(true)
  })

  it('accepts empty string path for root', () => {
    const result = listDirectorySchema.safeParse({ path: '' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = listDirectorySchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findSymbolSchema
// ---------------------------------------------------------------------------

describe('findSymbolSchema', () => {
  it('accepts valid input with name only', () => {
    const result = findSymbolSchema.safeParse({ name: 'greet' })
    expect(result.success).toBe(true)
  })

  it('accepts valid enum kind', () => {
    const result = findSymbolSchema.safeParse({ name: 'Foo', kind: 'class' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid kind', () => {
    const result = findSymbolSchema.safeParse({ name: 'Foo', kind: 'module' })
    expect(result.success).toBe(false)
  })

  it('rejects missing name', () => {
    const result = findSymbolSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getFileStatsSchema
// ---------------------------------------------------------------------------

describe('getFileStatsSchema', () => {
  it('accepts valid input', () => {
    const result = getFileStatsSchema.safeParse({ path: 'src/foo.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = getFileStatsSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// analyzeImportsSchema
// ---------------------------------------------------------------------------

describe('analyzeImportsSchema', () => {
  it('accepts valid input', () => {
    const result = analyzeImportsSchema.safeParse({ path: 'src/foo.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = analyzeImportsSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// scanIssuesSchema
// ---------------------------------------------------------------------------

describe('scanIssuesSchema', () => {
  it('accepts valid input', () => {
    const result = scanIssuesSchema.safeParse({ path: 'src/foo.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = scanIssuesSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateDiagramSchema
// ---------------------------------------------------------------------------

describe('generateDiagramSchema', () => {
  it('accepts valid type', () => {
    const result = generateDiagramSchema.safeParse({ type: 'summary' })
    expect(result.success).toBe(true)
  })

  it('accepts type with optional focusFile', () => {
    const result = generateDiagramSchema.safeParse({ type: 'topology', focusFile: 'src/index.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid type', () => {
    const result = generateDiagramSchema.safeParse({ type: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects missing type', () => {
    const result = generateDiagramSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getProjectOverviewSchema
// ---------------------------------------------------------------------------

describe('getProjectOverviewSchema', () => {
  it('accepts empty object', () => {
    const result = getProjectOverviewSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
