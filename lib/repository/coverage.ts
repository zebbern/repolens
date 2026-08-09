import type { RepositoryCoverage, ResolvedRepoTree } from '@/types/repository'
import { LAZY_CONTENT_THRESHOLD_KB } from '@/config/constants'
import { isFileIndexable } from '@/lib/github/zipball'

export const COVERAGE_SAMPLE_LIMIT = 100

export function createRepositoryCoverage(
  tree: ResolvedRepoTree,
  repoSizeKb?: number,
): RepositoryCoverage {
  const discovered = tree.tree.filter(item => (
    item.type === 'blob' && isFileIndexable(item.path, item.size ?? 0)
  )).length
  const failedSubtrees = tree.status === 'partial' ? tree.failedSubtrees : []
  return {
    treeStatus: tree.status,
    supportedFiles: { discovered, loaded: 0 },
    failures: { count: 0, samples: [] },
    failedSubtrees: {
      count: failedSubtrees.length,
      samples: failedSubtrees.slice(0, COVERAGE_SAMPLE_LIMIT),
    },
    mode: repoSizeKb != null && repoSizeKb >= LAZY_CONTENT_THRESHOLD_KB ? 'on-demand' : 'full',
  }
}

export function updateRepositoryCoverage(
  coverage: RepositoryCoverage,
  discovered: number,
  loaded: number,
  failures: Array<{ path: string; error: string }>,
): RepositoryCoverage {
  return {
    ...coverage,
    supportedFiles: { discovered, loaded },
    failures: {
      count: failures.length,
      samples: failures.slice(0, COVERAGE_SAMPLE_LIMIT),
    },
  }
}

export function isCoverageComplete(coverage: RepositoryCoverage): boolean {
  return coverage.treeStatus === 'complete'
    && coverage.mode === 'full'
    && coverage.supportedFiles.loaded === coverage.supportedFiles.discovered
    && coverage.failures.count === 0
    && coverage.failedSubtrees.count === 0
}

export function coverageNotice(coverage: RepositoryCoverage | undefined): string | undefined {
  if (!coverage || isCoverageComplete(coverage)) return undefined
  return `Repository coverage is ${coverage.treeStatus === 'partial' ? 'partial' : coverage.mode === 'on-demand' ? 'on-demand' : 'incomplete'} (${coverage.supportedFiles.loaded}/${coverage.supportedFiles.discovered} supported files loaded; ${coverage.failures.count} file failures; ${coverage.failedSubtrees.count} failed subtrees). Do not imply repository-wide completeness.`
}
