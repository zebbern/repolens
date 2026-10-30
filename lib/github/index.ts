export {
  fetchRepoViaProxy,
  fetchTreeViaProxy,
  fetchFileViaProxy,
  setGitHubOAuthPrincipal,
  getGitHubCredentialPrincipal,
  clearGitHubCache,
  invalidateRepoCache,
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
  isFileIndexable,
  INDEXABLE_EXTENSIONS,
} from './zipball'

export { fetchWithConcurrency } from './fetch-utils'

export { startIndexing } from './indexing-pipeline'
