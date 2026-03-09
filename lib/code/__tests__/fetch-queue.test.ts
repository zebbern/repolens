import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FetchQueue, type FetchPriority, type FetchQueueStats } from '../fetch-queue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock fetchFn that resolves with `content:{path}` after a tick. */
function createMockFetchFn() {
  return vi.fn(async (path: string) => `content:${path}`)
}

/** Creates a fetchFn that blocks until resolved externally (for concurrency tests). */
function createBlockingFetchFn() {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>()
  const fetchFn = vi.fn((path: string) => {
    return new Promise<string>((resolve, reject) => {
      pending.set(path, { resolve, reject })
    })
  })
  return { fetchFn, pending }
}

// ===========================================================================
// enqueue basics
// ===========================================================================

describe('FetchQueue — enqueue', () => {
  it('returns a promise that resolves with fetched content', async () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    const result = await queue.enqueue('src/app.ts', 'normal')

    expect(result).toBe('content:src/app.ts')
    expect(fetchFn).toHaveBeenCalledWith('src/app.ts')
  })

  it('deduplicates in-flight requests — same path returns same promise', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn })

    const p1 = queue.enqueue('file.ts', 'normal')
    const p2 = queue.enqueue('file.ts', 'normal')

    expect(p1).toBe(p2)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Resolve the pending fetch
    pending.get('file.ts')!.resolve('hello')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('hello')
    expect(r2).toBe('hello')
  })

  it('already-completed path returns cached result without re-fetching', async () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    // First fetch
    await queue.enqueue('cached.ts', 'normal')
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Second fetch — should return cached
    const result = await queue.enqueue('cached.ts', 'normal')
    expect(result).toBe('content:cached.ts')
    expect(fetchFn).toHaveBeenCalledTimes(1) // not called again
  })

  it('rejects with the fetch error when fetchFn fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
    const queue = new FetchQueue({ fetchFn })

    await expect(queue.enqueue('fail.ts', 'normal')).rejects.toThrow('Network error')
  })
})

// ===========================================================================
// priority ordering
// ===========================================================================

describe('FetchQueue — priority ordering', () => {
  it('critical items are fetched before low items', async () => {
    const fetchOrder: string[] = []
    const { fetchFn, pending } = createBlockingFetchFn()
    // Concurrency of 1 so we can observe ordering
    const queue = new FetchQueue({ fetchFn, concurrency: 1 })

    // Fill the single slot
    const blocker = queue.enqueue('blocker.ts', 'normal')
    // Now queue items with different priorities — all will wait
    const lowP = queue.enqueue('low.ts', 'low')
    const critP = queue.enqueue('critical.ts', 'critical')
    const highP = queue.enqueue('high.ts', 'high')

    // Unblock the first
    pending.get('blocker.ts')!.resolve('done')
    await blocker

    // Record fetch order as items complete
    const recordFetch = (path: string, p: Promise<string>) =>
      p.then(() => fetchOrder.push(path)).catch(() => {})

    recordFetch('critical.ts', critP)
    recordFetch('high.ts', highP)
    recordFetch('low.ts', lowP)

    // Resolve remaining in order they're called
    // critical should be next
    await vi.waitFor(() => expect(pending.has('critical.ts')).toBe(true))
    pending.get('critical.ts')!.resolve('done')
    await critP

    await vi.waitFor(() => expect(pending.has('high.ts')).toBe(true))
    pending.get('high.ts')!.resolve('done')
    await highP

    await vi.waitFor(() => expect(pending.has('low.ts')).toBe(true))
    pending.get('low.ts')!.resolve('done')
    await lowP

    expect(fetchOrder).toEqual(['critical.ts', 'high.ts', 'low.ts'])
  })

  it('FIFO within same priority level', async () => {
    const fetchOrder: string[] = []
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn, concurrency: 1 })

    // Fill slot
    const blocker = queue.enqueue('blocker.ts', 'normal')

    // Queue 3 items at same priority
    const p1 = queue.enqueue('first.ts', 'normal')
    const p2 = queue.enqueue('second.ts', 'normal')
    const p3 = queue.enqueue('third.ts', 'normal')

    // Unblock
    pending.get('blocker.ts')!.resolve('done')
    await blocker

    for (const [name, p] of [['first.ts', p1], ['second.ts', p2], ['third.ts', p3]] as const) {
      await vi.waitFor(() => expect(pending.has(name)).toBe(true))
      pending.get(name)!.resolve('done')
      await p
      fetchOrder.push(name)
    }

    expect(fetchOrder).toEqual(['first.ts', 'second.ts', 'third.ts'])
  })
})

