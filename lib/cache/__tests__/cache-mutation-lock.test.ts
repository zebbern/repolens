import { describe, expect, it, vi } from 'vitest'
import {
  assertActiveCacheMutationLease,
  createCacheMutationCoordinator,
  type CacheMutationLease,
  throwIfCacheMutationAborted,
  withCacheMutationLock,
} from '../cache-mutation-lock'
import { FakeWebLockManager } from './fake-web-lock-manager'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('cache mutation coordination', () => {
  it('serializes independent client coordinators through one origin lock', async () => {
    const locks = new FakeWebLockManager()
    const firstClient = createCacheMutationCoordinator(() => locks)
    const secondClient = createCacheMutationCoordinator(() => locks)
    const release = deferred()
    const entered = deferred()
    const order: string[] = []

    const first = withCacheMutationLock(undefined, async lease => {
      expect(lease.crossContextSafe).toBe(true)
      order.push('first-enter')
      entered.resolve()
      await release.promise
      order.push('first-exit')
    }, firstClient)
    await entered.promise
    const second = withCacheMutationLock(undefined, async () => {
      order.push('second')
    }, secondClient)

    await Promise.resolve()
    expect(order).toEqual(['first-enter'])
    release.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-enter', 'first-exit', 'second'])
  })

  it('cancels a queued contender without leaking its abort listener', async () => {
    const locks = new FakeWebLockManager()
    const firstClient = createCacheMutationCoordinator(() => locks)
    const secondClient = createCacheMutationCoordinator(() => locks)
    const release = deferred()
    const entered = deferred()
    const first = withCacheMutationLock(undefined, async () => {
      entered.resolve()
      await release.promise
    }, firstClient)
    await entered.promise

    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const second = withCacheMutationLock(controller.signal, async () => {}, secondClient)
    controller.abort()

    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    release.resolve()
    await first

    await withCacheMutationLock(undefined, async () => {}, secondClient)
  })

  it('keeps a granted lock until callback settlement and observes mid-operation aborts', async () => {
    const locks = new FakeWebLockManager()
    const coordinator = createCacheMutationCoordinator(() => locks)
    const controller = new AbortController()
    const observed = deferred()

    const operation = withCacheMutationLock(controller.signal, async lease => {
      controller.abort()
      try {
        throwIfCacheMutationAborted(lease)
      } finally {
        observed.resolve()
      }
    }, coordinator)

    await observed.promise
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    await withCacheMutationLock(undefined, async () => {}, coordinator)
  })

  it('uses an abortable module-local fallback and marks it cross-context unsafe', async () => {
    const coordinator = createCacheMutationCoordinator(() => null)
    const release = deferred()
    const entered = deferred()
    const first = withCacheMutationLock(undefined, async lease => {
      expect(lease.crossContextSafe).toBe(false)
      entered.resolve()
      await release.promise
    }, coordinator)
    await entered.promise

    const controller = new AbortController()
    const second = withCacheMutationLock(controller.signal, async () => {}, coordinator)
    controller.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    release.resolve()
    await first
    await withCacheMutationLock(undefined, async () => {}, coordinator)
  })

  it('invalidates a scoped lease when its callback settles', async () => {
    const coordinator = createCacheMutationCoordinator(() => null)
    let captured: CacheMutationLease | undefined
    await withCacheMutationLock(undefined, async lease => {
      captured = lease
      assertActiveCacheMutationLease(lease)
    }, coordinator)

    expect(() => assertActiveCacheMutationLease(captured!)).toThrow('no longer active')
  })
})
