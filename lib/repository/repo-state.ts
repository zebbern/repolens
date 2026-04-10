// ---------------------------------------------------------------------------
// Repository state types & defaults
// ---------------------------------------------------------------------------

/** Whether file content is fully available, metadata-only (lazy), or loading. */
export type ContentAvailability = 'full' | 'metadata-only'

/** Progress stats for on-demand content loading in lazy repos. */
export interface ContentLoadingStats {
  completed: number
  pending: number
  failed: number
  total: number
}

export const DEFAULT_CONTENT_LOADING_STATS: ContentLoadingStats = {
  completed: 0,
  pending: 0,
  failed: 0,
  total: 0,
}

export type LoadingStage =
  | 'idle'
  | 'metadata'
  | 'tree'
  | 'tree-ready'
  | 'downloading'
  | 'extracting'
  | 'indexing'
  | 'lazy-indexing'
  | 'ready'
  | 'cached'

export interface SearchState {
  searchQuery: string
  debouncedSearchQuery: string
  replaceQuery: string
  showReplace: boolean
  fileFilter: string
  searchOptions: {
    caseSensitive: boolean
    regex: boolean
    wholeWord: boolean
  }
}

export const DEFAULT_SEARCH_STATE: SearchState = {
  searchQuery: '',
  debouncedSearchQuery: '',
  replaceQuery: '',
  showReplace: false,
  fileFilter: '',
  searchOptions: {
    caseSensitive: false,
    regex: false,
    wholeWord: false,
  },
}
