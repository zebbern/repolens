import { describe, expect, it, vi } from 'vitest'
import { readBoundedJsonBody } from './json-body'

describe('readBoundedJsonBody', () => {
  it('rejects with the caller abort reason before reading an aborted request', async () => {
    const controller = new AbortController()
    const reason = new DOMException('caller stopped', 'AbortError')
    controller.abort(reason)
    const read = vi.fn().mockResolvedValue({ done: true, value: undefined })
    const request = {
      headers: new Headers(),
      body: { getReader: () => ({ read, cancel: vi.fn(), releaseLock: vi.fn() }) },
      signal: controller.signal,
    } as unknown as Request

    await expect(readBoundedJsonBody(request, 4)).rejects.toBe(reason)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects promptly with the caller abort reason while a body read is pending', async () => {
    const controller = new AbortController()
    const reason = new DOMException('caller stopped while reading', 'AbortError')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}))
    const request = {
      headers: new Headers(),
      body: { getReader: () => ({ read, cancel, releaseLock }) },
      signal: controller.signal,
    } as unknown as Request

    const pending = readBoundedJsonBody(request, 4).then(
      () => Symbol('resolved'),
      (error) => error,
    )
    controller.abort(reason)
    const timeout = new Promise((resolve) => setTimeout(() => resolve(Symbol('timed out')), 100))

    await expect(Promise.race([pending, timeout])).resolves.toBe(reason)
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
  })

  it('cancels a declared oversized request body before returning 413', async () => {
    const cancel = vi.fn()
    const request = new Request('http://localhost/api/deps', {
      method: 'POST',
      headers: { 'Content-Length': '5' },
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const result = await readBoundedJsonBody(request, 4)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(413)
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels and releases the reader when a chunked body exceeds the ceiling', async () => {
    const cancel = vi.fn()
    const request = new Request('http://localhost/api/deps', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5))
        },
        cancel,
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const result = await readBoundedJsonBody(request, 4)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(413)
    expect(cancel).toHaveBeenCalled()
    expect(() => request.body?.getReader()).not.toThrow()
  })

  it('cancels and releases the reader when reading the body fails', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const request = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi.fn().mockRejectedValue(new Error('body read failed')),
          cancel,
          releaseLock,
        }),
      },
      signal: new AbortController().signal,
    } as unknown as Request

    const result = await readBoundedJsonBody(request, 4)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.response.status).toBe(400)
    expect(cancel).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
  })
})
