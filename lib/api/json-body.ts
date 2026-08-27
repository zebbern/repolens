import { apiError } from './error'

export const MAX_API_KEY_REQUEST_BODY_BYTES = 4 * 1024

export class ResponseBodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Response body exceeds ${maxBytes} bytes`)
    this.name = 'ResponseBodyTooLargeError'
  }
}

export interface BoundedJsonResponse<T> {
  data: T
  bytes: number
}

/** Read and parse an upstream JSON response without buffering past maxBytes. */
export async function readBoundedJsonResponse<T>(
  response: Response,
  maxBytes: number,
): Promise<BoundedJsonResponse<T>> {
  const contentLength = response.headers?.get('content-length') ?? null
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => {})
      throw new ResponseBodyTooLargeError(maxBytes)
    }
  }

  if (!response.body) {
    return { data: await response.json() as T, bytes: Number(contentLength) || 0 }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ResponseBodyTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = decoder.decode(body)
  return { data: JSON.parse(text) as T, bytes: totalBytes }
}

type BoundedJsonResult =
  | { success: true; data: unknown }
  | { success: false; response: ReturnType<typeof apiError> }

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/** Read and parse a JSON request without buffering more than the configured byte ceiling. */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const signal = request.signal
  if (signal.aborted) throw callerAbortReason(signal)

  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      void request.body?.cancel().catch(() => {})
      if (signal.aborted) throw callerAbortReason(signal)
      return {
        success: false,
        response: apiError('PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum size', 413),
      }
    }
  }

  if (!request.body) {
    return {
      success: false,
      response: apiError('INVALID_JSON', 'Invalid JSON in request body', 400),
    }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let rejectAbort: ((reason: unknown) => void) | undefined
  let abortHandled = false
  const abortBoundary = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    if (abortHandled) return
    abortHandled = true
    void reader.cancel().catch(() => {})
    rejectAbort?.(callerAbortReason(signal))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortBoundary])
      if (signal.aborted) throw callerAbortReason(signal)
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => {})
        if (signal.aborted) throw callerAbortReason(signal)
        return {
          success: false,
          response: apiError('PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum size', 413),
        }
      }
      chunks.push(value)
    }
  } catch {
    if (signal.aborted) throw callerAbortReason(signal)
    void reader.cancel().catch(() => {})
    return {
      success: false,
      response: apiError('INVALID_JSON', 'Invalid JSON in request body', 400),
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      // A stream may reject lock release while it is already being cancelled.
    }
  }

  if (signal.aborted) throw callerAbortReason(signal)

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return { success: true, data: JSON.parse(text) as unknown }
  } catch {
    return {
      success: false,
      response: apiError('INVALID_JSON', 'Invalid JSON in request body', 400),
    }
  }
}