// ===========================================================================
// concurrency
// ===========================================================================

describe('FetchQueue — concurrency', () => {
  it('limits concurrent fetches to the configured amount', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn, concurrency: 2 })

    // Enqueue 4 items
    queue.enqueue('a.ts', 'normal')
    queue.enqueue('b.ts', 'normal')
    queue.enqueue('c.ts', 'normal')
    queue.enqueue('d.ts', 'normal')

    // Only 2 should be in-flight
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(fetchFn).toHaveBeenCalledWith('a.ts')
    expect(fetchFn).toHaveBeenCalledWith('b.ts')

    // Resolve one — should start the next
    pending.get('a.ts')!.resolve('done')
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))
    expect(fetchFn).toHaveBeenCalledWith('c.ts')

    // Resolve the rest
    pending.get('b.ts')!.resolve('done')
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4))
    pending.get('c.ts')!.resolve('done')
    pending.get('d.ts')!.resolve('done')
  })

  it('defaults concurrency to 10', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn })

    for (let i = 0; i < 15; i++) {
      queue.enqueue(`file${i}.ts`, 'normal')
    }

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(10))

    // 11th should NOT have been called yet
    expect(fetchFn).not.toHaveBeenCalledWith('file10.ts')

    // Resolve one to free slot
    pending.get('file0.ts')!.resolve('done')
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(11))
    expect(fetchFn).toHaveBeenCalledWith('file10.ts')

    // Clean up remaining
    for (let i = 1; i < 15; i++) {
      const key = `file${i}.ts`
      if (pending.has(key)) pending.get(key)!.resolve('done')
    }
  })
})

// ===========================================================================
// enqueueBatch
// ===========================================================================

describe('FetchQueue — enqueueBatch', () => {
  it('enqueues multiple paths and returns a Map of results', async () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    const results = await queue.enqueueBatch(['a.ts', 'b.ts', 'c.ts'], 'normal')

    expect(results.size).toBe(3)
    expect(results.get('a.ts')).toBe('content:a.ts')
    expect(results.get('b.ts')).toBe('content:b.ts')
    expect(results.get('c.ts')).toBe('content:c.ts')
  })

  it('skips individual failures silently', async () => {
    const fetchFn = vi.fn(async (path: string) => {
      if (path === 'fail.ts') throw new Error('fail')
      return `content:${path}`
    })
    const queue = new FetchQueue({ fetchFn })

    const results = await queue.enqueueBatch(['ok.ts', 'fail.ts', 'also-ok.ts'], 'normal')

    expect(results.size).toBe(2)
    expect(results.has('ok.ts')).toBe(true)
    expect(results.has('also-ok.ts')).toBe(true)
    expect(results.has('fail.ts')).toBe(false)
  })
})

// ===========================================================================
// abort
// ===========================================================================

