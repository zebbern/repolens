import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubRepo, CompleteRepoTree, ResolvedRepoTree } from '@/types/repository'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

vi.mock('@/lib/github/fetcher', () => ({
  buildFileTree: vi.fn((tree: ResolvedRepoTree) => tree.tree.map(entry => ({
    name: entry.path,
    path: entry.path,
    type: entry.type === 'tree' ? 'directory' : entry.type === 'commit' ? 'submodule' : 'file',
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
  withHydratedCachedRepo: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: { warning: vi.fn() },
}))

import { getCachedRepo, withHydratedCachedRepo } from '@/lib/cache/repo-cache'
import { batchIndexFiles, batchIndexMetadataOnly, createEmptyIndex, createEmptyIndexWithStore } from '@/lib/code/code-index'
import { IDBContentStore } from '@/lib/code/content-store'
import { fetchFileViaProxy, fetchRepoViaProxy, fetchTreeViaProxy } from '@/lib/github/client'
import { startIndexing } from '@/lib/github/indexing-pipeline'
import { RepositoryProvider, useRepository } from '../repository-provider'
import { PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT } from '@/lib/auth/credential-events'

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

function tree(name: string): CompleteRepoTree {
  return {
    status: 'complete',
    requestCount: 1,
    sha: `${name}-sha`,
    truncated: false,
    tree: [{ path: `${name}.ts`, mode: '100644', type: 'blob', sha: `${name}-file`, size: 10 }],
  }
}

function partialTree(name: string): ResolvedRepoTree {
  return {
    status: 'partial',
    requestCount: 3,
    sha: `${name}-sha`,
    truncated: true,
    tree: [{ path: `${name}-current.ts`, mode: '100644', type: 'blob', sha: `${name}-file`, size: 10 }],
    reasons: ['fetch-failed'],
    failureDetails: [{ path: 'vendor', reason: 'fetch-failed', message: 'unavailable' }],
    failedSubtrees: ['vendor'],
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
    vi.mocked(withHydratedCachedRepo).mockImplementation(async (owner, name, sha, options, consume) => {
      const cached = await vi.mocked(getCachedRepo)(owner, name, { signal: options.signal })
      if (!cached || cached.sha !== sha) return false
      let index
      if (cached.content.kind === 'inline') {
        index = batchIndexFiles(createEmptyIndex(), cached.content.files)
      } else {
        const store = new IDBContentStore(cached.content.storeKey, options.signal, { kind: 'disabled' })
        store.registerPaths(cached.content.files.map(file => file.path))
        index = batchIndexMetadataOnly(createEmptyIndexWithStore(store), cached.content.files)
      }
      index.coverage = cached.coverage
      consume({ cached, index, contentHydratedDurably: true })
      return true
    })
    vi.mocked(startIndexing).mockResolvedValue(undefined)
  })

  it('commits only connection B when B resolves before A', async () => {
    const repoA = deferred<GitHubRepo>()
    const repoB = deferred<GitHubRepo>()
    const treeB = deferred<CompleteRepoTree>()
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
    expect(vi.mocked(withHydratedCachedRepo).mock.calls[0][3]?.signal).toBe(signalB)
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

  it('aborts a repository connection when credentials are revoked before metadata resolves', async () => {
    const pendingRepo = deferred<GitHubRepo>()
    vi.mocked(fetchRepoViaProxy).mockImplementation(() => pendingRepo.promise)

    const { result } = renderHook(() => useRepository(), { wrapper })
    let connection!: Promise<boolean>
    act(() => {
      connection = result.current.connectRepository('https://github.com/acme/private')
    })
    const signal = vi.mocked(fetchRepoViaProxy).mock.calls[0][2]?.signal
    expect(signal?.aborted).toBe(false)

    act(() => window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT)))

    expect(signal?.aborted).toBe(true)
    await act(async () => {
      pendingRepo.resolve({ ...repo('private'), isPrivate: true })
      await expect(connection).resolves.toBe(false)
    })
    expect(fetchTreeViaProxy).not.toHaveBeenCalled()
    expect(result.current.repo).toBeNull()
  })

  it('disconnects an active private repository when credentials are revoked', async () => {
    vi.mocked(fetchRepoViaProxy).mockResolvedValue({ ...repo('private'), isPrivate: true })
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('private'))

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/private')
    })
    expect(result.current.repo?.isPrivate).toBe(true)

    act(() => window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT)))

    expect(result.current.repo).toBeNull()
    expect(result.current.files).toEqual([])
  })

  it('keeps an established public repository when credentials are revoked', async () => {
    vi.mocked(fetchRepoViaProxy).mockResolvedValue(repo('public'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('public'))

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/public')
    })
    const signal = vi.mocked(fetchRepoViaProxy).mock.calls[0][2]?.signal

    act(() => window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT)))

    expect(signal?.aborted).toBe(false)
    expect(result.current.repo?.fullName).toBe('acme/public')
    expect(result.current.files.map(file => file.path)).toEqual(['public.ts'])
  })

  it('re-indexes a current partial tree instead of relabeling it from a same-SHA complete cache', async () => {
    vi.mocked(fetchRepoViaProxy).mockResolvedValue(repo('a'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(partialTree('a'))
    vi.mocked(getCachedRepo).mockResolvedValue({
      schemaVersion: 5,
      complete: true,
      coverage: {
        treeStatus: 'complete',
        supportedFiles: { discovered: 1, loaded: 1 },
        failures: { count: 0, samples: [] },
        failedSubtrees: { count: 0, samples: [] },
        mode: 'full',
      },
      key: 'acme/a', owner: 'acme', repo: 'a', sha: 'a-sha', timestamp: 1,
      content: { kind: 'inline', files: [{ path: 'stale.ts', content: 'stale' }] },
      tree: [{ name: 'stale.ts', path: 'stale.ts', type: 'file' }],
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    expect(result.current.isCacheHit).toBe(false)
    expect(result.current.files.map(file => file.path)).toEqual(['a-current.ts'])
    expect(result.current.coverage).toMatchObject({ treeStatus: 'partial' })
    expect(startIndexing).toHaveBeenCalledOnce()
    expect(vi.mocked(startIndexing).mock.calls[0][5]?.coverage).toMatchObject({ treeStatus: 'partial' })
  })

  it('does not load or pin a visible submodule as file content', async () => {
    vi.mocked(fetchRepoViaProxy).mockResolvedValue(repo('a'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue({
      ...tree('a'),
      tree: [{ path: 'vendor', mode: '160000', type: 'commit', sha: 'submodule' }],
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    expect(result.current.files).toContainEqual(expect.objectContaining({ path: 'vendor', type: 'submodule' }))
    await expect(result.current.loadFileContent('vendor')).resolves.toBeNull()
    act(() => result.current.pinFile('vendor'))
    expect(result.current.pinnedFiles.has('vendor')).toBe(false)
    expect(fetchFileViaProxy).not.toHaveBeenCalled()
  })

  it('hydrates complete same-SHA cache tree, index, and coverage as one consistent snapshot', async () => {
    vi.mocked(fetchRepoViaProxy).mockResolvedValue(repo('a'))
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('a'))
    const cachedCoverage = {
      treeStatus: 'complete' as const,
      supportedFiles: { discovered: 1, loaded: 1 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full' as const,
    }
    vi.mocked(getCachedRepo).mockResolvedValue({
      schemaVersion: 5, complete: true, coverage: cachedCoverage,
      key: 'acme/a', owner: 'acme', repo: 'a', sha: 'a-sha', timestamp: 1,
      content: { kind: 'inline', files: [{ path: 'cached.ts', content: 'export const cached = true' }] },
      tree: [{ name: 'cached.ts', path: 'cached.ts', type: 'file' }],
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    expect(result.current.isCacheHit).toBe(true)
    expect(result.current.files.map(file => file.path)).toEqual(['cached.ts'])
    expect([...result.current.codeIndex.files.keys()]).toEqual(['cached.ts'])
    expect(result.current.coverage).toEqual(cachedCoverage)
    expect(startIndexing).not.toHaveBeenCalled()
  })

  it('hydrates an IDB cache hit as metadata without rewriting its source', async () => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    vi.mocked(fetchRepoViaProxy).mockResolvedValue({ ...repo('a'), size: 60_000 })
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('a'))
    const shared = new IDBContentStore('acme/a@a-sha')
    shared.put('cached.ts', 'export const cached = true')
    await shared.flush()
    const cachedCoverage = {
      treeStatus: 'complete' as const,
      supportedFiles: { discovered: 1, loaded: 1 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full' as const,
    }
    vi.mocked(getCachedRepo).mockResolvedValue({
      schemaVersion: 5, complete: true, coverage: cachedCoverage,
      key: 'acme/a', owner: 'acme', repo: 'a', sha: 'a-sha', timestamp: 1,
      content: {
        kind: 'idb',
        storeKey: 'acme/a@a-sha',
        files: [{ path: 'cached.ts', lineCount: 1 }],
      },
      tree: [{ name: 'cached.ts', path: 'cached.ts', type: 'file' }],
    })
    const putBatch = vi.spyOn(IDBContentStore.prototype, 'putBatch')
    const flushStore = vi.spyOn(IDBContentStore.prototype, 'flush')

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    expect(result.current.isCacheHit).toBe(true)
    expect(result.current.loadingStage).toBe('cached')
    expect(result.current.codeIndex.files.get('cached.ts')?.content).toBeUndefined()
    expect(result.current.codeIndex.contentStore).toBeInstanceOf(IDBContentStore)
    await expect(result.current.codeIndex.contentStore.get('cached.ts')).resolves.toBe(
      'export const cached = true',
    )
    expect(putBatch).not.toHaveBeenCalled()
    expect(flushStore).not.toHaveBeenCalled()
    expect(startIndexing).not.toHaveBeenCalled()
  })

  it('exposes virtual rename source through the session store without mutating shared hydrated content', async () => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    vi.mocked(fetchRepoViaProxy).mockResolvedValue({ ...repo('a'), size: 60_000 })
    vi.mocked(fetchTreeViaProxy).mockResolvedValue(tree('a'))
    const shared = new IDBContentStore('acme/a@a-sha')
    shared.put('a.ts', 'published')
    await shared.flush()
    const cachedCoverage = {
      treeStatus: 'complete' as const,
      supportedFiles: { discovered: 1, loaded: 1 },
      failures: { count: 0, samples: [] },
      failedSubtrees: { count: 0, samples: [] },
      mode: 'full' as const,
    }
    vi.mocked(getCachedRepo).mockResolvedValue({
      schemaVersion: 5, complete: true, coverage: cachedCoverage,
      key: 'acme/a', owner: 'acme', repo: 'a', sha: 'a-sha', timestamp: 1,
      content: {
        kind: 'idb',
        storeKey: 'acme/a@a-sha',
        files: [{ path: 'a.ts', lineCount: 1 }],
      },
      tree: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
    })

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
      await result.current.renameFiles([{ from: 'a.ts', to: 'renamed.ts' }])
    })

    expect(result.current.codeIndex.contentStore).toBeInstanceOf(IDBContentStore)
    expect(result.current.codeIndex.files.has('renamed.ts')).toBe(true)
    expect(result.current.codeIndex.files.get('renamed.ts')?.content).toBe('published')
    expect(await result.current.codeIndex.contentStore.get('a.ts')).toBeNull()
    expect(await result.current.codeIndex.contentStore.get('renamed.ts')).toBe('published')
    expect(await shared.get('a.ts')).toBe('published')
    expect(await shared.get('renamed.ts')).toBeNull()

    await act(async () => {
      await result.current.renameFiles([{ from: 'renamed.ts', to: 'a.ts' }])
    })

    expect(result.current.codeIndex.files.has('a.ts')).toBe(true)
    expect(result.current.codeIndex.files.has('renamed.ts')).toBe(false)
    expect(await result.current.codeIndex.contentStore.get('a.ts')).toBe('published')
    expect(await result.current.codeIndex.contentStore.get('renamed.ts')).toBeNull()
    expect(await shared.get('a.ts')).toBe('published')
    expect(await shared.get('renamed.ts')).toBeNull()
  })

  it('does not commit a pending IDB rename after switching repositories', async () => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    const shared = new IDBContentStore('acme/a@a-sha')
    shared.put('a.ts', 'published')
    await shared.flush()
    const cachedA = {
      schemaVersion: 5 as const,
      complete: true as const,
      coverage: {
        treeStatus: 'complete' as const,
        supportedFiles: { discovered: 1, loaded: 1 },
        failures: { count: 0, samples: [] },
        failedSubtrees: { count: 0, samples: [] },
        mode: 'full' as const,
      },
      key: 'acme/a', owner: 'acme', repo: 'a', sha: 'a-sha', timestamp: 1,
      content: {
        kind: 'idb' as const,
        storeKey: 'acme/a@a-sha',
        files: [{ path: 'a.ts', lineCount: 1 }],
      },
      tree: [{ name: 'a.ts', path: 'a.ts', type: 'file' as const }],
    }
    vi.mocked(getCachedRepo).mockImplementation(async (_owner, name) => (
      name === 'a' ? cachedA : null
    ))
    vi.mocked(fetchRepoViaProxy).mockImplementation(async (_owner, name) => repo(name))
    vi.mocked(fetchTreeViaProxy).mockImplementation(async (_owner, name) => tree(name))

    const { result } = renderHook(() => useRepository(), { wrapper })
    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/a')
    })

    const pendingRead = deferred<Map<string, string>>()
    vi.spyOn(result.current.codeIndex.contentStore, 'getBatch').mockReturnValue(pendingRead.promise)
    let rename!: Promise<number>
    act(() => {
      rename = result.current.renameFiles([{ from: 'a.ts', to: 'renamed.ts' }])
    })
    await act(flush)

    await act(async () => {
      await result.current.connectRepository('https://github.com/acme/b')
    })
    await act(async () => {
      pendingRead.resolve(new Map([['a.ts', 'published']]))
      await expect(rename).resolves.toBe(0)
    })

    expect(result.current.repo?.fullName).toBe('acme/b')
    expect(result.current.files.map(file => file.path)).toEqual(['b.ts'])
    expect(result.current.codeIndex.files.has('renamed.ts')).toBe(false)
  })

  it.each(['metadata', 'tree', 'cache'] as const)(
    'disconnect during pending %s work prevents late state repopulation',
    async (pendingStage) => {
      const pendingRepo = deferred<GitHubRepo>()
      const pendingTree = deferred<CompleteRepoTree>()
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
