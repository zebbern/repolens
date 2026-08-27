import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubRepo } from '@/types/repository'
import { PreviewRepoHeader } from '../preview-repo-header'

const repo: GitHubRepo = {
  owner: 'acme',
  name: 'project',
  fullName: 'acme/project',
  description: null,
  defaultBranch: 'main',
  stars: 12,
  forks: 3,
  language: 'TypeScript',
  topics: [],
  isPrivate: false,
  url: 'https://github.com/acme/project',
  openIssuesCount: 0,
  pushedAt: '2026-01-01T00:00:00Z',
  license: 'MIT',
}

describe('PreviewRepoHeader', () => {
  it('provides an accessible name for disconnecting the repository', () => {
    render(<PreviewRepoHeader repo={repo} onDisconnect={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Disconnect repository' })).toBeVisible()
  })

  it('truncates long repository names while keeping disconnect available', () => {
    render(
      <PreviewRepoHeader
        repo={{
          ...repo,
          owner: 'an-owner-with-a-name-that-is-long-enough-to-overflow',
          name: 'a-repository-name-that-is-long-enough-to-overflow',
          fullName: 'an-owner-with-a-name-that-is-long-enough-to-overflow/a-repository-name-that-is-long-enough-to-overflow',
        }}
        onDisconnect={vi.fn()}
      />,
    )

    const link = screen.getByRole('link')
    expect(link).toHaveClass('min-w-0', 'truncate')
    expect(screen.getByRole('button', { name: 'Disconnect repository' })).toHaveClass('shrink-0')
  })
})
