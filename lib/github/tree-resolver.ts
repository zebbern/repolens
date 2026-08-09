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

interface TreeRequestResult {
  tree: RepoTree
  late: boolean
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

  const request = async (sha: string, recursive: boolean, path: string): Promise<TreeRequestResult | null> => {
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
    const requestController = new AbortController()
    const deadlineMarker = Symbol('tree-resolution-deadline')
    const callerAbortMarker = Symbol('tree-resolution-caller-abort')
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let onCallerAbort: (() => void) | undefined
    const boundary = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        requestController.abort(new DOMException('Tree resolution deadline exceeded', 'TimeoutError'))
        reject(deadlineMarker)
      }, remaining)
      if (options.signal) {
        onCallerAbort = () => {
          requestController.abort(options.signal?.reason)
          reject(callerAbortMarker)
        }
        options.signal.addEventListener('abort', onCallerAbort, { once: true })
      }
    })
    try {
      const tree = await Promise.race([
        fetchTree({ sha, recursive, signal: requestController.signal }),
        boundary,
      ])
      const late = now() >= deadline
      if (late) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      }
      return { tree, late }
    } catch (error) {
      if (error === callerAbortMarker || options.signal?.aborted) throw abortError(options.signal!)
      if (error === deadlineMarker || now() >= deadline) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      } else {
        addFailure(path, 'fetch-failed', error instanceof Error ? error.message : 'Tree request failed')
      }
      return null
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (options.signal && onCallerAbort) options.signal.removeEventListener('abort', onCallerAbort)
    }
  }

  const partialResult = (): ResolvedRepoTree => ({
    status: 'partial',
    sha: resolvedSha,
    tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
    truncated: true,
    reasons: [...reasons],
    failureDetails,
    failedSubtrees: [...failedSubtrees].sort(),
    requestCount,
  })

  const initialResult = await request(rootSha, true, '.')
  if (!initialResult) {
    failedSubtrees.add('.')
    return partialResult()
  }
  const initial = initialResult.tree
  resolvedSha = initial.sha
  merge(initial)
  if (initialResult.late) {
    failedSubtrees.add('.')
    return partialResult()
  }
  if (!initial.truncated) {
    return {
      status: 'complete',
      sha: initial.sha,
      tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
      truncated: false,
      requestCount,
    }
  }

  const shallowRootResult = await request(initial.sha, false, '.')
  if (!shallowRootResult) {
    failedSubtrees.add('.')
  } else {
    const shallowRoot = shallowRootResult.tree
    merge(shallowRoot)
    if (shallowRootResult.late) {
      failedSubtrees.add('.')
    } else if (shallowRoot.truncated) {
      addFailure('.', 'truncated', 'The shallow root tree response was truncated')
      failedSubtrees.add('.')
    }
    const queue: PendingTree[] = shallowRootResult.late
      ? []
      : shallowRoot.tree
        .filter((item) => item.type === 'tree')
        .map((item) => ({ sha: item.sha, prefix: item.path }))

    while (queue.length > 0) {
      const batch = queue.splice(0, TREE_RESOLUTION_CONCURRENCY)
      await Promise.all(batch.map(async (task) => {
        const recursiveResult = await request(task.sha, true, task.prefix)
        if (!recursiveResult) {
          failedSubtrees.add(task.prefix)
          return
        }
        const recursiveTree = recursiveResult.tree
        merge(recursiveTree, task.prefix)
        if (recursiveResult.late) {
          failedSubtrees.add(task.prefix)
          return
        }
        if (!recursiveTree.truncated) return

        const shallowResult = await request(task.sha, false, task.prefix)
        if (!shallowResult) {
          failedSubtrees.add(task.prefix)
          return
        }
        const shallowTree = shallowResult.tree
        merge(shallowTree, task.prefix)
        if (shallowResult.late) {
          failedSubtrees.add(task.prefix)
          return
        }
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
  return partialResult()
}
