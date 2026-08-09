import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createCacheMutationCoordinator, withCacheMutationLock } from '@/lib/cache/cache-mutation-lock'
import { FakeWebLockManager } from '@/lib/cache/__tests__/fake-web-lock-manager'
import { openIndexedDB } from '../open-indexed-db'

function openVersion(name: string, version: number): Promise<IDBDatabase> {
  return openIndexedDB({
    name,
    version,
    upgrade: db => {
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records')
    },
  })
}

describe('openIndexedDB cancellation', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  it('promptly releases a cache lock when a blocked upgrade is aborted and closes late success', async () => {
    const blocker = await openVersion('blocked-open', 1)
    // This test owns the blocker and intentionally ignores versionchange.
    blocker.onversionchange = null
    const locks = new FakeWebLockManager()
    const firstClient = createCacheMutationCoordinator(() => locks)
    const secondClient = createCacheMutationCoordinator(() => locks)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    const blocked = withCacheMutationLock(controller.signal, async () => {
      await openIndexedDB({
        name: 'blocked-open',
        version: 2,
        signal: controller.signal,
        upgrade: () => {},
      })
    }, firstClient)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    await expect(blocked).rejects.toMatchObject({ name: 'AbortError' })
    expect(remove).toHaveBeenCalled()

    let nextEntered = false
    await withCacheMutationLock(undefined, async () => {
      nextEntered = true
      expect(blocker.transaction('records').objectStore('records')).toBeDefined()
    }, secondClient)
    expect(nextEntered).toBe(true)

    blocker.close()
    const later = await openVersion('blocked-open', 3)
    later.close()
  })
})
