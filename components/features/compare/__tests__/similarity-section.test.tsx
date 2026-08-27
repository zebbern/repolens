import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComparisonRepo, SimilarityResult } from '@/types/comparison'

// ── Mocks ───────────────────────────────────────────────────────────

let mockRepoList: ComparisonRepo[] = []

vi.mock('@/providers/comparison-provider', () => ({
  useComparison: () => ({
    getRepoList: () => mockRepoList,
  }),
}))

const mockComputeAllSimilarities = vi.fn<(repos: ComparisonRepo[]) => SimilarityResult[]>()

vi.mock('@/lib/compare/similarity-utils', () => ({
  computeAllSimilarities: (...args: Parameters<typeof mockComputeAllSimilarities>) =>
    mockComputeAllSimilarities(...args),
}))

import { SimilaritySection } from '../similarity-section'

// ── Factories ───────────────────────────────────────────────────────

function createRepo(overrides: Partial<ComparisonRepo> = {}): ComparisonRepo {
  return {
    id: 'owner/repo',
    repo: {
      owner: 'owner',
      name: 'repo',
      fullName: 'owner/repo',
      description: null,
      defaultBranch: 'main',
      stars: 0,
      forks: 0,
      language: null,
      topics: [],
      isPrivate: false,
      url: 'https://github.com/owner/repo',
      openIssuesCount: 0,
      pushedAt: '2025-01-01',
      license: null,
    },
    files: [],
    metrics: {
      totalFiles: 0,
      totalLines: 0,
      primaryLanguage: null,
      languageBreakdown: {},
      stars: 0,
      forks: 0,
      openIssues: 0,
      pushedAt: null,
      license: null,
    },
    status: 'ready',
    treeItems: [{ path: 'src/a.ts', mode: '100644', type: 'blob', sha: 'sha-a' }],
    ...overrides,
  }
}

