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
  getGitHistorySchema,
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

  it('enforces the 4096-character path boundary', () => {
    expect(readFileSchema.safeParse({ path: 'p'.repeat(4_096) }).success).toBe(true)
    expect(readFileSchema.safeParse({ path: 'p'.repeat(4_097) }).success).toBe(false)
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

// ---------------------------------------------------------------------------
// getGitHistorySchema
// ---------------------------------------------------------------------------

describe('getGitHistorySchema', () => {
  // ── mode: commits ──

  it('accepts valid commits mode with no optional fields', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'commits' })
    expect(result.success).toBe(true)
  })

  it('accepts commits mode with sha, path, and maxResults', () => {
    const result = getGitHistorySchema.safeParse({
      mode: 'commits',
      sha: 'main',
      path: 'src/index.ts',
      maxResults: 50,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe('commits')
    }
  })

  it('applies default maxResults of 20 for commits mode', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'commits' })
    expect(result.success).toBe(true)
    if (result.success && result.data.mode === 'commits') {
      expect(result.data.maxResults).toBe(20)
    }
  })

  it('rejects commits mode with maxResults exceeding 100', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'commits', maxResults: 101 })
    expect(result.success).toBe(false)
  })

  // ── mode: blame ──

  it('accepts valid blame mode with path only', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'blame', path: 'src/utils.ts' })
    expect(result.success).toBe(true)
  })

  it('accepts blame mode with path and ref', () => {
    const result = getGitHistorySchema.safeParse({
      mode: 'blame',
      path: 'src/utils.ts',
      ref: 'feature-branch',
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.mode === 'blame') {
      expect(result.data.ref).toBe('feature-branch')
    }
  })

  it('rejects blame mode without required path', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'blame' })
    expect(result.success).toBe(false)
  })

  // ── mode: commit-detail ──

  it('accepts valid commit-detail mode with sha', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'abc1234' })
    expect(result.success).toBe(true)
  })

  it('requires a strict 7-64 character hexadecimal commit-detail SHA', () => {
    expect(getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'abc1234' }).success).toBe(true)
    expect(getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'A'.repeat(64) }).success).toBe(true)
    expect(getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'abc123' }).success).toBe(false)
    expect(getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'g'.repeat(7) }).success).toBe(false)
    expect(getGitHistorySchema.safeParse({ mode: 'commit-detail', sha: 'a'.repeat(65) }).success).toBe(false)
  })

  it('rejects commit-detail mode without required sha', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'commit-detail' })
    expect(result.success).toBe(false)
  })

  // ── invalid inputs ──

  it('rejects input with missing mode field', () => {
    const result = getGitHistorySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects an invalid mode value', () => {
    const result = getGitHistorySchema.safeParse({ mode: 'invalid' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// codeTools — tool definition verification
// ---------------------------------------------------------------------------

describe('codeTools', () => {
  it('includes getGitHistory with the correct schema', async () => {
    const { codeTools } = await import('../tool-definitions')
    expect(codeTools).toHaveProperty('getGitHistory')
    const toolDef = codeTools.getGitHistory
    expect(toolDef).toBeDefined()
  })
})
