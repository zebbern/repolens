import { describe, expect, it } from 'vitest'
import type { CompleteRepoTree } from '@/types/repository'
import { createRepositoryCoverage, isCoverageComplete, updateRepositoryCoverage } from '../coverage'

const completeTree: CompleteRepoTree = {
  status: 'complete',
  sha: 'root',
  truncated: false,
  requestCount: 1,
  tree: [
    { path: 'src/a.ts', type: 'blob', mode: '100644', sha: 'a', size: 10 },
    { path: 'assets/logo.png', type: 'blob', mode: '100644', sha: 'b', size: 10 },
    { path: 'src/huge.ts', type: 'blob', mode: '100644', sha: 'c', size: 600_000 },
    { path: 'vendor/submodule', type: 'commit', mode: '160000', sha: 'd' },
  ],
}

describe('repository coverage', () => {
  it('counts only supported non-oversized blobs as discovered', () => {
    expect(createRepositoryCoverage(completeTree).supportedFiles).toEqual({ discovered: 1, loaded: 0 })
  })

  it('keeps full failure counts while sampling only the first 100', () => {
    const initial = createRepositoryCoverage(completeTree)
    const failures = Array.from({ length: 125 }, (_, index) => ({ path: `src/${index}.ts`, error: 'failed' }))
    const coverage = updateRepositoryCoverage(initial, 125, 0, failures)
    expect(coverage.failures).toMatchObject({ count: 125 })
    expect(coverage.failures.samples).toHaveLength(100)
    expect(isCoverageComplete(coverage)).toBe(false)
  })

  it('is reusable only when discovery and loading are complete and failure-free', () => {
    const initial = createRepositoryCoverage(completeTree)
    expect(isCoverageComplete(updateRepositoryCoverage(initial, 1, 1, []))).toBe(true)
  })
})
