import { describe, it, expect } from 'vitest'
import { MAX_COMPARISON_REPOS } from './comparison'
import type { ComparisonRepo, RepoMetrics, ComparisonRepoStatus } from './comparison'

describe('comparison types', () => {
  it('exports MAX_COMPARISON_REPOS as a positive integer', () => {
    expect(MAX_COMPARISON_REPOS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_COMPARISON_REPOS)).toBe(true)
  })

  it('MAX_COMPARISON_REPOS is a reasonable limit (2-10)', () => {
    expect(MAX_COMPARISON_REPOS).toBeGreaterThanOrEqual(2)
    expect(MAX_COMPARISON_REPOS).toBeLessThanOrEqual(10)
  })

  it('ComparisonRepo shape matches expected contract', () => {
    const metrics: RepoMetrics = {
      totalFiles: 100,
      totalLines: 5000,
      primaryLanguage: 'TypeScript',
      languageBreakdown: { TypeScript: 80, CSS: 20 },
      stars: 50,
      forks: 10,
      openIssues: 3,
      pushedAt: '2026-08-01T00:00:00Z',
      license: 'MIT',
    }

    const comparisonRepo: ComparisonRepo = {
      id: 'owner/repo',
      repo: {
        owner: 'owner',
        name: 'repo',
        fullName: 'owner/repo',
        description: null,
        defaultBranch: 'main',
        stars: 50,
        forks: 10,
        openIssuesCount: 3,
        pushedAt: '2026-08-01T00:00:00Z',
        license: 'MIT',
        language: 'TypeScript',
        topics: [],
        isPrivate: false,
        url: 'https://github.com/owner/repo',
      },
      files: [],
      metrics,
      status: 'ready',
    }

    expect(comparisonRepo.id).toBe('owner/repo')
    expect(comparisonRepo.status).toBe('ready')
    expect(comparisonRepo.metrics.primaryLanguage).toBe('TypeScript')
  })

  it('ComparisonRepoStatus includes all expected states', () => {
    const validStatuses: ComparisonRepoStatus[] = ['loading', 'indexing', 'ready', 'error']
    // This tests that the type accepts all expected values
    expect(validStatuses).toHaveLength(4)
  })
})
