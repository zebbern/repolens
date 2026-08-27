import type { ReactNode } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRReviewProvider,
  RepositoryScopedPRReviewProvider,
  usePRReviewActions,
  usePRReviewState,
} from '../pr-review-provider'

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
    expect(github.fetchPullRequestViaProxy.mock.calls[0][3]?.signal).toBeInstanceOf(AbortSignal)
    expect(github.fetchPullRequestFilesViaProxy.mock.calls[0][3]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('clears the selected PR synchronously before loading another repository', async () => {
    github.fetchPullRequestViaProxy.mockResolvedValue({ number: 42, changedFiles: 1 })
    github.fetchPullRequestFilesViaProxy.mockResolvedValue([{ filename: 'private.ts' }])
    let resolveList!: (value: unknown[]) => void
    github.fetchPullsViaProxy.mockReturnValueOnce(new Promise(resolve => { resolveList = resolve }))
    const { result } = renderHook(() => ({ state: usePRReviewState(), actions: usePRReviewActions() }), { wrapper })

    await act(() => result.current.actions.selectPR('private-owner', 'private-repo', 42))
    let listRequest!: Promise<void>
    act(() => { listRequest = result.current.actions.loadPRList('other-owner', 'other-repo') })

    expect(result.current.state.pr).toBeNull()
    expect(result.current.state.files).toEqual([])
    resolveList([])
    await act(async () => { await listRequest })
  })

  it('does not let an older PR filter response replace a newer one', async () => {
    let resolveOpen!: (value: unknown[]) => void
    let resolveClosed!: (value: unknown[]) => void
    github.fetchPullsViaProxy
      .mockReturnValueOnce(new Promise(resolve => { resolveOpen = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveClosed = resolve }))
    const { result } = renderHook(() => ({ state: usePRReviewState(), actions: usePRReviewActions() }), { wrapper })

    let openRequest!: Promise<void>
    act(() => { openRequest = result.current.actions.loadPRList('owner', 'repo', 'open') })
    const openSignal = github.fetchPullsViaProxy.mock.calls[0][2]?.signal
    let closedRequest!: Promise<void>
    act(() => { closedRequest = result.current.actions.loadPRList('owner', 'repo', 'closed') })

    expect(openSignal).toBeInstanceOf(AbortSignal)
    expect(openSignal?.aborted).toBe(true)

    resolveClosed([{ number: 2 }])
    await act(async () => { await closedRequest })
    resolveOpen([{ number: 1 }])
    await act(async () => { await openRequest })

    expect(result.current.state.availablePRs).toEqual([{ number: 2 }])
    expect(result.current.state.status).toBe('idle')
  })

  it('does not expose the previous repository PR state after the scope key changes', async () => {
    github.fetchPullRequestViaProxy.mockResolvedValue({ number: 42, changedFiles: 1 })
    github.fetchPullRequestFilesViaProxy.mockResolvedValue([{ filename: 'repo-a/private.ts' }])

    function StateProbe() {
      const state = usePRReviewState()
      const { selectPR } = usePRReviewActions()
      return (
        <>
          <button type="button" onClick={() => selectPR('owner', 'repo-a', 42)}>select PR</button>
          <span data-testid="selected-pr">{state.pr?.number ?? 'none'}</span>
          <span data-testid="selected-files">{state.files.map(file => file.filename).join(',')}</span>
        </>
      )
    }

    const view = render(
      <RepositoryScopedPRReviewProvider repositoryKey="owner/repo-a">
        <StateProbe />
      </RepositoryScopedPRReviewProvider>,
    )

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'select PR' })) })
    expect(screen.getByTestId('selected-pr')).toHaveTextContent('42')
    expect(screen.getByTestId('selected-files')).toHaveTextContent('repo-a/private.ts')

    view.rerender(
      <RepositoryScopedPRReviewProvider repositoryKey="owner/repo-b">
        <StateProbe />
      </RepositoryScopedPRReviewProvider>,
    )

    expect(screen.getByTestId('selected-pr')).toHaveTextContent('none')
    expect(screen.getByTestId('selected-files')).toBeEmptyDOMElement()
  })
})
