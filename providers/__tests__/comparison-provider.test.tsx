import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useComparison, ComparisonProvider } from '../comparison-provider'
import { MAX_COMPARISON_REPOS } from '@/types/comparison'
import type { GitHubRepo } from '@/types/repository'
import {
  PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT,
  PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY,
} from '@/lib/auth/credential-events'

// Mock external dependencies
vi.mock('@/lib/github/parser', () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }),
}))

vi.mock('@/lib/github/client', () => ({
  fetchRepoViaProxy: vi.fn().mockResolvedValue({
    owner: 'test',
    name: 'repo',
    fullName: 'test/repo',
    description: 'A test repo',
    defaultBranch: 'main',
    stars: 100,
    forks: 10,
    language: 'TypeScript',
    topics: [],
    isPrivate: false,
    url: 'https://github.com/test/repo',
    openIssuesCount: 5,
    pushedAt: '2025-01-01',
    license: 'MIT',
  }),
  fetchTreeViaProxy: vi.fn().mockResolvedValue([]),
  fetchFileViaProxy: vi.fn().mockRejectedValue(new Error('Not found')),
}))

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTree: vi.fn(() => []),
}))

vi.mock('@/lib/code/code-index', () => ({
  flattenFiles: vi.fn(() => []),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

function TestConsumer({ onContext }: { onContext: (ctx: ReturnType<typeof useComparison>) => void }) {
  const ctx = useComparison()
  onContext(ctx)
  return (
    <div>
      <span data-testid="capacity">{String(ctx.isAtCapacity)}</span>
      <span data-testid="count">{ctx.getRepoList().length}</span>
    </div>
  )
}

describe('ComparisonProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides initial state with empty repos and not at capacity', () => {
    let ctx: ReturnType<typeof useComparison> | null = null

    render(
      <ComparisonProvider>
        <TestConsumer onContext={(c) => { ctx = c }} />
      </ComparisonProvider>
    )

    expect(screen.getByTestId('count')).toHaveTextContent('0')
    expect(screen.getByTestId('capacity')).toHaveTextContent('false')
  })

  it('getRepoList returns an empty array initially', () => {
    let repoList: unknown[] = []

    render(
      <ComparisonProvider>
        <TestConsumer onContext={(c) => { repoList = c.getRepoList() }} />
      </ComparisonProvider>
    )

    expect(repoList).toEqual([])
  })

  it('removeRepo removes a repo from the list', async () => {
    let ctx: ReturnType<typeof useComparison> | null = null

    render(
      <ComparisonProvider>
        <TestConsumer onContext={(c) => { ctx = c }} />
      </ComparisonProvider>
    )

    // Add a repo
    await act(async () => {
      await ctx!.addRepo('https://github.com/test/repo')
    })

    expect(screen.getByTestId('count')).toHaveTextContent('1')

    // Remove it
    await act(async () => {
      ctx!.removeRepo('test/repo')
    })

    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('clearAll removes all repos', async () => {
    let ctx: ReturnType<typeof useComparison> | null = null

    render(
      <ComparisonProvider>
        <TestConsumer onContext={(c) => { ctx = c }} />
      </ComparisonProvider>
    )

    await act(async () => {
      await ctx!.addRepo('https://github.com/test/repo')
    })

    expect(screen.getByTestId('count')).toHaveTextContent('1')

    await act(async () => {
      ctx!.clearAll()
    })

    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('rejects invalid GitHub URLs', async () => {
    const { toast } = await import('sonner')
    let ctx: ReturnType<typeof useComparison> | null = null

    render(
      <ComparisonProvider>
        <TestConsumer onContext={(c) => { ctx = c }} />
      </ComparisonProvider>
    )

    let result: boolean = true
    await act(async () => {
      result = await ctx!.addRepo('not-a-url')
    })

    expect(result).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Invalid GitHub URL'))
  })

  it('retries an error entry in place', async () => {
    const { fetchRepoViaProxy, fetchTreeViaProxy } = await import('@/lib/github/client')
    vi.mocked(fetchRepoViaProxy).mockRejectedValueOnce(new Error('temporary'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue({ sha: 'tree-sha', tree: [], status: 'complete', truncated: false, requestCount: 1 })
    let ctx: ReturnType<typeof useComparison> | null = null
    render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)

    await act(async () => { await ctx!.addRepo('https://github.com/test/repo') })
    expect(ctx!.repos.get('test/repo')?.status).toBe('error')

    vi.mocked(fetchRepoViaProxy).mockResolvedValueOnce({
      owner: 'test', name: 'repo', fullName: 'test/repo', description: 'A test repo',
      defaultBranch: 'main', stars: 100, forks: 10, language: 'TypeScript', topics: [],
      isPrivate: false, url: 'https://github.com/test/repo', openIssuesCount: 5,
      pushedAt: '2025-01-01', license: 'MIT',
    })
    let retryResult = false
    await act(async () => { retryResult = await ctx!.retryRepo('test/repo') })

    expect(retryResult).toBe(true)
    expect(ctx!.repos.get('test/repo')?.status).toBe('ready')
    expect(ctx!.repos.size).toBe(1)
  })

  it('does not resurrect a removed in-flight repository after a late response', async () => {
    let resolve!: (value: GitHubRepo) => void
    const deferred = new Promise<GitHubRepo>(done => { resolve = done })
    const { fetchRepoViaProxy } = await import('@/lib/github/client')
    vi.mocked(fetchRepoViaProxy).mockReturnValueOnce(deferred)
    let ctx: ReturnType<typeof useComparison> | null = null
    render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)

    let pending!: Promise<boolean>
    await act(async () => { pending = ctx!.addRepo('https://github.com/test/repo'); await Promise.resolve() })
    act(() => { ctx!.removeRepo('test/repo') })
    expect(ctx!.repos.has('test/repo')).toBe(false)

    resolve({
      owner: 'test', name: 'repo', fullName: 'test/repo', description: 'A test repo',
      defaultBranch: 'main', stars: 100, forks: 10, language: 'TypeScript', topics: [],
      isPrivate: false, url: 'https://github.com/test/repo', openIssuesCount: 5,
      pushedAt: '2025-01-01', license: 'MIT',
    })
    await act(async () => { expect(await pending).toBe(false) })
    expect(ctx!.getRepoList()).toEqual([])
  })

  it('aborts and purges in-flight repositories on same-window credential revocation', async () => {
    let resolve!: (value: GitHubRepo) => void
    const deferred = new Promise<GitHubRepo>(done => { resolve = done })
    const { fetchRepoViaProxy } = await import('@/lib/github/client')
    vi.mocked(fetchRepoViaProxy).mockReturnValueOnce(deferred)
    let ctx: ReturnType<typeof useComparison> | null = null
    render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)

    let pending!: Promise<boolean>
    await act(async () => { pending = ctx!.addRepo('https://github.com/private/repo'); await Promise.resolve() })
    act(() => { window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT)) })
    expect(ctx!.getRepoList()).toEqual([])
    expect(vi.mocked(fetchRepoViaProxy).mock.calls.at(-1)?.[2]?.signal?.aborted).toBe(true)

    resolve({
      owner: 'private', name: 'repo', fullName: 'private/repo', description: null,
      defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
      isPrivate: true, url: 'https://github.com/private/repo', openIssuesCount: 0,
      pushedAt: '', license: null,
    })
    await act(async () => { expect(await pending).toBe(false) })
    expect(ctx!.getRepoList()).toEqual([])
  })

  it('handles cross-tab credential revocation while preserving a known-public ready repository', async () => {
    const { fetchRepoViaProxy } = await import('@/lib/github/client')
    const publicRepo = {
      owner: 'public', name: 'repo', fullName: 'public/repo', description: null,
      defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
      isPrivate: false, url: 'https://github.com/public/repo', openIssuesCount: 0,
      pushedAt: '', license: null,
    }
    vi.mocked(fetchRepoViaProxy).mockResolvedValueOnce(publicRepo)
    let ctx: ReturnType<typeof useComparison> | null = null
    render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)
    await act(async () => { await ctx!.addRepo('https://github.com/public/repo') })
    expect(ctx!.repos.get('public/repo')?.status).toBe('ready')

    let resolve!: (value: GitHubRepo) => void
    const deferred = new Promise<GitHubRepo>(done => { resolve = done })
    vi.mocked(fetchRepoViaProxy).mockReturnValueOnce(deferred)
    let pending!: Promise<boolean>
    await act(async () => { pending = ctx!.addRepo('https://github.com/private/repo'); await Promise.resolve() })

    const storageEvent = new StorageEvent('storage', {
      key: PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY,
      newValue: 'revoked',
    })
    act(() => { window.dispatchEvent(storageEvent) })
    expect(ctx!.getRepoList().map(repo => repo.id)).toEqual(['public/repo'])

    resolve({
      owner: 'private', name: 'repo', fullName: 'private/repo', description: null,
      defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
      isPrivate: true, url: 'https://github.com/private/repo', openIssuesCount: 0,
      pushedAt: '', license: null,
    })
    await act(async () => { expect(await pending).toBe(false) })
    expect(ctx!.getRepoList().map(repo => repo.id)).toEqual(['public/repo'])
  })

  it('aborts all comparison operations when unmounted', async () => {
    let resolve!: (value: GitHubRepo) => void
    const deferred = new Promise<GitHubRepo>(done => { resolve = done })
    const { fetchRepoViaProxy } = await import('@/lib/github/client')
    vi.mocked(fetchRepoViaProxy).mockReturnValueOnce(deferred)
    let ctx: ReturnType<typeof useComparison> | null = null
    const view = render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)

    let pending!: Promise<boolean>
    await act(async () => { pending = ctx!.addRepo('https://github.com/test/repo'); await Promise.resolve() })
    view.unmount()
    expect(vi.mocked(fetchRepoViaProxy).mock.calls.at(-1)?.[2]?.signal?.aborted).toBe(true)

    resolve({
      owner: 'test', name: 'repo', fullName: 'test/repo', description: null,
      defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
      isPrivate: false, url: 'https://github.com/test/repo', openIssuesCount: 0,
      pushedAt: '', license: null,
    })
    await act(async () => { expect(await pending).toBe(false) })
  })

  it('reserves comparison capacity across overlapping additions', async () => {
    const resolvers: Array<() => void> = []
    const { fetchRepoViaProxy, fetchTreeViaProxy } = await import('@/lib/github/client')
    vi.mocked(fetchRepoViaProxy).mockImplementation((owner, name) => new Promise(resolve => {
      resolvers.push(() => resolve({
        owner, name, fullName: `${owner}/${name}`, description: null,
        defaultBranch: 'main', stars: 0, forks: 0, language: null, topics: [],
        isPrivate: false, url: `https://github.com/${owner}/${name}`, openIssuesCount: 0,
        pushedAt: '', license: null,
      }))
    }))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue({ sha: 'tree-sha', tree: [], status: 'complete', truncated: false, requestCount: 1 })
    let ctx: ReturnType<typeof useComparison> | null = null
    render(<ComparisonProvider><TestConsumer onContext={(c) => { ctx = c }} /></ComparisonProvider>)

    const urls = Array.from({ length: MAX_COMPARISON_REPOS + 1 }, (_, index) => `https://github.com/test/repo-${index}`)
    const pending: Array<Promise<boolean>> = []
    act(() => {
      for (const url of urls) pending.push(ctx!.addRepo(url))
    })

    expect(fetchRepoViaProxy).toHaveBeenCalledTimes(MAX_COMPARISON_REPOS)
    expect(ctx!.getRepoList()).toHaveLength(MAX_COMPARISON_REPOS)
    expect(ctx!.isAtCapacity).toBe(true)
    await expect(pending[MAX_COMPARISON_REPOS]).resolves.toBe(false)

    for (const resolve of resolvers) resolve()
    await act(async () => { await Promise.all(pending.slice(0, MAX_COMPARISON_REPOS)) })
    expect(ctx!.getRepoList()).toHaveLength(MAX_COMPARISON_REPOS)
  })
})

describe('useComparison', () => {
  it('throws when used outside ComparisonProvider', () => {
    function BadConsumer() {
      useComparison()
      return null
    }

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BadConsumer />)).toThrow(
      'useComparison must be used within a ComparisonProvider'
    )
    spy.mockRestore()
  })
})
