const CACHE_MUTATION_LOCK_NAME = 'repolens-cache-mutation'

const cacheMutationLeaseBrand: unique symbol = Symbol('cacheMutationLease')

export interface CacheMutationLease {
  readonly [cacheMutationLeaseBrand]: true
  readonly crossContextSafe: boolean
  readonly signal?: AbortSignal
}

interface ActiveCacheMutationLease extends CacheMutationLease {
  active: boolean
}

export interface WebLockManagerLike {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>
}

export interface CacheMutationCoordinator {
  run<T>(
    signal: AbortSignal | undefined,
    callback: (lease: CacheMutationLease) => Promise<T>,
  ): Promise<T>
}

export class CacheCoordinationUnavailableError extends Error {
  constructor() {
    super('Cross-context cache coordination is unavailable')
    this.name = 'CacheCoordinationUnavailableError'
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

class LocalMutex {
  private locked = false
  private readonly waiters: Array<{
    resolve: (release: () => void) => void
    reject: (reason: unknown) => void
    signal?: AbortSignal
    onAbort?: () => void
  }> = []

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    if (!this.locked) {
      this.locked = true
      return Promise.resolve(this.createRelease())
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal } as (typeof this.waiters)[number]
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(abortReason(signal))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  private createRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const waiter = this.waiters.shift()
      if (!waiter) {
        this.locked = false
        return
      }
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort)
      }
      waiter.resolve(this.createRelease())
    }
  }
}

export function createCacheMutationCoordinator(
  getLockManager: () => WebLockManagerLike | null = () => {
    if (typeof navigator === 'undefined' || !navigator.locks) return null
    return navigator.locks as WebLockManagerLike
  },
): CacheMutationCoordinator {
  const localMutex = new LocalMutex()

  const execute = async <T>(
    crossContextSafe: boolean,
    signal: AbortSignal | undefined,
    callback: (lease: CacheMutationLease) => Promise<T>,
  ): Promise<T> => {
    if (signal?.aborted) throw abortReason(signal)
    const lease: ActiveCacheMutationLease = {
      [cacheMutationLeaseBrand]: true,
      crossContextSafe,
      signal,
      active: true,
    }
    try {
      return await callback(lease)
    } finally {
      lease.active = false
    }
  }

  return {
    async run<T>(signal: AbortSignal | undefined, callback: (lease: CacheMutationLease) => Promise<T>): Promise<T> {
      if (signal?.aborted) throw abortReason(signal)
      const lockManager = getLockManager()
      if (lockManager) {
        const options = signal
          ? { mode: 'exclusive' as const, signal }
          : { mode: 'exclusive' as const }
        return lockManager.request(
          CACHE_MUTATION_LOCK_NAME,
          options,
          () => execute(true, signal, callback),
        )
      }

      const release = await localMutex.acquire(signal)
      try {
        return await execute(false, signal, callback)
      } finally {
        release()
      }
    },
  }
}

const defaultCoordinator = createCacheMutationCoordinator()

export function withCacheMutationLock<T>(
  signal: AbortSignal | undefined,
  callback: (lease: CacheMutationLease) => Promise<T>,
  coordinator: CacheMutationCoordinator = defaultCoordinator,
): Promise<T> {
  return coordinator.run(signal, callback)
}

export function assertActiveCacheMutationLease(lease: CacheMutationLease): void {
  const candidate = lease as ActiveCacheMutationLease
  if (candidate[cacheMutationLeaseBrand] !== true || !candidate.active) {
    throw new Error('Cache mutation lease is no longer active')
  }
}

export function requireCrossContextCacheCoordination(lease: CacheMutationLease): void {
  assertActiveCacheMutationLease(lease)
  if (!lease.crossContextSafe) throw new CacheCoordinationUnavailableError()
}

export function throwIfCacheMutationAborted(lease: CacheMutationLease): void {
  assertActiveCacheMutationLease(lease)
  if (lease.signal?.aborted) throw abortReason(lease.signal)
}
