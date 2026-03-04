import { useCallback } from 'react'
import type { SearchOptions } from '../types'

interface SearchState {
  searchQuery: string
  debouncedSearchQuery: string
  replaceQuery: string
  showReplace: boolean
  fileFilter: string
  searchOptions: SearchOptions
}

/**
 * Derives stable setter callbacks from a `searchState` + `setSearchState`
 * pair so the code-browser component doesn't have to inline six useCallbacks.
 */
export function useSearchStateDispatchers(
  searchState: SearchState,
  setSearchState: React.Dispatch<React.SetStateAction<SearchState>>,
) {
  const setSearchQuery = useCallback(
    (v: string) => setSearchState(prev => ({ ...prev, searchQuery: v })),
    [setSearchState],
  )
  const setDebouncedSearchQuery = useCallback(
    (v: string) => setSearchState(prev => ({ ...prev, debouncedSearchQuery: v })),
    [setSearchState],
  )
  const setReplaceQuery = useCallback(
    (v: string) => setSearchState(prev => ({ ...prev, replaceQuery: v })),
    [setSearchState],
  )
  const setShowReplace = useCallback(
    (v: boolean | ((p: boolean) => boolean)) => {
      setSearchState(prev => ({
        ...prev,
        showReplace: typeof v === 'function' ? v(prev.showReplace) : v,
      }))
    },
    [setSearchState],
  )
  const setFileFilter = useCallback(
    (v: string) => setSearchState(prev => ({ ...prev, fileFilter: v })),
    [setSearchState],
  )
  const setSearchOptions = useCallback(
    (v: SearchOptions | ((p: SearchOptions) => SearchOptions)) => {
      setSearchState(prev => ({
        ...prev,
        searchOptions: typeof v === 'function' ? v(prev.searchOptions) : v,
      }))
    },
    [setSearchState],
  )

  return {
    searchQuery: searchState.searchQuery,
    debouncedSearchQuery: searchState.debouncedSearchQuery,
    replaceQuery: searchState.replaceQuery,
    showReplace: searchState.showReplace,
    fileFilter: searchState.fileFilter,
    searchOptions: searchState.searchOptions,
    setSearchQuery,
    setDebouncedSearchQuery,
    setReplaceQuery,
    setShowReplace,
    setFileFilter,
    setSearchOptions,
  }
}
