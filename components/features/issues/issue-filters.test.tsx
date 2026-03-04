import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FilterMode, FilteredSummary } from './issue-types'
import { IssueFilters } from './issue-filters'

function createSummary(overrides: Partial<FilteredSummary> = {}): FilteredSummary {
  return {
    total: 20,
    critical: 5,
    warning: 10,
    info: 5,
    bySecurity: 8,
    byBadPractice: 6,
    byReliability: 4,
    bySupplyChain: 1,
    byStructural: 1,
    ...overrides,
  }
}

function renderFilters(overrides: Partial<{
  filter: FilterMode
  filteredSummary: FilteredSummary
  hideInfo: boolean
  hideLowConfidence: boolean
  totalIssueCount: number
}> = {}) {
  const setFilter = vi.fn()
  const setHideInfo = vi.fn()
  const setHideLowConfidence = vi.fn()
  const props = {
    filter: 'all' as FilterMode,
    setFilter,
    filteredSummary: createSummary(),
    hideInfo: false,
    setHideInfo,
    hideLowConfidence: false,
    setHideLowConfidence,
    totalIssueCount: 20,
    ...overrides,
  }
  const result = render(<IssueFilters {...props} />)
  return { ...result, setFilter, setHideInfo, setHideLowConfidence }
}

describe('IssueFilters', () => {
  it('renders severity count buttons', () => {
    renderFilters({ filteredSummary: createSummary({ critical: 3, warning: 10, info: 7 }) })
    expect(screen.getByText('3')).toBeInTheDocument() // critical
    expect(screen.getByText('10')).toBeInTheDocument() // warning
    expect(screen.getByText('7')).toBeInTheDocument() // info
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Warnings')).toBeInTheDocument()
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('hides severity buttons with zero count', () => {
    renderFilters({ filteredSummary: createSummary({ critical: 0 }) })
    expect(screen.queryByText('Critical')).not.toBeInTheDocument()
    expect(screen.getByText('Warnings')).toBeInTheDocument()
  })

  it('renders "All" button with total count', () => {
    renderFilters()
    expect(screen.getByText('All (20)')).toBeInTheDocument()
  })

  it('renders category filter chips with counts', () => {
    renderFilters()
    expect(screen.getByText(/Security \(8\)/)).toBeInTheDocument()
    expect(screen.getByText(/Bad Practices \(6\)/)).toBeInTheDocument()
    expect(screen.getByText(/Reliability \(4\)/)).toBeInTheDocument()
    expect(screen.getByText(/Supply Chain \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Structural \(1\)/)).toBeInTheDocument()
  })

  it('hides category chips with zero count', () => {
    renderFilters({ filteredSummary: createSummary({ bySupplyChain: 0 }) })
    expect(screen.queryByText(/Supply Chain/)).not.toBeInTheDocument()
  })

  it('calls setFilter when critical severity is toggled', async () => {
    const user = userEvent.setup()
    const { setFilter } = renderFilters()

    await user.click(screen.getByText('Critical'))
    // setFilter receives a function updater
    expect(setFilter).toHaveBeenCalledTimes(1)
    const updater = setFilter.mock.calls[0][0] as (prev: FilterMode) => FilterMode
    expect(updater('all')).toBe('critical')
    expect(updater('critical')).toBe('all') // toggle back
  })

  it('calls setFilter when warning severity is toggled', async () => {
    const user = userEvent.setup()
    const { setFilter } = renderFilters()

    await user.click(screen.getByText('Warnings'))
    const updater = setFilter.mock.calls[0][0] as (prev: FilterMode) => FilterMode
    expect(updater('all')).toBe('warning')
    expect(updater('warning')).toBe('all')
  })

  it('calls setFilter with "all" when All chip is clicked', async () => {
    const user = userEvent.setup()
    const { setFilter } = renderFilters({ filter: 'critical' })

    await user.click(screen.getByText('All (20)'))
    expect(setFilter).toHaveBeenCalledWith('all')
  })

  it('calls setFilter when a category chip is toggled', async () => {
    const user = userEvent.setup()
    const { setFilter } = renderFilters()

    await user.click(screen.getByText(/Security \(8\)/))
    const updater = setFilter.mock.calls[0][0] as (prev: FilterMode) => FilterMode
    expect(updater('all')).toBe('security')
    expect(updater('security')).toBe('all')
  })

  it('sets aria-pressed on active filter', () => {
    renderFilters({ filter: 'critical' })
    const criticalBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Critical'),
    )
    expect(criticalBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders Show info checkbox checked by default', () => {
    renderFilters({ hideInfo: false })
    const checkbox = screen.getByLabelText('Show info')
    expect(checkbox).toBeChecked()
  })

  it('toggles hideInfo when Show info is clicked', async () => {
    const user = userEvent.setup()
    const { setHideInfo } = renderFilters({ hideInfo: false })

    await user.click(screen.getByLabelText('Show info'))
    expect(setHideInfo).toHaveBeenCalledTimes(1)
    const updater = setHideInfo.mock.calls[0][0] as (prev: boolean) => boolean
    expect(updater(false)).toBe(true)
  })

  it('renders Show low confidence checkbox checked by default', () => {
    renderFilters({ hideLowConfidence: false })
    const checkbox = screen.getByLabelText('Show low confidence')
    expect(checkbox).toBeChecked()
  })

  it('shows hidden count when filters reduce total', () => {
    renderFilters({
      hideInfo: true,
      filteredSummary: createSummary({ total: 15 }),
      totalIssueCount: 20,
    })
    expect(screen.getByText('5 hidden')).toBeInTheDocument()
  })

  it('does not show hidden count when all issues shown', () => {
    renderFilters({
      hideInfo: false,
      filteredSummary: createSummary({ total: 20 }),
      totalIssueCount: 20,
    })
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
  })
})
