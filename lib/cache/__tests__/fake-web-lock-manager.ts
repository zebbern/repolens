import type { WebLockManagerLike } from '../cache-mutation-lock'

interface Waiter<T> {
  callback: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class FakeWebLockManager implements WebLockManagerLike {
  private readonly active = new Set<string>()
  private readonly queues = new Map<string, Waiter<unknown>[]>()

  request<T>(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }

    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { callback, resolve, reject, signal: options.signal }
      if (!this.active.has(name)) {
        this.active.add(name)
        this.run(name, waiter)
        return
      }

      if (options.signal) {
        waiter.onAbort = () => {
          const queue = this.queues.get(name)
          const index = queue?.indexOf(waiter as Waiter<unknown>) ?? -1
          if (index !== -1) queue?.splice(index, 1)
          reject(options.signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
        }
        options.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      const queue = this.queues.get(name) ?? []
      queue.push(waiter as Waiter<unknown>)
      this.queues.set(name, queue)
    })
  }

  private run<T>(name: string, waiter: Waiter<T>): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
    void waiter.callback().then(waiter.resolve, waiter.reject).finally(() => {
      const next = this.queues.get(name)?.shift()
      if (next) {
        this.run(name, next)
      } else {
        this.active.delete(name)
        this.queues.delete(name)
      }
    })
  }
}

export function installFakeWebLocks(lockManager = new FakeWebLockManager()): FakeWebLockManager {
  if (typeof navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })
  }
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: lockManager,
  })
  return lockManager
}
