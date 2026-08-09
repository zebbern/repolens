import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cache/repo-cache', () => ({
  listCachedRepos: vi.fn(),
  clearCachedRepo: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

import { clearCachedRepo, listCachedRepos } from '@/lib/cache/repo-cache'
import { toast } from 'sonner'
import { RecentRepos } from './recent-repos'

describe('RecentRepos cache removal', () => {
  beforeEach(() => {
    vi.mocked(listCachedRepos).mockResolvedValue([{
      key: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
      sha: 'sha',
      timestamp: Date.now(),
      fileCount: 1,
    }])
    vi.mocked(clearCachedRepo).mockResolvedValue(undefined)
  })

  it('keeps the repository visible and shows an error when explicit cleanup fails', async () => {
    const error = new DOMException('cleanup failed', 'UnknownError')
    vi.mocked(clearCachedRepo).mockRejectedValueOnce(error)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<RecentRepos onConnectWithUrl={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Remove owner/repo from cache' }))

    expect(clearCachedRepo).toHaveBeenCalledWith('owner', 'repo')
    expect(toast.error).toHaveBeenCalledWith(
      'Could not remove owner/repo from cached repositories.',
    )
    expect(screen.getByText('owner/repo')).toBeInTheDocument()
  })
})
