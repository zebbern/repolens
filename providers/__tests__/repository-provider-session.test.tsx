import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubRepo, RepoTree } from '@/types/repository'

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTree: vi.fn((tree: RepoTree) => tree.tree.map(entry => ({
    name: entry.path,
    path: entry.path,
    type: entry.type === 'tree' ? 'directory' : 'file',
  }))),
  detectLanguage: vi.fn(),
}))

vi.mock('@/lib/github/client', () => ({
  fetchRepoViaProxy: vi.fn(),
  fetchTreeViaProxy: vi.fn(),
  fetchFileViaProxy: vi.fn(),
}))

vi.mock('@/lib/cache/repo-cache', () => ({
  getCachedRepo: vi.fn(),
  setCachedRepo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/code/import-parser', () => ({
  analyzeCodebase: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/github/indexing-pipeline', () => ({
  startIndexing: vi.fn(),
}))

vi.mock('@/providers/github-token-provider', () => ({
  useGitHubToken: vi.fn(() => ({ token: null })),
}))

import { getCachedRepo } from '@/lib/cache/repo-cache'
import { fetchFileViaProxy, fetchRepoViaProxy, fetchTreeViaProxy } from '@/lib/github/client'
import { startIndexing } from '@/lib/github/indexing-pipeline'
import { RepositoryProvider, useRepository } from '../repository-provider'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function repo(name: string): GitHubRepo {
  return {
    owner: 'acme',
    name,
    fullName: `acme/${name}`,
    description: null,
    defaultBranch: 'main',
    stars: 0,
    forks: 0,
    language: null,
    topics: [],
    isPrivate: false,
    url: `https://github.com/acme/${name}`,
    size: 1,
    openIssuesCount: 0,
    pushedAt: '2026-01-01T00:00:00Z',
    license: null,
  }
}

