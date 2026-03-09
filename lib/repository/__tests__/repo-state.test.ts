import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SEARCH_STATE,
  DEFAULT_INDEXING_PROGRESS,
  type LoadingStage,
  type SearchState,
  type IndexingProgress,
} from '@/lib/repository'

// ---------------------------------------------------------------------------
// LoadingStage type validation
// ---------------------------------------------------------------------------

describe('LoadingStage', () => {
  it('allows all valid stage values', () => {
    const stages: LoadingStage[] = [
      'idle',
      'metadata',
      'tree',
      'downloading',
      'extracting',
      'indexing',
      'lazy-indexing',
      'ready',
      'cached',
    ]
    // TypeScript ensures these are valid — runtime check confirms the array
    expect(stages).toHaveLength(9)
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_SEARCH_STATE
// ---------------------------------------------------------------------------

describe('DEFAULT_SEARCH_STATE', () => {
  it('has empty search query', () => {
    expect(DEFAULT_SEARCH_STATE.searchQuery).toBe('')
  })

  it('has empty debounced search query', () => {
    expect(DEFAULT_SEARCH_STATE.debouncedSearchQuery).toBe('')
  })

  it('has empty replace query', () => {
    expect(DEFAULT_SEARCH_STATE.replaceQuery).toBe('')
  })

  it('has showReplace set to false', () => {
    expect(DEFAULT_SEARCH_STATE.showReplace).toBe(false)
  })

  it('has empty file filter', () => {
    expect(DEFAULT_SEARCH_STATE.fileFilter).toBe('')
  })

  it('has all search options set to false', () => {
    expect(DEFAULT_SEARCH_STATE.searchOptions).toEqual({
      caseSensitive: false,
      regex: false,
      wholeWord: false,
    })
  })

  it('is a valid SearchState', () => {
    const state: SearchState = DEFAULT_SEARCH_STATE
    expect(state).toBeDefined()
    expect(typeof state.searchQuery).toBe('string')
    expect(typeof state.showReplace).toBe('boolean')
    expect(typeof state.searchOptions.caseSensitive).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_INDEXING_PROGRESS
// ---------------------------------------------------------------------------

describe('DEFAULT_INDEXING_PROGRESS', () => {
  it('has current set to 0', () => {
    expect(DEFAULT_INDEXING_PROGRESS.current).toBe(0)
  })

  it('has total set to 0', () => {
    expect(DEFAULT_INDEXING_PROGRESS.total).toBe(0)
  })

  it('has isComplete set to false', () => {
    expect(DEFAULT_INDEXING_PROGRESS.isComplete).toBe(false)
  })

  it('is a valid IndexingProgress', () => {
    const progress: IndexingProgress = DEFAULT_INDEXING_PROGRESS
    expect(progress).toBeDefined()
    expect(typeof progress.current).toBe('number')
    expect(typeof progress.total).toBe('number')
    expect(typeof progress.isComplete).toBe('boolean')
  })
})