describe('FetchQueue — abort', () => {
  it('rejects all queued entries with AbortError', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn, concurrency: 1 })

    // First fills the slot
    const p1 = queue.enqueue('active.ts', 'normal')
    // These are queued (not yet started)
    const p2 = queue.enqueue('queued1.ts', 'normal')
    const p3 = queue.enqueue('queued2.ts', 'normal')

    queue.abort()

    // Queued items should reject with AbortError
    await expect(p2).rejects.toThrow('Aborted')
    await expect(p3).rejects.toThrow('Aborted')

    // Resolve the in-flight one — result is discarded after abort
    pending.get('active.ts')!.resolve('done')
    await expect(p1).rejects.toThrow('Aborted')
  })

  it('rejects new enqueue calls after abort', async () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    queue.abort()

    await expect(queue.enqueue('new.ts', 'normal')).rejects.toThrow('Aborted')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('is idempotent — calling abort twice does not throw', () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    expect(() => {
      queue.abort()
      queue.abort()
    }).not.toThrow()
  })

  it('responds to external AbortSignal', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const controller = new AbortController()
    const queue = new FetchQueue({ fetchFn, signal: controller.signal, concurrency: 1 })

    // Start a fetch that will block
    const p = queue.enqueue('file.ts', 'normal')

    // Abort via signal
    controller.abort()

    // New enqueue should reject
    await expect(queue.enqueue('new.ts', 'normal')).rejects.toThrow('Aborted')

    // Resolve the in-flight fetch — it should reject because queue is aborted
    pending.get('file.ts')!.resolve('done')
    await expect(p).rejects.toThrow('Aborted')
  })

  it('initializes as aborted when signal is already aborted', async () => {
    const fetchFn = createMockFetchFn()
    const controller = new AbortController()
    controller.abort()
    const queue = new FetchQueue({ fetchFn, signal: controller.signal })

    await expect(queue.enqueue('file.ts', 'normal')).rejects.toThrow('Aborted')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// onProgress callback
// ===========================================================================

describe('FetchQueue — onProgress', () => {
  it('fires after each completed fetch', async () => {
    const onProgress = vi.fn()
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn, onProgress })

    await queue.enqueue('a.ts', 'normal')

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ completed: 1 }),
    )
  })

  it('fires after failed fetches too', async () => {
    const onProgress = vi.fn()
    const fetchFn = vi.fn().mockRejectedValue(new Error('fail'))
    const queue = new FetchQueue({ fetchFn, onProgress })

    await queue.enqueue('fail.ts', 'normal').catch(() => {})

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1 }),
    )
  })

  it('provides accurate cumulative stats', async () => {
    const progressHistory: FetchQueueStats[] = []
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({
      fetchFn,
      onProgress: (stats) => progressHistory.push({ ...stats }),
    })

    await queue.enqueue('a.ts', 'normal')
    await queue.enqueue('b.ts', 'normal')
    await queue.enqueue('c.ts', 'normal')

    expect(progressHistory).toHaveLength(3)
    expect(progressHistory[0].completed).toBe(1)
    expect(progressHistory[1].completed).toBe(2)
    expect(progressHistory[2].completed).toBe(3)
  })
})

// ===========================================================================
// stats property
// ===========================================================================

describe('FetchQueue — stats', () => {
  it('starts at all zeros', () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    expect(queue.stats).toEqual({ completed: 0, pending: 0, failed: 0, total: 0 })
  })

  it('reflects completed count after fetches', async () => {
    const fetchFn = createMockFetchFn()
    const queue = new FetchQueue({ fetchFn })

    await queue.enqueue('a.ts', 'normal')
    await queue.enqueue('b.ts', 'normal')

    expect(queue.stats.completed).toBe(2)
    expect(queue.stats.pending).toBe(0)
    expect(queue.stats.total).toBe(2)
  })

  it('reflects pending count during fetches', async () => {
    const { fetchFn, pending } = createBlockingFetchFn()
    const queue = new FetchQueue({ fetchFn, concurrency: 1 })

    queue.enqueue('a.ts', 'normal')
    queue.enqueue('b.ts', 'normal')

    // a.ts is active (1 pending), b.ts is queued (1 pending)
    expect(queue.stats.pending).toBe(2)
    expect(queue.stats.completed).toBe(0)

    pending.get('a.ts')!.resolve('done')
    await vi.waitFor(() => expect(queue.stats.completed).toBe(1))

    expect(queue.stats.pending).toBe(1) // b.ts now active

    pending.get('b.ts')!.resolve('done')
    await vi.waitFor(() => expect(queue.stats.completed).toBe(2))
    expect(queue.stats.pending).toBe(0)
  })

  it('reflects failed count', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('fail'))
    const queue = new FetchQueue({ fetchFn })

    await queue.enqueue('fail.ts', 'normal').catch(() => {})

    expect(queue.stats.failed).toBe(1)
    expect(queue.stats.total).toBe(1)
  })
})
