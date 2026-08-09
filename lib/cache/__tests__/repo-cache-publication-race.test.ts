import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import type { FileNode, RepositoryCoverage } from '@/types/repository'
import {
  createCacheMutationCoordinator,
  withCacheMutationLock,
  type CacheMutationCoordinator,
} from '../cache-mutation-lock'
import {
  clearAllCache,
  clearCachedRepo,
  getCachedRepo,
  publishCachedRepo,
  setCachedRepo,
  withHydratedCachedRepo,
} from '../repo-cache'
import { IDBContentStore } from '@/lib/code/content-store'
import { FakeWebLockManager, installFakeWebLocks } from './fake-web-lock-manager'

const TREE: FileNode[] = [{ name: 'index.ts', path: 'index.ts', type: 'file' }]
const COVERAGE: RepositoryCoverage = {
  treeStatus: 'complete',
  supportedFiles: { discovered: 1, loaded: 1 },
  failures: { count: 0, samples: [] },
  failedSubtrees: { count: 0, samples: [] },
  mode: 'full',
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function delayingCoordinator(
  base: CacheMutationCoordinator,
  entered: ReturnType<typeof deferred>,
  release: ReturnType<typeof deferred>,
): CacheMutationCoordinator {
  return {
    run: (signal, callback) => base.run(signal, async lease => {
      entered.resolve()
      await release.promise
      return callback(lease)
    }),
  }
}

describe('origin-wide repository cache publication', () => {
  let locks: FakeWebLockManager
  let firstClient: CacheMutationCoordinator
  let secondClient: CacheMutationCoordinator

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    locks = installFakeWebLocks()
    firstClient = createCacheMutationCoordinator(() => locks)
    secondClient = createCacheMutationCoordinator(() => locks)
  })

  it('prevents an older client publication from deleting a later publication', async () => {
    await setCachedRepo('owner', 'repo', 'sha-old', [
      { path: 'old-only.ts', content: 'old' },
    ], TREE, COVERAGE)

    const firstEntered = deferred()
    const releaseFirst = deferred()
    const store = new IDBContentStore('owner/repo')
    const publishA = withCacheMutationLock(undefined, async lease => {
      store.put('a-only.ts', 'a')
      await store.flush()
      firstEntered.resolve()
      await releaseFirst.promise
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-a', [
        { path: 'a-only.ts', content: 'a' },
      ], TREE, COVERAGE, undefined, { contentPaths: ['a-only.ts'] })
    }, firstClient)
    await firstEntered.promise

    const publishB = withCacheMutationLock(undefined, async lease => {
      store.put('b-only.ts', 'b')
      await store.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-b', [
        { path: 'b-only.ts', content: 'b' },
      ], TREE, COVERAGE, undefined, { contentPaths: ['b-only.ts'] })
    }, secondClient)

    releaseFirst.resolve()
    await Promise.all([publishA, publishB])

    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-b')
    expect(await store.get('b-only.ts')).toBe('b')
    expect(await store.get('a-only.ts')).toBeNull()
  })

  it('clear-all acquiring first clears both stores and a later publication survives', async () => {
    const entered = deferred()
    const release = deferred()
    const clearingClient = delayingCoordinator(firstClient, entered, release)
    const clear = clearAllCache({ coordinator: clearingClient })
    await entered.promise

    const store = new IDBContentStore('owner/repo')
    const publish = withCacheMutationLock(undefined, async lease => {
      store.put('new.ts', 'new')
      await store.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-new', [
        { path: 'new.ts', content: 'new' },
      ], TREE, COVERAGE, undefined, { contentPaths: ['new.ts'] })
    }, secondClient)

    release.resolve()
    await Promise.all([clear, publish])
    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-new')
    expect(await store.get('new.ts')).toBe('new')
  })

  it('publication acquiring first completes before a later clear removes both stores', async () => {
    const entered = deferred()
    const release = deferred()
    const store = new IDBContentStore('owner/repo')
    const publish = withCacheMutationLock(undefined, async lease => {
      store.put('new.ts', 'new')
      await store.flush()
      entered.resolve()
      await release.promise
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-new', [
        { path: 'new.ts', content: 'new' },
      ], TREE, COVERAGE, undefined, { contentPaths: ['new.ts'] })
    }, firstClient)
    await entered.promise

    const clear = clearAllCache({ coordinator: secondClient })
    release.resolve()
    await Promise.all([publish, clear])
    expect(await getCachedRepo('owner', 'repo')).toBeNull()
    expect(await store.get('new.ts')).toBeNull()
  })

  it('serializes a concurrent cache touch before LRU selection and revalidation', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)
    for (let index = 1; index <= 5; index++) {
      await setCachedRepo('owner', `repo-${index}`, `sha-${index}`, [], TREE, COVERAGE)
    }

    const entered = deferred()
    const release = deferred()
    const touchingClient = delayingCoordinator(firstClient, entered, release)
    const touch = getCachedRepo('owner', 'repo-1', { coordinator: touchingClient })
    await entered.promise
    const publish = setCachedRepo('owner', 'repo-6', 'sha-6', [], TREE, COVERAGE, undefined, {
      coordinator: secondClient,
    })

    release.resolve()
    await Promise.all([touch, publish])
    expect(await getCachedRepo('owner', 'repo-1')).not.toBeNull()
    expect(await getCachedRepo('owner', 'repo-2')).toBeNull()
  })

  it('finishes lookup, hydration, touch, and consumption before a queued clear', async () => {
    await setCachedRepo('owner', 'repo', 'sha-old', [
      { path: 'old.ts', content: 'old' },
    ], TREE, COVERAGE)
    const consumed = deferred()
    const release = deferred()
    let hydratedContent: string | null = null
    const lookup = withHydratedCachedRepo('owner', 'repo', 'sha-old', {
      useIDB: true,
      coordinator: firstClient,
    }, async result => {
      hydratedContent = await result.index.contentStore.get('old.ts')
      consumed.resolve()
      await release.promise
    })
    await consumed.promise

    let clearFinished = false
    const clear = clearCachedRepo('owner', 'repo', { coordinator: secondClient })
      .then(() => { clearFinished = true })
    await Promise.resolve()
    expect(clearFinished).toBe(false)

    release.resolve()
    await Promise.all([lookup, clear])
    expect(hydratedContent).toBe('old')
    expect(await getCachedRepo('owner', 'repo')).toBeNull()
  })

  it('orders newer publication after an in-flight old lookup without stale rewrites', async () => {
    await setCachedRepo('owner', 'repo', 'sha-old', [
      { path: 'value.ts', content: 'old' },
    ], TREE, COVERAGE)
    const consumed = deferred()
    const release = deferred()
    const lookup = withHydratedCachedRepo('owner', 'repo', 'sha-old', {
      useIDB: true,
      coordinator: firstClient,
    }, async () => {
      consumed.resolve()
      await release.promise
    })
    await consumed.promise

    const store = new IDBContentStore('owner/repo')
    const publish = withCacheMutationLock(undefined, async lease => {
      store.put('value.ts', 'new')
      await store.flush()
      await publishCachedRepo(lease, 'owner', 'repo', 'sha-new', [
        { path: 'value.ts', content: 'new' },
      ], TREE, COVERAGE, undefined, { contentPaths: ['value.ts'] })
    }, secondClient)
    release.resolve()
    await Promise.all([lookup, publish])

    expect((await getCachedRepo('owner', 'repo'))?.sha).toBe('sha-new')
    expect(await store.get('value.ts')).toBe('new')
  })

  it('makes a lookup queued behind publication observe only the new manifest', async () => {
    await setCachedRepo('owner', 'repo', 'sha-old', [
      { path: 'value.ts', content: 'old' },
    ], TREE, COVERAGE)
    const entered = deferred()
    const release = deferred()
    const publishingClient = delayingCoordinator(firstClient, entered, release)
    const publish = setCachedRepo('owner', 'repo', 'sha-new', [
      { path: 'value.ts', content: 'new' },
    ], TREE, COVERAGE, undefined, { coordinator: publishingClient })
    await entered.promise

    let consumedSha: string | undefined
    const lookup = withHydratedCachedRepo('owner', 'repo', 'sha-new', {
      useIDB: true,
      coordinator: secondClient,
    }, result => { consumedSha = result.cached.sha })
    release.resolve()
    await Promise.all([publish, lookup])
    expect(consumedSha).toBe('sha-new')
  })
})
