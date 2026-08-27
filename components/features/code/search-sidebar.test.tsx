import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SearchSidebar, type SearchSidebarProps } from './search-sidebar'

function renderSidebar(overrides: Partial<SearchSidebarProps> = {}) {
  const props: SearchSidebarProps = {
    searchInputRef: createRef<HTMLInputElement>(),
    searchQuery: 'needle',
    setSearchQuery: vi.fn(),
    debouncedSearchQuery: 'needle',
    replaceQuery: '',
    setReplaceQuery: vi.fn(),
    showReplace: false,
    setShowReplace: vi.fn(),
    searchOptions: { caseSensitive: false, regex: false, wholeWord: false },
    setSearchOptions: vi.fn(),
    fileFilter: '',
    setFileFilter: vi.fn(),
    isIndexingComplete: true,
    indexingPercent: 100,
    resultsContainerRef: createRef<HTMLDivElement>(),
    searchResults: [],
    goToSearchResult: vi.fn(),
    visibleResultCount: 50,
    setVisibleResultCount: vi.fn(),
    totalMatchCount: 0,
    confirmReplaceAll: false,
    setConfirmReplaceAll: vi.fn(),
    replaceInFile: vi.fn(),
    replaceAllInFile: vi.fn(),
    replaceAllInAllFiles: vi.fn(),
    expandAllMatches: false,
    setExpandAllMatches: vi.fn(),
    ...overrides,
  }

  render(<SearchSidebar {...props} />)
}

describe('SearchSidebar coverage status', () => {
  it('shows unavailable and limit-skipped files even when there are no matches', () => {
    renderSidebar({
      unsearchedCount: 3,
      unavailableCount: 1,
      isSearchTruncated: true,
    })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Search results were truncated by search limits')
    expect(status).toHaveTextContent('2 files were not searched after the global match limit was reached')
    expect(status).toHaveTextContent('1 file was not searched because source content is unavailable')
  })

  it('shows a worker failure separately from partial coverage', () => {
    renderSidebar({ searchError: 'Worker unavailable' })

    expect(screen.getByRole('alert')).toHaveTextContent('Search failed: Worker unavailable')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a literal-fallback warning without reporting a search failure', () => {
    renderSidebar({ searchWarning: 'Unsafe regular expression was searched as literal text.' })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Unsafe regular expression was searched as literal text.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
