import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRReviewProvider, usePRReviewActions, usePRReviewState } from '../pr-review-provider'

const github = vi.hoisted(() => ({
  fetchPullsViaProxy: vi.fn(),
  fetchPullRequestViaProxy: vi.fn(),
  fetchPullRequestFilesViaProxy: vi.fn(),
  fetchPullRequestCommentsViaProxy: vi.fn(),
}))

vi.mock('@/lib/github/client', () => github)
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function wrapper({ children }: { children: ReactNode }) {
  return <PRReviewProvider>{children}</PRReviewProvider>
}

describe('PRReviewProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    github.fetchPullsViaProxy.mockResolvedValue([])
  })

  it('settles an empty pull-request list instead of leaving a loading state', async () => {
    const { result } = renderHook(() => ({ state: usePRReviewState(), actions: usePRReviewActions() }), { wrapper })

    await act(() => result.current.actions.loadPRList('owner', 'repo'))

    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.availablePRs).toEqual([])
  })

  it('loads pull-request metadata and files without fetching unused comments', async () => {
    github.fetchPullRequestViaProxy.mockResolvedValue({ number: 42, changedFiles: 1 })
    github.fetchPullRequestFilesViaProxy.mockResolvedValue([{ filename: 'src/index.ts' }])
    const { result } = renderHook(() => ({ state: usePRReviewState(), actions: usePRReviewActions() }), { wrapper })

    await act(() => result.current.actions.selectPR('owner', 'repo', 42))

    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.files).toHaveLength(1)
    expect(github.fetchPullRequestCommentsViaProxy).not.toHaveBeenCalled()
  })
})
