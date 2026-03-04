export {
  fetchRepoViaProxy,
  fetchTreeViaProxy,
  fetchFileViaProxy,
  fetchRateLimitViaProxy,
} from './client'

export {
  fetchRepoMetadata,
  fetchRepoTree,
  fetchFileContent,
  buildFileTree,
  detectLanguage,
  buildFileTreeString,
  filterCodeFiles,
} from './fetcher'

export {
  parseGitHubUrl,
  isValidGitHubUrl,
  buildRepoApiUrl,
  buildContentsApiUrl,
  buildTreeApiUrl,
  buildRawContentUrl,
} from './parser'
export type { ParsedGitHubUrl } from './parser'

export {
  fetchRepoZipball,
  isFileIndexable,
  INDEXABLE_EXTENSIONS,
} from './zipball'

export { fetchWithConcurrency } from './fetch-utils'

export { startIndexing } from './indexing-pipeline'
