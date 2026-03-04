/**
 * Generic concurrency-limited parallel task executor.
 *
 * Processes `items` by calling `fn(item)` with at most `limit` concurrent
 * promises in flight at any time.
 */
export async function fetchWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number,
): Promise<void> {
  const queue = [...items]
  const executing: Promise<void>[] = []

  while (queue.length > 0 || executing.length > 0) {
    while (executing.length < limit && queue.length > 0) {
      const item = queue.shift()!
      const promise = fn(item).then(() => {
        executing.splice(executing.indexOf(promise), 1)
      })
      executing.push(promise)
    }

    if (executing.length > 0) {
      await Promise.race(executing)
    }
  }
}