function createSimilarityResult(
  overrides: Partial<SimilarityResult> = {}
): SimilarityResult {
  return {
    repoA: 'owner/repo-a',
    repoB: 'owner/repo-b',
    score: 0.75,
    label: 'highly-similar',
    signals: {
      shaJaccard: 0.6,
      shaContainment: 0.8,
      pathJaccard: 0.5,
      dependencyOverlap: 0.7,
      languageCosine: 0.9,
    },
    relationship: { isForkPair: false },
    identicalFiles: [],
    isLowConfidence: false,
    totalComparedFiles: 20,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SimilaritySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepoList = []
    mockComputeAllSimilarities.mockReturnValue([])
  })

  it('shows "need 2+ repos" message when fewer than 2 ready repos with treeItems', () => {
    mockRepoList = [createRepo({ id: 'a/a', status: 'ready' })]
    render(<SimilaritySection />)
    expect(
      screen.getByText(/need at least 2 repos/i)
    ).toBeInTheDocument()
  })

  it('shows "need 2+ repos" message when repos have no treeItems', () => {
    mockRepoList = [
      createRepo({ id: 'a/a', status: 'ready', treeItems: undefined }),
      createRepo({ id: 'b/b', status: 'ready', treeItems: undefined }),
    ]
    render(<SimilaritySection />)
    expect(
      screen.getByText(/need at least 2 repos/i)
    ).toBeInTheDocument()
  })

  it('shows "need 2+ repos" when repos are loading', () => {
    mockRepoList = [
      createRepo({ id: 'a/a', status: 'loading' }),
      createRepo({ id: 'b/b', status: 'loading' }),
    ]
    render(<SimilaritySection />)
    expect(
      screen.getByText(/need at least 2 repos/i)
    ).toBeInTheDocument()
  })

  it('renders similarity card with score percentage and label', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ score: 0.75, label: 'highly-similar' }),
    ])

    render(<SimilaritySection />)

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Highly Similar')).toBeInTheDocument()
    expect(screen.getByText('repo-a')).toBeInTheDocument()
    expect(screen.getByText('repo-b')).toBeInTheDocument()
  })

  it.each([
    { label: 'likely-clone' as const, text: 'Likely Clone' },
    { label: 'highly-similar' as const, text: 'Highly Similar' },
    { label: 'some-overlap' as const, text: 'Some Overlap' },
    { label: 'different' as const, text: 'Different' },
  ])('renders correct label text for "$label"', ({ label, text }) => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ label }),
    ])

    render(<SimilaritySection />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows fork banner when isForkPair is true', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({
        relationship: { isForkPair: true, commonParent: 'upstream/repo' },
      }),
    ])

    render(<SimilaritySection />)
    expect(screen.getByText(/fork relationship detected/i)).toBeInTheDocument()
    expect(screen.getByText(/upstream\/repo/)).toBeInTheDocument()
  })

  it('does not show fork banner when isForkPair is false', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ relationship: { isForkPair: false } }),
    ])

    render(<SimilaritySection />)
    expect(screen.queryByText(/fork relationship detected/i)).not.toBeInTheDocument()
  })

  it('shows low confidence warning when isLowConfidence is true', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ isLowConfidence: true, totalComparedFiles: 4 }),
    ])

    render(<SimilaritySection />)
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument()
    expect(screen.getByText(/4 total/i)).toBeInTheDocument()
  })

  it('does not show low confidence warning when isLowConfidence is false', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ isLowConfidence: false }),
    ])

    render(<SimilaritySection />)
    expect(screen.queryByText(/low confidence/i)).not.toBeInTheDocument()
  })

  it('renders signal breakdown collapsed by default', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult(),
    ])

    render(<SimilaritySection />)

    expect(screen.getByText('Signal Breakdown')).toBeInTheDocument()
    // Signal labels should not be visible when collapsed
    expect(screen.queryByText('SHA Match')).not.toBeInTheDocument()
  })

  it('expands signal breakdown on click', async () => {
    const user = userEvent.setup()
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult(),
    ])

    render(<SimilaritySection />)

    await user.click(screen.getByText('Signal Breakdown'))

    expect(screen.getByText('SHA Match')).toBeInTheDocument()
    expect(screen.getByText('Content Containment')).toBeInTheDocument()
    expect(screen.getByText('Path Similarity')).toBeInTheDocument()
    expect(screen.getByText('Dependency Overlap')).toBeInTheDocument()
    expect(screen.getByText('Language Similarity')).toBeInTheDocument()
  })

  it('renders identical files list with file paths', async () => {
    const user = userEvent.setup()
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({
        identicalFiles: ['src/utils.ts', 'src/types.ts'],
      }),
    ])

    render(<SimilaritySection />)

    // Identical files should show count badge
    expect(screen.getByText('2')).toBeInTheDocument()

    // Expand the identical files collapsible
    await user.click(screen.getByText('Identical Files'))

    expect(screen.getByText('src/utils.ts')).toBeInTheDocument()
    expect(screen.getByText('src/types.ts')).toBeInTheDocument()
  })

  it('expands identical files beyond the existing limit and collapses them again', async () => {
    const user = userEvent.setup()
    mockRepoList = [createRepo({ id: 'owner/repo-a' }), createRepo({ id: 'owner/repo-b' })]
    mockComputeAllSimilarities.mockReturnValue([createSimilarityResult({ identicalFiles: Array.from({ length: 22 }, (_, i) => `src/file-${i}.ts`) })])
    render(<SimilaritySection />)

    await user.click(screen.getByText('Identical Files'))
    expect(screen.getByText('+2 more')).toBeInTheDocument()
    const more = screen.getByRole('button', { name: 'View 2 more identical files' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(screen.getByText('src/file-21.ts')).toBeInTheDocument()
    const less = screen.getByRole('button', { name: 'Show fewer identical files' })
    expect(less).toHaveAttribute('aria-expanded', 'true')
    await user.click(less)
    expect(screen.queryByText('src/file-21.ts')).not.toBeInTheDocument()
  })

  it('does not render identical files section when list is empty', () => {
    mockRepoList = [
      createRepo({ id: 'owner/repo-a' }),
      createRepo({ id: 'owner/repo-b' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ identicalFiles: [] }),
    ])

    render(<SimilaritySection />)

    expect(screen.queryByText('Identical Files')).not.toBeInTheDocument()
  })

  it('renders multiple similarity cards for multiple repo pairs', () => {
    mockRepoList = [
      createRepo({ id: 'a/repo-a' }),
      createRepo({ id: 'b/repo-b' }),
      createRepo({ id: 'c/repo-c' }),
    ]
    mockComputeAllSimilarities.mockReturnValue([
      createSimilarityResult({ repoA: 'a/repo-a', repoB: 'b/repo-b', score: 0.9, label: 'likely-clone' }),
      createSimilarityResult({ repoA: 'a/repo-a', repoB: 'c/repo-c', score: 0.3, label: 'some-overlap' }),
      createSimilarityResult({ repoA: 'b/repo-b', repoB: 'c/repo-c', score: 0.1, label: 'different' }),
    ])

    render(<SimilaritySection />)

    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('Likely Clone')).toBeInTheDocument()
    expect(screen.getByText('Some Overlap')).toBeInTheDocument()
    expect(screen.getByText('Different')).toBeInTheDocument()
  })
})
