import { describe, expect, it, vi } from 'vitest'
import type { RepoTree } from '@/types/repository'
import { resolveRepoTree } from '../tree-resolver'

const blob = (path: string, sha = path): RepoTree['tree'][number] => ({ path, sha, mode: '100644', type: 'blob', size: 1 })
const dir = (path: string, sha = path): RepoTree['tree'][number] => ({ path, sha, mode: '040000', type: 'tree' })
const tree = (sha: string, items: RepoTree['tree'], truncated = false): RepoTree => ({ sha, tree: items, truncated })

describe('resolveRepoTree', () => {
  it('returns the recursive root directly when complete', async () => {
    const fetchTree = vi.fn().mockResolvedValue(tree('root', [blob('b'), blob('a')]))
    await expect(resolveRepoTree('main', fetchTree)).resolves.toMatchObject({
      status: 'complete', requestCount: 1, truncated: false,
      tree: [{ path: 'a' }, { path: 'b' }],
    })
  })

  it('splits only truncated children, prefixes and deduplicates entries', async () => {
    const fetchTree = vi.fn(async ({ sha, recursive }: { sha: string; recursive: boolean }) => {
      if (sha === 'main' && recursive) return tree('root', [blob('src/a.ts', 'a')], true)
      if (sha === 'root' && !recursive) return tree('root', [dir('src', 'src'), dir('docs', 'docs')])
      if (sha === 'src' && recursive) return tree('src', [blob('a.ts', 'a'), dir('deep', 'deep')], true)
      if (sha === 'src' && !recursive) return tree('src', [blob('a.ts', 'a'), dir('deep', 'deep')])
      if (sha === 'docs' && recursive) return tree('docs', [blob('readme.md', 'readme')])
      if (sha === 'deep' && recursive) return tree('deep', [blob('b.ts', 'b')])
      throw new Error(`unexpected ${sha} ${recursive}`)
    })

    const result = await resolveRepoTree('main', fetchTree)
    expect(result).toMatchObject({ status: 'complete', requestCount: 6 })
    expect(result.tree.map(item => item.path)).toEqual([
      'docs', 'docs/readme.md', 'src', 'src/a.ts', 'src/deep', 'src/deep/b.ts',
    ])
    expect(fetchTree).not.toHaveBeenCalledWith(expect.objectContaining({ sha: 'docs', recursive: false }))
  })

  it('caps requests including the initial request and reports unresolved subtrees', async () => {
    const fetchTree = vi.fn(async ({ sha, recursive }: { sha: string; recursive: boolean }) => {
      if (recursive) return tree(sha, [blob('known.ts')], true)
      return tree(sha, [dir('next', `${sha}-next`)])
    })
    const result = await resolveRepoTree('root', fetchTree, { maxRequests: 5 })
    expect(result.status).toBe('partial')
    expect(result.requestCount).toBe(5)
    if (result.status === 'partial') {
      expect(result.reasons).toEqual(['request-budget-exceeded'])
      expect(result.failureDetails.every(detail => detail.reason === 'request-budget-exceeded')).toBe(true)
      expect(result.failedSubtrees.length).toBeGreaterThan(0)
    }
  })

  it('does not relabel a pure child fetch failure as truncation', async () => {
    const fetchTree = vi.fn(async ({ sha, recursive }: { sha: string; recursive: boolean }) => {
      if (sha === 'root' && recursive) return tree('root-sha', [], true)
      if (sha === 'root-sha' && !recursive) return tree('root-sha', [dir('src', 'src')])
      throw new Error('child unavailable')
    })

    const result = await resolveRepoTree('root', fetchTree)
    expect(result).toMatchObject({ status: 'partial', reasons: ['fetch-failed'], failedSubtrees: ['src'] })
    if (result.status === 'partial') {
      expect(result.failureDetails).toEqual([
        { path: 'src', reason: 'fetch-failed', message: 'child unavailable' },
      ])
    }
  })

  it('never promotes a truncated shallow response to complete', async () => {
    const fetchTree = vi.fn()
      .mockResolvedValueOnce(tree('root', [blob('known.ts')], true))
      .mockResolvedValueOnce(tree('root', [blob('known.ts')], true))
    const result = await resolveRepoTree('root', fetchTree)
    expect(result).toMatchObject({
      status: 'partial',
      failedSubtrees: ['.'],
      reasons: expect.arrayContaining(['truncated']),
    })
  })

  it('never exceeds four concurrent upstream requests', async () => {
    let active = 0
    let maxActive = 0
    const fetchTree = vi.fn(async ({ sha, recursive }: { sha: string; recursive: boolean }) => {
      if (sha === 'root' && recursive) return tree('root-sha', [], true)
      if (sha === 'root-sha' && !recursive) {
        return tree('root-sha', Array.from({ length: 8 }, (_, index) => dir(`d${index}`, `d${index}`)))
      }
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active--
      return tree(sha, [blob('file.ts')])
    })

    const result = await resolveRepoTree('root', fetchTree)
    expect(result.status).toBe('complete')
    expect(maxActive).toBe(4)
  })

  it('returns discovered partial entries when the wall budget expires', async () => {
    let clock = 0
    const fetchTree = vi.fn(async () => {
      clock = 26
      return tree('root', [blob('known.ts')], true)
    })
    const result = await resolveRepoTree('root', fetchTree, { timeoutMs: 25, now: () => clock })
    expect(result).toMatchObject({
      status: 'partial',
      requestCount: 1,
      reasons: expect.arrayContaining(['time-budget-exceeded']),
      failedSubtrees: ['.'],
      tree: [expect.objectContaining({ path: 'known.ts' })],
    })
  })

  it('does not report complete when an otherwise complete response arrives after the wall budget', async () => {
    let clock = 0
    const fetchTree = vi.fn(async () => {
      clock = 26
      return tree('root', [blob('known.ts')])
    })

    await expect(resolveRepoTree('root', fetchTree, { timeoutMs: 25, now: () => clock })).resolves.toMatchObject({
      status: 'partial',
      requestCount: 1,
      reasons: expect.arrayContaining(['time-budget-exceeded']),
      failedSubtrees: ['.'],
      tree: [expect.objectContaining({ path: 'known.ts' })],
    })
  })

  it('marks the correctly prefixed child failed when its response arrives after the deadline', async () => {
    let clock = 0
    const fetchTree = vi.fn(async ({ sha, recursive }: { sha: string; recursive: boolean }) => {
      if (sha === 'root' && recursive) return tree('root-sha', [], true)
      if (sha === 'root-sha' && !recursive) return tree('root-sha', [dir('src', 'src')])
      clock = 26
      return tree('src', [blob('late.ts')])
    })

    const result = await resolveRepoTree('root', fetchTree, { timeoutMs: 25, now: () => clock })
    expect(result).toMatchObject({
      status: 'partial',
      reasons: ['time-budget-exceeded'],
      failedSubtrees: ['src'],
      tree: expect.arrayContaining([expect.objectContaining({ path: 'src/late.ts' })]),
    })
  })

  it('enforces the wall deadline when an upstream fetch ignores AbortSignal', async () => {
    vi.useFakeTimers()
    try {
      const pending = resolveRepoTree('root', () => new Promise<RepoTree>(() => {}), { timeoutMs: 25 })
      await vi.advanceTimersByTimeAsync(25)
      await expect(pending).resolves.toMatchObject({
        status: 'partial',
        requestCount: 1,
        reasons: ['time-budget-exceeded'],
        failedSubtrees: ['.'],
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves caller AbortError semantics and clears the deadline timer', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const pending = resolveRepoTree(
        'root',
        () => new Promise<RepoTree>(() => {}),
        { signal: controller.signal, timeoutMs: 25_000 },
      )
      controller.abort(new DOMException('cancelled by caller', 'AbortError'))

      await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled by caller' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('propagates caller aborts instead of synthesizing a partial result', async () => {
    const controller = new AbortController()
    const fetchTree = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(resolveRepoTree('root', fetchTree, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
