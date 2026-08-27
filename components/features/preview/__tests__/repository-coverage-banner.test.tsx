import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepositoryCoverageBanner } from '../repository-coverage-banner'
import type { RepositoryCoverage } from '@/types/repository'

function partialCoverage(): RepositoryCoverage {
  return {
    treeStatus: 'partial',
    supportedFiles: { discovered: 250, loaded: 149 },
    failures: {
      count: 125,
      samples: Array.from({ length: 100 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        error: 'load failed',
      })),
    },
    failedSubtrees: {
      count: 103,
      samples: Array.from({ length: 100 }, (_, index) => `packages/subtree-${index}`),
    },
    mode: 'full',
  }
}

function completeCoverage(): RepositoryCoverage {
  return {
    treeStatus: 'complete',
    supportedFiles: { discovered: 12, loaded: 12 },
    failures: { count: 0, samples: [] },
    failedSubtrees: { count: 0, samples: [] },
    mode: 'full',
  }
}

describe('RepositoryCoverageBanner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-dismisses completed coverage after 10 seconds', () => {
    vi.useFakeTimers()
    render(<RepositoryCoverageBanner coverage={completeCoverage()} loadingStage="ready" repositoryKey="repo-a" />)

    expect(screen.getByRole('status')).toHaveTextContent('12 supported files indexed.')
    act(() => vi.advanceTimersByTime(9_999))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cancels auto-dismiss when the banner is interacted with and keeps Details usable', async () => {
    vi.useFakeTimers()
    render(<RepositoryCoverageBanner coverage={completeCoverage()} loadingStage="ready" repositoryKey="repo-a" />)

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    act(() => vi.advanceTimersByTime(10_000))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Repository coverage details' })).toBeInTheDocument()
  })

  it('treats pointer hover as interaction and keeps completed coverage visible', () => {
    vi.useFakeTimers()
    render(<RepositoryCoverageBanner coverage={completeCoverage()} loadingStage="ready" repositoryKey="repo-a" />)

    fireEvent.pointerEnter(screen.getByRole('status'))
    act(() => vi.advanceTimersByTime(10_000))

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('does not add success dismissal to non-complete states', () => {
    vi.useFakeTimers()
    render(<RepositoryCoverageBanner coverage={partialCoverage()} loadingStage="ready" repositoryKey="repo-a" />)

    expect(screen.queryByRole('button', { name: 'Dismiss repository coverage' })).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('resets dismissal for a newly connected repository', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <RepositoryCoverageBanner coverage={completeCoverage()} loadingStage="ready" repositoryKey="repo-a" />,
    )

    await user.click(screen.getByRole('button', { name: 'Dismiss repository coverage' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<RepositoryCoverageBanner coverage={completeCoverage()} loadingStage="ready" repositoryKey="repo-b" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('preserves full counts while limiting detail samples and explains partial discovery', async () => {
    const user = userEvent.setup()
    render(<RepositoryCoverageBanner coverage={partialCoverage()} loadingStage="ready" />)

    expect(screen.getByRole('status')).toHaveTextContent('Partial coverage — results may omit files.')
    await user.click(screen.getByRole('button', { name: 'Details' }))

    expect(screen.getByRole('dialog', { name: 'Repository coverage details' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'At least 250' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'File-load failures (125)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Failed subtrees (103)' })).toBeInTheDocument()
    expect(screen.getByText('Showing the first 100 failures.')).toBeInTheDocument()
    expect(screen.getByText('Showing the first 100 failed subtrees.')).toBeInTheDocument()
    expect(screen.getByText(/does not measure finding accuracy/i)).toBeInTheDocument()
  })

  it('reports on-demand content separately from loading progress', () => {
    render(
      <RepositoryCoverageBanner
        loadingStage="ready"
        coverage={{
          treeStatus: 'complete',
          supportedFiles: { discovered: 900, loaded: 12 },
          failures: { count: 0, samples: [] },
          failedSubtrees: { count: 0, samples: [] },
          mode: 'on-demand',
        }}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('On-demand content')
    expect(screen.getByRole('status')).toHaveTextContent('12 of 900 supported files loaded')
  })

  it('announces a terminal indexing failure instead of remaining in a loading state', () => {
    render(
      <RepositoryCoverageBanner
        loadingStage="tree-ready"
        error="ZIP extraction failed"
        coverage={{
          treeStatus: 'complete',
          supportedFiles: { discovered: 20, loaded: 7 },
          failures: { count: 0, samples: [] },
          failedSubtrees: { count: 0, samples: [] },
          mode: 'full',
        }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Repository content loading failed — coverage is incomplete.')
    expect(screen.queryByText(/Loading repository content/)).not.toBeInTheDocument()
  })
})