function tree(name: string): RepoTree {
  return {
    sha: `${name}-sha`,
    truncated: false,
    tree: [{ path: `${name}.ts`, mode: '100644', type: 'blob', sha: `${name}-file`, size: 10 }],
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <RepositoryProvider>{children}</RepositoryProvider>
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RepositoryProvider connection isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCachedRepo).mockResolvedValue(null)
    vi.mocked(startIndexing).mockResolvedValue(undefined)
  })

  it('commits only connection B when B resolves before A', async () => {
    const repoA = deferred<GitHubRepo>()
    const repoB = deferred<GitHubRepo>()
    const treeB = deferred<RepoTree>()
    vi.mocked(fetchRepoViaProxy).mockImplementation((_owner, name) => (
      name === 'a' ? repoA.promise : repoB.promise
    ))
    vi.mocked(fetchTreeViaProxy).mockImplementation((_owner, name) => {
      if (name !== 'b') throw new Error(`stale ${name} must not fetch a tree`)
      return treeB.promise
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    let connectA!: Promise<boolean>
    let connectB!: Promise<boolean>

    act(() => {
      connectA = result.current.connectRepository('https://github.com/acme/a')
      connectB = result.current.connectRepository('https://github.com/acme/b')
    })

    await act(async () => {
      repoB.resolve(repo('b'))
      await flush()
      treeB.resolve(tree('b'))
      await connectB
    })

    await act(async () => {
      repoA.resolve(repo('a'))
      await connectA
    })

    expect(result.current.repo?.fullName).toBe('acme/b')
    expect(result.current.files.map(file => file.path)).toEqual(['b.ts'])
    expect(fetchTreeViaProxy).toHaveBeenCalledTimes(1)

    const repoCalls = vi.mocked(fetchRepoViaProxy).mock.calls
    const signalA = repoCalls.find(([, name]) => name === 'a')?.[2]?.signal
    const signalB = repoCalls.find(([, name]) => name === 'b')?.[2]?.signal
    expect(signalA?.aborted).toBe(true)
    expect(signalB?.aborted).toBe(false)
    expect(vi.mocked(fetchTreeViaProxy).mock.calls[0][3]?.signal).toBe(signalB)
    expect(vi.mocked(getCachedRepo).mock.calls[0][2]?.signal).toBe(signalB)
    expect(vi.mocked(startIndexing).mock.calls[0][3]).toBe(signalB)
  })

  it('aborts the active connection when the provider unmounts', async () => {
    const pendingRepo = deferred<GitHubRepo>()
    vi.mocked(fetchRepoViaProxy).mockImplementation(() => pendingRepo.promise)

    const { result, unmount } = renderHook(() => useRepository(), { wrapper })
    let connection!: Promise<boolean>
    act(() => {
      connection = result.current.connectRepository('https://github.com/acme/a')
    })
    const signal = vi.mocked(fetchRepoViaProxy).mock.calls[0][2]?.signal

    unmount()
    expect(signal?.aborted).toBe(true)

    pendingRepo.resolve(repo('a'))
    await expect(connection).resolves.toBe(false)
  })

  it.each(['metadata', 'tree', 'cache'] as const)(
    'disconnect during pending %s work prevents late state repopulation',
    async (pendingStage) => {
      const pendingRepo = deferred<GitHubRepo>()
      const pendingTree = deferred<RepoTree>()
      const pendingCache = deferred<null>()

      vi.mocked(fetchRepoViaProxy).mockImplementation(() => (
        pendingStage === 'metadata' ? pendingRepo.promise : Promise.resolve(repo('a'))
      ))
      vi.mocked(fetchTreeViaProxy).mockImplementation(() => (
        pendingStage === 'tree' ? pendingTree.promise : Promise.resolve(tree('a'))
      ))
      vi.mocked(getCachedRepo).mockImplementation(() => (
        pendingStage === 'cache' ? pendingCache.promise : Promise.resolve(null)
      ))

      const { result } = renderHook(() => useRepository(), { wrapper })
      let connection!: Promise<boolean>
      act(() => {
        connection = result.current.connectRepository('https://github.com/acme/a')
      })
      await act(flush)

      act(() => result.current.disconnectRepository())

      await act(async () => {
        if (pendingStage === 'metadata') pendingRepo.resolve(repo('a'))
        if (pendingStage === 'tree') pendingTree.resolve(tree('a'))
        if (pendingStage === 'cache') pendingCache.resolve(null)
        await connection
      })

      expect(result.current.repo).toBeNull()
      expect(result.current.files).toEqual([])
      expect(result.current.codeIndex.totalFiles).toBe(0)
      expect(result.current.loadingStage).toBe('idle')
      expect(result.current.error).toBeNull()
    },
  )

  it('ignores stale A indexing rejection after connection B begins', async () => {
    const indexingA = deferred<void>()
    const indexingB = deferred<void>()
    vi.mocked(fetchRepoViaProxy).mockImplementation((_owner, name) => Promise.resolve(repo(name)))
    vi.mocked(fetchTreeViaProxy).mockImplementation((_owner, name) => Promise.resolve(tree(name)))
    vi.mocked(startIndexing).mockImplementation((repoData, _files, _sha, _signal, callbacks) => {
      if (repoData.name === 'a') return indexingA.promise
      callbacks.setLoadingStage('indexing')
      callbacks.setIndexingProgress({ current: 1, total: 2, isComplete: false })
      return indexingB.promise
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/b')
    })

    await act(async () => {
      indexingA.reject(new Error('A indexing failed late'))
      await flush()
    })

    expect(result.current.repo?.fullName).toBe('acme/b')
    expect(result.current.loadingStage).toBe('indexing')
    expect(result.current.indexingProgress).toEqual({ current: 1, total: 2, isComplete: false })
    expect(result.current.error).toBeNull()
  })

  it('does not return a late file response from a replaced connection', async () => {
    const fileA = deferred<string>()
    vi.mocked(fetchRepoViaProxy).mockImplementation((_owner, name) => Promise.resolve(repo(name)))
    vi.mocked(fetchTreeViaProxy).mockImplementation((_owner, name) => Promise.resolve(tree(name)))
    vi.mocked(fetchFileViaProxy).mockImplementation(() => fileA.promise)

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    let contentPromise!: Promise<string | null>
    act(() => {
      contentPromise = result.current.loadFileContent('late.ts')
    })
    await act(flush)

    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/b')
    })
    fileA.resolve('repository A content')

    await expect(contentPromise).resolves.toBeNull()
    expect(result.current.repo?.fullName).toBe('acme/b')
  })

  it('surfaces active indexing failure and returns to a retryable tree-ready state', async () => {
    const indexing = deferred<void>()
    vi.mocked(fetchRepoViaProxy).mockResolvedValue(repo('a'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('a'))
    vi.mocked(startIndexing).mockImplementation((_repo, _files, _sha, _signal, callbacks) => {
      callbacks.setLoadingStage('indexing')
      return indexing.promise
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    await act(async () => {
      indexing.reject(new Error('Index service unavailable'))
      await flush()
    })

    expect(result.current.repo?.fullName).toBe('acme/a')
    expect(result.current.files.map(file => file.path)).toEqual(['a.ts'])
    expect(result.current.error).toBe('Index service unavailable')
    expect(result.current.loadingStage).toBe('tree-ready')
    expect(result.current.indexingProgress.isComplete).toBe(false)
  })
})
