import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PRMetadata } from '@/types/pr-review'
import { PRSelector } from './pr-selector'

const pr: PRMetadata = { number: 1, title: 'Improve docs', body: null, state: 'open', author: 'alice', authorAvatarUrl: null, createdAt: '2025-01-01', updatedAt: '2025-01-01', mergedAt: null, headRef: 'feature', baseRef: 'main', headSha: 'head', baseSha: 'base', additions: 1, deletions: 0, changedFiles: 1, url: '', isDraft: false, labels: ['one', 'two', 'three', 'four', 'five'] }

describe('PRSelector label disclosure', () => {
  it('expands labels without selecting the PR by pointer or keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PRSelector pulls={[pr]} isLoading={false} onSelect={onSelect} onLoadPulls={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Select pull request #1: Improve docs' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View 2 more labels for pull request #1' }))
    expect(screen.getByText('four')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer labels for pull request #1' }))
    expect(screen.queryByText('four')).not.toBeInTheDocument()

    const disclosure = screen.getByRole('button', { name: 'View 2 more labels for pull request #1' })
    disclosure.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('four')).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.queryByText('four')).not.toBeInTheDocument()

    expect(onSelect).not.toHaveBeenCalled()
  })
})
