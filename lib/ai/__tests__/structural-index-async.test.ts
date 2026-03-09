import { describe, it, expect } from 'vitest'
import {
  createEmptyIndex,
  indexFile,
  type CodeIndex,
  type IndexedFile,
} from '@/lib/code/code-index'
import { InMemoryContentStore } from '@/lib/code/content-store'
import {
  extractExportsAsync,
  extractImportsAsync,
  extractSignaturesAsync,
  extractExports,
  extractImports,
  extractSignatures,
} from '../structural-index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS_CONTENT = [
  "import { z } from 'zod'",
  "import { User } from './types'",
  '',
  'export function greet(name: string): string {',
  '  return `Hello, ${name}`',
  '}',
  '',
  'export const add = (a: number, b: number): number => a + b',
].join('\n')

const PY_CONTENT = [
  'import os',
  'from typing import List',
  '',
  'def greet(name: str) -> str:',
  '    return f"Hello, {name}"',
  '',
  'class Calculator:',
  '    def add(self, a, b):',
  '        return a + b',
].join('\n')

/** Build an index with inline content (InMemory path). */
function buildPopulatedIndex(
  entries: Array<{ path: string; content: string; language?: string }>,
): CodeIndex {
  let index = createEmptyIndex()
  for (const e of entries) {
    index = indexFile(index, e.path, e.content, e.language)
  }
  return index
}

/** Build an index with content only in contentStore (stripped). */
function buildStrippedIndex(
  entries: Array<{ path: string; content: string; language?: string }>,
): CodeIndex {
  const contentStore = new InMemoryContentStore()
  const files = new Map<string, IndexedFile>()
  const meta = new Map<string, { path: string; name: string; language?: string; lineCount: number }>()

  for (const e of entries) {
    const name = e.path.split('/').pop() || e.path
    const lineCount = e.content.split('\n').length
    files.set(e.path, { path: e.path, name, content: undefined, language: e.language, lineCount })
    meta.set(e.path, { path: e.path, name, language: e.language, lineCount })
    contentStore.put(e.path, e.content)
  }

  return {
    files,
    totalFiles: files.size,
    totalLines: 0,
    isIndexing: false,
    meta,
    contentStore,
  }
}

// ===========================================================================
// Async variants produce same results as sync for InMemory
// ===========================================================================

describe('extractExportsAsync vs extractExports (InMemory)', () => {
  it('produces same results for TypeScript files', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const file = index.files.get('src/utils.ts')!
    const syncResult = extractExports(file)
    const asyncResult = await extractExportsAsync('src/utils.ts', index)

    expect(asyncResult.sort()).toEqual(syncResult.sort())
  })

  it('produces same results for Python files', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/app.py', content: PY_CONTENT, language: 'python' },
    ])

    const file = index.files.get('src/app.py')!
    const syncResult = extractExports(file)
    const asyncResult = await extractExportsAsync('src/app.py', index)

    expect(asyncResult.sort()).toEqual(syncResult.sort())
  })
})

describe('extractImportsAsync vs extractImports (InMemory)', () => {
  it('produces same results for TypeScript files', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const file = index.files.get('src/utils.ts')!
    const syncResult = extractImports(file)
    const asyncResult = await extractImportsAsync('src/utils.ts', index)

    expect(asyncResult.sort()).toEqual(syncResult.sort())
  })
})

describe('extractSignaturesAsync vs extractSignatures (InMemory)', () => {
  it('produces same results for TypeScript files', async () => {
    const index = buildPopulatedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const file = index.files.get('src/utils.ts')!
    const syncResult = extractSignatures(file)
    const asyncResult = await extractSignaturesAsync('src/utils.ts', index)

    expect(asyncResult.sort()).toEqual(syncResult.sort())
  })
})

// ===========================================================================
// Async variants work when content is only in contentStore
// ===========================================================================

describe('extractExportsAsync with contentStore-only content', () => {
  it('extracts exports from content in contentStore', async () => {
    const index = buildStrippedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const result = await extractExportsAsync('src/utils.ts', index)
    expect(result).toContain('greet')
    expect(result).toContain('add')
  })

  it('returns empty array for non-existent path', async () => {
    const index = buildStrippedIndex([])
    const result = await extractExportsAsync('nope.ts', index)
    expect(result).toEqual([])
  })
})

describe('extractImportsAsync with contentStore-only content', () => {
  it('extracts imports from content in contentStore', async () => {
    const index = buildStrippedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const result = await extractImportsAsync('src/utils.ts', index)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('zod')
  })

  it('returns empty array for non-existent path', async () => {
    const index = buildStrippedIndex([])
    const result = await extractImportsAsync('missing.ts', index)
    expect(result).toEqual([])
  })
})

describe('extractSignaturesAsync with contentStore-only content', () => {
  it('extracts signatures from content in contentStore', async () => {
    const index = buildStrippedIndex([
      { path: 'src/utils.ts', content: TS_CONTENT, language: 'typescript' },
    ])

    const result = await extractSignaturesAsync('src/utils.ts', index)
    expect(result.length).toBeGreaterThan(0)
    // Should contain function and const signatures
    const hasGreet = result.some(s => s.includes('greet'))
    expect(hasGreet).toBe(true)
  })

  it('returns empty array for non-existent path', async () => {
    const index = buildStrippedIndex([])
    const result = await extractSignaturesAsync('gone.ts', index)
    expect(result).toEqual([])
  })
})
