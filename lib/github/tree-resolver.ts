import type {
  RepoTree,
  RepoTreeItem,
  ResolvedRepoTree,
  TreeResolutionReason,
} from '@/types/repository'

export const TREE_RESOLUTION_CONCURRENCY = 4
export const TREE_RESOLUTION_MAX_REQUESTS = 32
export const TREE_RESOLUTION_TIMEOUT_MS = 25_000
export const TREE_RESOLUTION_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const TREE_RESOLUTION_MAX_TOTAL_RESPONSE_BYTES = 32 * 1024 * 1024
export const TREE_RESOLUTION_MAX_ENTRIES = 500_000
export const TREE_RESOLUTION_MAX_PATH_BYTES = 4 * 1024
export const TREE_RESOLUTION_MAX_NORMALIZED_OUTPUT_BYTES = 64 * 1024 * 1024

const UTF8_ENCODER = new TextEncoder()

export interface TreeFetchRequest {
  sha: string
  recursive: boolean
  signal: AbortSignal
}

export type TreeFetchResult = RepoTree | { tree: RepoTree; bytes: number }

function isBoundedTreeResult(value: TreeFetchResult): value is { tree: RepoTree; bytes: number } {
  return 'bytes' in value && !Array.isArray(value.tree)
}

export interface ResolveTreeOptions {
  signal?: AbortSignal
  maxRequests?: number
  timeoutMs?: number
  maxResponseBytes?: number
  maxTotalResponseBytes?: number
  maxEntries?: number
  maxPathBytes?: number
  maxNormalizedOutputBytes?: number
  now?: () => number
}

interface PendingTree {
  sha: string
  prefix: string
}

