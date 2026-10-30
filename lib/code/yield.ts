// Cooperative yielding for long main-thread loops (analysis, symbol extraction, AI tools).

interface YieldingScheduler {
  yield?: () => Promise<void>
}

/**
 * Let the browser handle input and paint before the next slice of work.
 *
 * Prefers `scheduler.yield()` (continuation keeps its priority) and falls back to
 * a MessageChannel macrotask. Not setTimeout(0): browsers clamp nested timers to
 * 4 ms, which adds seconds of idle latency to a loop that yields thousands of times.
 */
export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  if (typeof MessageChannel === 'function') {
    return new Promise(resolve => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  }
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Throw the signal's reason (or a DOMException AbortError) when it is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}
