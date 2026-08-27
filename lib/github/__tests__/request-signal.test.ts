import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGitHubRequestSignal, fetchGitHub } from '../request-signal'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('createGitHubRequestSignal', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts with a timeout when the caller remains active', () => {
    vi.useFakeTimers()
    const request = createGitHubRequestSignal(undefined, 25)

    vi.advanceTimersByTime(25)

    expect(request.signal.aborted).toBe(true)
    expect(request.signal.reason).toMatchObject({ name: 'TimeoutError' })
    request.cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the caller abort reason and cleans up the deadline timer', () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const request = createGitHubRequestSignal(caller.signal, 25_000)
    const reason = new DOMException('cancelled by caller', 'AbortError')

    caller.abort(reason)

    expect(request.signal.aborted).toBe(true)
    expect(request.signal.reason).toBe(reason)
    request.cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps caller cancellation active until the response body is consumed', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    let upstreamSignal: AbortSignal | null | undefined
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
    })
    mockFetch.mockImplementationOnce((_input: RequestInfo | URL, init: RequestInit) => {
      upstreamSignal = init.signal
      return Promise.resolve(new Response(body))
    })

    const response = await fetchGitHub('https://api.github.com/user', { signal: caller.signal })
    const bodyText = response.text()
    const reason = new DOMException('cancelled while reading body', 'AbortError')
    caller.abort(reason)

    expect(upstreamSignal?.aborted).toBe(true)
    expect(upstreamSignal?.reason).toBe(reason)

    bodyController?.enqueue(new TextEncoder().encode('ok'))
    bodyController?.close()
    await expect(bodyText).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the wrapped upstream reader exactly once at EOF', async () => {
    const releaseLock = vi.fn()
    const reader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock,
    }
    mockFetch.mockResolvedValueOnce({
      body: { getReader: () => reader },
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
    } as unknown as Response)

    const response = await fetchGitHub('https://api.github.com/user')
    await expect(response.text()).resolves.toBe('')

    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('releases the wrapped upstream reader exactly once on read error', async () => {
    const releaseLock = vi.fn()
    const reader = {
      read: vi.fn().mockRejectedValue(new Error('upstream read failed')),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock,
    }
    mockFetch.mockResolvedValueOnce({
      body: { getReader: () => reader },
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
    } as unknown as Response)

    const response = await fetchGitHub('https://api.github.com/user')
    await expect(response.text()).rejects.toThrow('upstream read failed')

    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('releases the wrapped upstream reader exactly once when cancelled', async () => {
    const releaseLock = vi.fn()
    const cancel = vi.fn().mockResolvedValue(undefined)
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})),
      cancel,
      releaseLock,
    }
    mockFetch.mockResolvedValueOnce({
      body: { getReader: () => reader },
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
    } as unknown as Response)

    const response = await fetchGitHub('https://api.github.com/user')
    await response.body?.cancel('caller stopped')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })
})
