import type {
  RepoTree,
  RepoTreeItem,
  ResolvedRepoTree,
  TreeResolutionReason,
} from '@/types/repository'

export const TREE_RESOLUTION_CONCURRENCY = 4
export const TREE_RESOLUTION_MAX_REQUESTS = 32
export const TREE_RESOLUTION_TIMEOUT_MS = 25_000

export interface TreeFetchRequest {
  sha: string
  recursive: boolean
  signal: AbortSignal
}

export interface ResolveTreeOptions {
  signal?: AbortSignal
  maxRequests?: number
  timeoutMs?: number
  now?: () => number
}

interface PendingTree {
  sha: string
  prefix: string
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function prefixedItem(item: RepoTreeItem, prefix: string): RepoTreeItem {
  return prefix ? { ...item, path: `${prefix}/${item.path}` } : item
}

export async function resolveRepoTree(
  rootSha: string,
  fetchTree: (request: TreeFetchRequest) => Promise<RepoTree>,
  options: ResolveTreeOptions = {},
): Promise<ResolvedRepoTree> {
  const maxRequests = options.maxRequests ?? TREE_RESOLUTION_MAX_REQUESTS
  const timeoutMs = options.timeoutMs ?? TREE_RESOLUTION_TIMEOUT_MS
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  const entries = new Map<string, RepoTreeItem>()
  const failedSubtrees = new Set<string>()
  const reasons = new Set<TreeResolutionReason>()
  const failureDetails: Array<{ path: string; reason: TreeResolutionReason; message: string }> = []
  let requestCount = 0
  let resolvedSha = rootSha

  const merge = (tree: RepoTree, prefix = '') => {
    for (const item of tree.tree) {
      const prefixed = prefixedItem(item, prefix)
      entries.set(prefixed.path, prefixed)
    }
  }

  const addFailure = (path: string, reason: TreeResolutionReason, message: string) => {
    reasons.add(reason)
    if (!failureDetails.some(detail => detail.path === path && detail.reason === reason)) {
      failureDetails.push({ path, reason, message })
    }
  }

  const request = async (sha: string, recursive: boolean, path: string): Promise<RepoTree | null> => {
    if (options.signal?.aborted) throw abortError(options.signal)
    if (requestCount >= maxRequests) {
      addFailure(path, 'request-budget-exceeded', `Tree request budget of ${maxRequests} was exhausted`)
      return null
    }
    const remaining = deadline - now()
    if (remaining <= 0) {
      addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      return null
    }
    requestCount++
    const timeoutSignal = AbortSignal.timeout(remaining)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal
    try {
      const tree = await fetchTree({ sha, recursive, signal })
      if (now() >= deadline) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      }
      return tree
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal)
      if (timeoutSignal.aborted || now() >= deadline) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      } else {
        addFailure(path, 'fetch-failed', error instanceof Error ? error.message : 'Tree request failed')
      }
      return null
    }
  }

  const initial = await request(rootSha, true, '.')
  if (!initial) {
    failedSubtrees.add('.')
    return {
      status: 'partial',
      sha: resolvedSha,
      tree: [],
      truncated: true,
      reasons: [...reasons],
      failureDetails,
      failedSubtrees: [...failedSubtrees],
      requestCount,
    }
  }
  resolvedSha = initial.sha
  merge(initial)
  if (!initial.truncated) {
    if (reasons.has('time-budget-exceeded')) {
      failedSubtrees.add('.')
      return {
        status: 'partial',
        sha: initial.sha,
        tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
        truncated: true,
        reasons: [...reasons],
        failureDetails,
        failedSubtrees: ['.'],
        requestCount,
      }
    }
    return {
      status: 'complete',
      sha: initial.sha,
      tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
      truncated: false,
      requestCount,
    }
  }

  const shallowRoot = await request(initial.sha, false, '.')
  if (!shallowRoot) {
    failedSubtrees.add('.')
  } else {
    merge(shallowRoot)
    if (shallowRoot.truncated) {
      addFailure('.', 'truncated', 'The shallow root tree response was truncated')
      failedSubtrees.add('.')
    }
    const queue: PendingTree[] = shallowRoot.tree
      .filter((item) => item.type === 'tree')
      .map((item) => ({ sha: item.sha, prefix: item.path }))

    while (queue.length > 0) {
      const batch = queue.splice(0, TREE_RESOLUTION_CONCURRENCY)
      await Promise.all(batch.map(async (task) => {
        const recursiveTree = await request(task.sha, true, task.prefix)
        if (!recursiveTree) {
          failedSubtrees.add(task.prefix)
          return
        }
        merge(recursiveTree, task.prefix)
        if (!recursiveTree.truncated) return

        const shallowTree = await request(task.sha, false, task.prefix)
        if (!shallowTree) {
          failedSubtrees.add(task.prefix)
          return
        }
        merge(shallowTree, task.prefix)
        if (shallowTree.truncated) {
          addFailure(task.prefix, 'truncated', 'The shallow subtree response was truncated')
          failedSubtrees.add(task.prefix)
        }
        for (const child of shallowTree.tree) {
          if (child.type === 'tree') {
            queue.push({ sha: child.sha, prefix: `${task.prefix}/${child.path}` })
          }
        }
      }))
    }
  }

  const sortedTree = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
  if (failedSubtrees.size === 0 && reasons.size === 0) {
    return {
      status: 'complete',
      sha: resolvedSha,
      tree: sortedTree,
      truncated: false,
      requestCount,
    }
  }
  for (const path of failedSubtrees) {
    addFailure(path, 'truncated', 'A truncated tree could not be fully resolved')
  }
  return {
    status: 'partial',
    sha: resolvedSha,
    tree: sortedTree,
    truncated: true,
    reasons: [...reasons],
    failureDetails,
    failedSubtrees: [...failedSubtrees].sort(),
    requestCount,
  }
}
