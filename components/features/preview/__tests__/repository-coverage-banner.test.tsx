import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('RepositoryCoverageBanner', () => {
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
})
