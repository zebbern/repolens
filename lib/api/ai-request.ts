import { safeValidateUIMessages, type ToolSet, type UIMessage } from 'ai'
import type { ZodError } from 'zod'
import { apiError } from '@/lib/api/error'
import { parseUntrustedContext } from '@/lib/ai/agent/prompt-context'

export const AI_REQUEST_LIMITS = {
  bodyBytes: 2 * 1024 * 1024,
  messages: 200,
  partsPerMessage: 50,
  textPartBytes: 128 * 1024,
  toolPartBytes: 1024 * 1024,
  aggregateMessageBytes: Math.floor(1.5 * 1024 * 1024),
} as const

type AIRequestResult<T> =
  | { success: true; data: T }
  | { success: false; response: Response }

const textEncoder = new TextEncoder()

function payloadTooLarge(message: string): AIRequestResult<never> {
  return {
    success: false,
    response: apiError('PAYLOAD_TOO_LARGE', message, 413),
  }
}

function malformedRequest(message: string, details?: string): AIRequestResult<never> {
  return {
    success: false,
    response: apiError('VALIDATION_ERROR', message, 422, details),
  }
}

export function aiRequestSchemaError(error: ZodError): Response {
  const hasSizeOverflow = error.issues.some(issue => (
    issue.code === 'too_big'
    && ((issue as { origin?: string }).origin === 'string'
      || (issue as { origin?: string }).origin === 'array')
  ))
  return apiError(
    hasSizeOverflow ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
    'Invalid request',
    hasSizeOverflow ? 413 : 422,
    JSON.stringify(error.flatten().fieldErrors),
  )
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

export async function readBoundedAIRequest(
  request: Request,
): Promise<AIRequestResult<unknown>> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > AI_REQUEST_LIMITS.bodyBytes) {
      return payloadTooLarge('AI request body exceeds the 2 MiB limit')
    }
  }

  if (!request.body) return malformedRequest('Invalid JSON in request body')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > AI_REQUEST_LIMITS.bodyBytes) {
        await reader.cancel()
        return payloadTooLarge('AI request body exceeds the 2 MiB limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    return malformedRequest(
      'Could not read AI request body',
      error instanceof Error ? error.message : undefined,
    )
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return malformedRequest('AI request body must be valid UTF-8 JSON')
  }

  try {
    return { success: true, data: JSON.parse(text) as unknown }
  } catch {
    return malformedRequest('Invalid JSON in request body')
  }
}

function preflightMessageLimits(messages: unknown): AIRequestResult<undefined> {
  if (!Array.isArray(messages)) return { success: true, data: undefined }
  if (messages.length > AI_REQUEST_LIMITS.messages) {
    return payloadTooLarge(`AI request exceeds ${AI_REQUEST_LIMITS.messages} messages`)
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const parts = (message as { parts?: unknown }).parts
    if (!Array.isArray(parts)) continue
    if (parts.length > AI_REQUEST_LIMITS.partsPerMessage) {
      return payloadTooLarge(
        `AI message exceeds ${AI_REQUEST_LIMITS.partsPerMessage} parts`,
      )
    }

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const candidate = part as { type?: unknown; text?: unknown }
      if (
        (candidate.type === 'text' || candidate.type === 'reasoning')
        && typeof candidate.text === 'string'
        && byteLength(candidate.text) > AI_REQUEST_LIMITS.textPartBytes
      ) {
        return payloadTooLarge('AI text or reasoning part exceeds the 128 KiB limit')
      }
      if (
        typeof candidate.type === 'string'
        && (candidate.type === 'dynamic-tool' || candidate.type.startsWith('tool-'))
        && byteLength(JSON.stringify(part)) > AI_REQUEST_LIMITS.toolPartBytes
      ) {
        return payloadTooLarge('AI tool part exceeds the 1 MiB limit')
      }
    }
  }

  return { success: true, data: undefined }
}

const TRUSTED_SERVER_TOOL_NAMES = new Set(['discoverSkills', 'loadSkill'])

function isCanonicalToolResultEnvelope(value: unknown): boolean {
  const blocks = parseUntrustedContext(value)
  return blocks?.length === 1 && blocks[0].kind === 'tool-result'
}

function validateToolOutputProvenance(messages: UIMessage[]): AIRequestResult<undefined> {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!part.type.startsWith('tool-')) continue
      const toolName = part.type.slice(5)
      if (TRUSTED_SERVER_TOOL_NAMES.has(toolName)) continue
      const toolPart = part as { state?: string; output?: unknown; errorText?: unknown }

      if (toolPart.state === 'output-available' && !isCanonicalToolResultEnvelope(toolPart.output)) {
        return malformedRequest(`Tool output for ${toolName} is missing its untrusted-context envelope`)
      }
      if (toolPart.state === 'output-error' && !isCanonicalToolResultEnvelope(toolPart.errorText)) {
        return malformedRequest(`Tool error for ${toolName} is missing its untrusted-context envelope`)
      }
    }
  }
  return { success: true, data: undefined }
}

function removeReplayedControlToolParts(messages: UIMessage[]): UIMessage[] {
  return messages
    .map(message => ({
      ...message,
      parts: message.parts.filter(part => (
        !part.type.startsWith('tool-')
        || !TRUSTED_SERVER_TOOL_NAMES.has(part.type.slice(5))
      )),
    }))
    .filter(message => message.parts.length > 0)
}

export async function validateBoundedUIMessages(
  messages: unknown,
  tools: ToolSet,
): Promise<AIRequestResult<UIMessage[]>> {
  const preflight = preflightMessageLimits(messages)
  if (!preflight.success) return preflight

  const validated = await safeValidateUIMessages({ messages, tools: tools as never })
  if (!validated.success) {
    return malformedRequest('Malformed AI SDK UI messages', validated.error.message)
  }
  if (validated.data.some(message => message.role === 'system')) {
    return malformedRequest('Client-supplied system messages are not allowed')
  }
  if (validated.data.some(message => message.parts.some(part => part.type === 'dynamic-tool'))) {
    return malformedRequest('Dynamic tool parts are not supported')
  }
  const provenance = validateToolOutputProvenance(validated.data)
  if (!provenance.success) return provenance
  if (byteLength(JSON.stringify(validated.data)) > AI_REQUEST_LIMITS.aggregateMessageBytes) {
    return payloadTooLarge('Validated AI message payload exceeds the 1.5 MiB limit')
  }

  const sanitizedMessages = removeReplayedControlToolParts(validated.data)
  if (sanitizedMessages.length === 0) {
    return malformedRequest('AI messages cannot contain only replayed control tool results')
  }
  return { success: true, data: sanitizedMessages }
}
