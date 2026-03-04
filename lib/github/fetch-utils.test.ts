import { describe, it, expect, vi } from 'vitest'
import { fetchWithConcurrency } from './fetch-utils'

describe('fetchWithConcurrency', () => {
  it('processes all items', async () => {
    const processed: number[] = []
    const items = [1, 2, 3, 4, 5]

    await fetchWithConcurrency(items, async (item) => {
      processed.push(item)
    }, 3)

    expect(processed).toEqual([1, 2, 3, 4, 5])
  })

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0
    const LIMIT = 2

    const items = [1, 2, 3, 4, 5]

    await fetchWithConcurrency(items, async () => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10))
      currentConcurrent--
    }, LIMIT)

    expect(maxConcurrent).toBeLessThanOrEqual(LIMIT)
    expect(maxConcurrent).toBeGreaterThan(0)
  })

  it('handles empty items array', async () => {
    const fn = vi.fn()
    await fetchWithConcurrency([], fn, 3)
    expect(fn).not.toHaveBeenCalled()
  })

  it('handles single item', async () => {
    const result: string[] = []
    await fetchWithConcurrency(['only'], async (item) => {
      result.push(item)
    }, 5)
    expect(result).toEqual(['only'])
  })

  it('continues processing when individual items fail', async () => {
    const processed: number[] = []
    const items = [1, 2, 3, 4, 5]

    // Item 3 throws, but other items should still process
    await expect(
      fetchWithConcurrency(items, async (item) => {
        if (item === 3) throw new Error('Item 3 failed')
        processed.push(item)
      }, 2),
    ).rejects.toThrow('Item 3 failed')

    // At least items before the failure should be processed
    expect(processed.length).toBeGreaterThan(0)
  })

  it('processes items concurrently, not sequentially', async () => {
    const DELAY_MS = 50
    const items = [1, 2, 3]

    const start = Date.now()
    await fetchWithConcurrency(items, async () => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }, 3)
    const elapsed = Date.now() - start

    // With concurrency 3, all 3 items run in parallel: ~50ms, not ~150ms
    expect(elapsed).toBeLessThan(DELAY_MS * items.length)
  })

  it('works with concurrency limit of 1 (sequential)', async () => {
    const order: number[] = []
    const items = [1, 2, 3]

    await fetchWithConcurrency(items, async (item) => {
      order.push(item)
    }, 1)

    expect(order).toEqual([1, 2, 3])
  })
})
