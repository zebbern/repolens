export const GITHUB_REQUEST_TIMEOUT_MS = 30_000

export interface GitHubRequestSignal {
  signal: AbortSignal
  cleanup: () => void
}

/** Fetch GitHub with caller cancellation and a finite network deadline. */
export async function fetchGitHub(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const request = createGitHubRequestSignal(init.signal ?? undefined)
  let releaseReader: (() => void) | undefined
  try {
    const response = await fetch(input, { ...init, signal: request.signal })
    if (!response.body) {
      request.cleanup()
      return response
    }

    const reader = response.body.getReader()
    let released = false
    releaseReader = () => {
      if (released) return
      released = true
      try {
        reader.releaseLock()
      } catch {
        // The stream may already have released the reader during shutdown.
      }
    }
    const finish = () => {
      releaseReader?.()
      request.cleanup()
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            finish()
            controller.close()
          } else {
            controller.enqueue(result.value)
          }
        } catch (error) {
          finish()
          controller.error(error)
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason)
        } finally {
          finish()
        }
      },
    })

    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  } catch (error) {
    releaseReader?.()
    request.cleanup()
    throw error
  }
}

/** Create a request signal that follows its caller and has a finite deadline. */
export function createGitHubRequestSignal(
  callerSignal?: AbortSignal,
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
): GitHubRequestSignal {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let callerAbortListener: (() => void) | undefined
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (callerSignal && callerAbortListener) {
      callerSignal.removeEventListener('abort', callerAbortListener)
    }
  }

  const abortFromCaller = () => {
    if (controller.signal.aborted) return
    controller.abort(callerSignal?.reason)
    cleanup()
  }

  if (callerSignal?.aborted) {
    abortFromCaller()
  } else if (callerSignal) {
    callerAbortListener = abortFromCaller
    callerSignal.addEventListener('abort', callerAbortListener, { once: true })
  }

  if (!controller.signal.aborted) {
    timeoutId = setTimeout(() => {
      controller.abort(new DOMException('GitHub request timed out', 'TimeoutError'))
      cleanup()
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup,
  }
}
