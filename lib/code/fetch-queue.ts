// Priority-based fetch queue for on-demand file content loading.
// Used by LazyContentStore for repos >200MB where content is loaded on demand.

export type FetchPriority = 'critical' | 'high' | 'normal' | 'low'

const PRIORITY_ORDER: Record<FetchPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export interface FetchQueueOptions {
  /** Async function that fetches file content by path. */
  fetchFn: (path: string) => Promise<string>
  /** Max concurrent fetches (default: 10). */
  concurrency?: number
  /** Called after each completed/failed fetch with current stats. */
  onProgress?: (stats: FetchQueueStats) => void
  /** External abort signal — aborts all queued fetches when triggered. */
  signal?: AbortSignal
  /** Timeout per individual fetch in ms (default: 15000). */
  perFetchTimeoutMs?: number
}

export interface FetchQueueStats {
  completed: number
  pending: number
  failed: number
  total: number
}

interface QueueEntry {
  path: string
  priority: number
  resolve: (content: string) => void
  reject: (error: Error) => void
}

/**
 * Concurrency-limited priority queue for fetching file content on demand.
 *
 * - **Priority**: critical(0) > high(1) > normal(2) > low(3), FIFO within same level
 * - **Dedup**: completed → return cached; in-flight → return existing Promise; else → enqueue
 * - **Abort**: rejects all queued entries; in-flight fetches complete but results are discarded
 */
export class FetchQueue {
  private readonly fetchFn: (path: string) => Promise<string>
  private readonly concurrency: number
  private readonly onProgressCb: ((stats: FetchQueueStats) => void) | null
  private readonly perFetchTimeoutMs: number

  private readonly queue: QueueEntry[] = []
  private readonly inflight = new Map<string, Promise<string>>()
  private readonly completed = new Map<string, string>()
  private readonly failedPaths = new Set<string>()
  private activeCount = 0
  private isAborted = false

  constructor(options: FetchQueueOptions) {
    this.fetchFn = options.fetchFn
    this.concurrency = options.concurrency ?? 10
    this.onProgressCb = options.onProgress ?? null
    this.perFetchTimeoutMs = options.perFetchTimeoutMs ?? 15_000

    if (options.signal) {
      if (options.signal.aborted) {
        this.isAborted = true
      } else {
        options.signal.addEventListener('abort', () => this.abort(), { once: true })
      }
    }
  }

  /**
   * Enqueue a file for fetching. Returns a promise that resolves with the file content.
   * If the file is already fetched, returns cached content immediately.
   * If the file is already in-flight, returns the existing promise (dedup).
   */
  enqueue(path: string, priority: FetchPriority): Promise<string> {
    const cached = this.completed.get(path)
    if (cached !== undefined) return Promise.resolve(cached)

    const existing = this.inflight.get(path)
    if (existing) return existing

    if (this.isAborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }

    const promise = new Promise<string>((resolve, reject) => {
      const entry: QueueEntry = {
        path,
        priority: PRIORITY_ORDER[priority],
        resolve,
        reject,
      }
      // Insert maintaining priority order (FIFO within same level)
      const insertIdx = this.queue.findIndex(e => e.priority > entry.priority)
      if (insertIdx === -1) {
        this.queue.push(entry)
      } else {
        this.queue.splice(insertIdx, 0, entry)
      }
    })

    this.inflight.set(path, promise)
    this.processQueue()
    return promise
  }

  /**
   * Enqueue multiple files for fetching. Returns a map of path → content
   * for all successfully fetched files. Individual failures are silently skipped.
   */
  async enqueueBatch(
    paths: string[],
    priority: FetchPriority,
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const promises = paths.map(async (path) => {
      try {
        const content = await this.enqueue(path, priority)
        results.set(path, content)
      } catch {
        // Individual failures don't fail the batch
      }
    })
    await Promise.all(promises)
    return results
  }

  /** Abort all pending fetches. In-flight fetches complete but results are discarded. */
  abort(): void {
    if (this.isAborted) return
    this.isAborted = true

    const queued = this.queue.splice(0)
    for (const entry of queued) {
      this.inflight.delete(entry.path)
      entry.reject(new DOMException('Aborted', 'AbortError'))
    }
  }

  /** Current queue statistics. */
  get stats(): FetchQueueStats {
    const completed = this.completed.size
    const pending = this.queue.length + this.activeCount
    const failed = this.failedPaths.size
    return { completed, pending, failed, total: completed + pending + failed }
  }

  private processQueue(): void {
    while (
      this.activeCount < this.concurrency &&
      this.queue.length > 0 &&
      !this.isAborted
    ) {
      const entry = this.queue.shift()!
      this.activeCount++
      this.executeFetch(entry)
    }
  }

  private async executeFetch(entry: QueueEntry): Promise<void> {
    try {
      const fetchPromise = this.fetchFn(entry.path)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Fetch timed out after ${this.perFetchTimeoutMs}ms: ${entry.path}`)), this.perFetchTimeoutMs)
      })
      const content = await Promise.race([fetchPromise, timeoutPromise])

      if (this.isAborted) {
        this.inflight.delete(entry.path)
        entry.reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      this.completed.set(entry.path, content)
      this.inflight.delete(entry.path)
      entry.resolve(content)
    } catch (err) {
      this.failedPaths.add(entry.path)
      this.inflight.delete(entry.path)
      entry.reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.activeCount--
      this.onProgressCb?.(this.stats)
      this.processQueue()
    }
  }
}