interface TreeRequestResult {
  tree: RepoTree
  late: boolean
  bytes?: number
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function prefixedItem(item: RepoTreeItem, prefix: string): RepoTreeItem {
  return prefix ? { ...item, path: `${prefix}/${item.path}` } : item
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength
}

function normalizedItemBytes(item: RepoTreeItem): number {
  // Count the serialized representation so quotes, control characters, and
  // other JSON escapes cannot expand beyond the normalized-output budget.
  return utf8ByteLength(JSON.stringify(item)) + 1
}

export async function resolveRepoTree(
  rootSha: string,
  fetchTree: (request: TreeFetchRequest) => Promise<TreeFetchResult>,
  options: ResolveTreeOptions = {},
): Promise<ResolvedRepoTree> {
  const maxRequests = options.maxRequests ?? TREE_RESOLUTION_MAX_REQUESTS
  const timeoutMs = options.timeoutMs ?? TREE_RESOLUTION_TIMEOUT_MS
  const maxTotalResponseBytes = options.maxTotalResponseBytes ?? TREE_RESOLUTION_MAX_TOTAL_RESPONSE_BYTES
  const maxEntries = options.maxEntries ?? TREE_RESOLUTION_MAX_ENTRIES
  const maxPathBytes = options.maxPathBytes ?? TREE_RESOLUTION_MAX_PATH_BYTES
  const maxNormalizedOutputBytes = options.maxNormalizedOutputBytes ?? TREE_RESOLUTION_MAX_NORMALIZED_OUTPUT_BYTES
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  const entries = new Map<string, RepoTreeItem>()
  const failedSubtrees = new Set<string>()
  const reasons = new Set<TreeResolutionReason>()
  const failureDetails: Array<{ path: string; reason: TreeResolutionReason; message: string }> = []
  let requestCount = 0
  let resolvedSha = rootSha
  let totalResponseBytes = 0
  let normalizedOutputBytes = 0
  let limitHit = false
  const activeControllers = new Set<AbortController>()
  const rejectLimitWaiters = new Set<() => void>()
  const normalizedEntryBytes = new Map<string, number>()

  const markLimit = (path: string, message: string) => {
    if (limitHit) return
    limitHit = true
    reasons.add('limit-exceeded')
    if (!failureDetails.some(detail => detail.path === path && detail.reason === 'limit-exceeded')) {
      failureDetails.push({ path, reason: 'limit-exceeded', message })
    }
    failedSubtrees.add(path)
    for (const controller of activeControllers) controller.abort(new DOMException('Tree resource limit exceeded', 'AbortError'))
    for (const reject of rejectLimitWaiters) reject()
  }

  const merge = (tree: RepoTree, prefix = '') => {
    const prefixBytes = utf8ByteLength(prefix)
    for (const item of tree.tree) {
      if (
        typeof item.path !== 'string'
        || typeof item.mode !== 'string'
        || typeof item.type !== 'string'
        || typeof item.sha !== 'string'
        || (item.size !== undefined && typeof item.size !== 'number')
        || (item.url !== undefined && typeof item.url !== 'string')
      ) {
        markLimit(prefix || '.', 'Tree entry contained unsupported data')
        return
      }
      const itemPathBytes = utf8ByteLength(item.path)
      const normalizedPathBytes = prefix ? prefixBytes + 1 + itemPathBytes : itemPathBytes
      if (normalizedPathBytes > maxPathBytes) {
        markLimit(prefix || '.', `Tree path budget of ${maxPathBytes} UTF-8 bytes was exhausted`)
        return
      }
      const prefixed = prefixedItem(item, prefix)
      if (!entries.has(prefixed.path) && entries.size >= maxEntries) {
        markLimit(prefix || '.', `Tree entry budget of ${maxEntries} was exhausted`)
        return
      }
      const replacementBytes = normalizedItemBytes(prefixed)
      const previousBytes = normalizedEntryBytes.get(prefixed.path) ?? 0
      if (normalizedOutputBytes - previousBytes + replacementBytes > maxNormalizedOutputBytes) {
        markLimit(prefix || '.', `Tree normalized output budget of ${maxNormalizedOutputBytes} bytes was exhausted`)
        return
      }
      entries.set(prefixed.path, prefixed)
      normalizedEntryBytes.set(prefixed.path, replacementBytes)
      normalizedOutputBytes = normalizedOutputBytes - previousBytes + replacementBytes
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
    if (limitHit) return null
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
    activeControllers.add(requestController)
    const deadlineMarker = Symbol('tree-resolution-deadline')
    const callerAbortMarker = Symbol('tree-resolution-caller-abort')
    const limitMarker = Symbol('tree-resolution-limit')
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let onCallerAbort: (() => void) | undefined
    let rejectLimit: (() => void) | undefined
    const limitBoundary = new Promise<never>((_, reject) => {
      rejectLimit = () => reject(limitMarker)
      rejectLimitWaiters.add(rejectLimit)
    })
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
      const fetched = await Promise.race<TreeFetchResult>([
        fetchTree({ sha, recursive, signal: requestController.signal }),
        boundary,
        limitBoundary,
      ])
      if (limitHit) return null
      const wrapped = isBoundedTreeResult(fetched)
      const tree = wrapped ? fetched.tree : fetched
      const bytes = wrapped ? fetched.bytes : undefined
      if (bytes !== undefined) {
        const maxResponseBytes = options.maxResponseBytes ?? TREE_RESOLUTION_MAX_RESPONSE_BYTES
        if (bytes > maxResponseBytes) {
          markLimit(path, `Tree response exceeded ${maxResponseBytes} bytes`)
          return null
        }
        if (totalResponseBytes + bytes > maxTotalResponseBytes) {
          markLimit(path, `Tree response byte budget of ${maxTotalResponseBytes} was exhausted`)
          return null
        }
        totalResponseBytes += bytes
      }
      const late = now() >= deadline
      if (late) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      }
      return { tree, late, bytes }
    } catch (error) {
      if (error === callerAbortMarker || options.signal?.aborted) throw abortError(options.signal!)
      if (error === limitMarker || limitHit) return null
      if (error === deadlineMarker || now() >= deadline) {
        addFailure(path, 'time-budget-exceeded', `Tree resolution exceeded ${timeoutMs}ms`)
      } else if (error instanceof Error && error.name === 'ResponseBodyTooLargeError') {
        markLimit(path, 'Tree response exceeded the per-response byte ceiling')
      } else {
        addFailure(path, 'fetch-failed', error instanceof Error ? error.message : 'Tree request failed')
      }
      return null
    } finally {
      if (rejectLimit) rejectLimitWaiters.delete(rejectLimit)
      activeControllers.delete(requestController)
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
  if (limitHit) return partialResult()
  if (initialResult.late) {
    failedSubtrees.add('.')
    return partialResult()
  }
  if (!initial.truncated && !limitHit) {
    return {
      status: 'complete',
      sha: initial.sha,
      tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
      truncated: false,
      requestCount,
    }
  }

  const shallowRootResult = limitHit ? null : await request(initial.sha, false, '.')
  if (!shallowRootResult) {
    failedSubtrees.add('.')
  } else {
    const shallowRoot = shallowRootResult.tree
    merge(shallowRoot)
    if (limitHit) return partialResult()
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

    while (queue.length > 0 && !limitHit) {
      const batch = queue.splice(0, TREE_RESOLUTION_CONCURRENCY)
      await Promise.all(batch.map(async (task) => {
        if (limitHit) return
        const recursiveResult = await request(task.sha, true, task.prefix)
        if (!recursiveResult) {
          failedSubtrees.add(task.prefix)
          return
        }
        const recursiveTree = recursiveResult.tree
        merge(recursiveTree, task.prefix)
        if (limitHit) return
        if (recursiveResult.late) {
          failedSubtrees.add(task.prefix)
          return
        }
        if (!recursiveTree.truncated) return

        const shallowResult = limitHit ? null : await request(task.sha, false, task.prefix)
        if (!shallowResult) {
          failedSubtrees.add(task.prefix)
          return
        }
        const shallowTree = shallowResult.tree
        merge(shallowTree, task.prefix)
        if (limitHit) return
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
  if (!limitHit && failedSubtrees.size === 0 && reasons.size === 0) {
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
