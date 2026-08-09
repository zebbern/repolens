import type { ModelMessage } from 'ai'

export type UntrustedContextKind =
  | 'repository-metadata'
  | 'file-tree'
  | 'structural-index'
  | 'pinned-files'
  | 'commit-data'
  | 'tool-result'

export interface UntrustedContextBlock {
  kind: UntrustedContextKind
  data: unknown
}

const CONTEXT_OPEN = '<repolens_untrusted_context format="json">'
const CONTEXT_CLOSE = '</repolens_untrusted_context>'

function isUntrustedContextKind(value: unknown): value is UntrustedContextKind {
  switch (value) {
    case 'repository-metadata':
    case 'file-tree':
    case 'structural-index':
    case 'pinned-files':
    case 'commit-data':
    case 'tool-result':
      return true
    default:
      return false
  }
}

function escapeEnvelopeData(value: string): string {
  return value
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
}

export function serializeUntrustedJson(value: unknown): string {
  return escapeEnvelopeData(JSON.stringify(value))
}

export function serializeUntrustedContext(
  blocks: readonly UntrustedContextBlock[],
): string {
  return `${CONTEXT_OPEN}${serializeUntrustedJson(blocks)}${CONTEXT_CLOSE}`
}

/** Parse only a canonical RepoLens envelope, preserving the exactly-once boundary. */
export function parseUntrustedContext(
  value: unknown,
): UntrustedContextBlock[] | undefined {
  if (
    typeof value !== 'string'
    || !value.startsWith(CONTEXT_OPEN)
    || !value.endsWith(CONTEXT_CLOSE)
  ) return undefined

  try {
    const parsed = JSON.parse(
      value.slice(CONTEXT_OPEN.length, -CONTEXT_CLOSE.length),
    ) as unknown
    if (
      !Array.isArray(parsed)
      || !parsed.every(block => (
        block !== null
        && typeof block === 'object'
        && isUntrustedContextKind((block as { kind?: unknown }).kind)
        && Object.hasOwn(block, 'data')
      ))
    ) return undefined

    const blocks = parsed as UntrustedContextBlock[]
    return serializeUntrustedContext(blocks) === value ? blocks : undefined
  } catch {
    return undefined
  }
}

export function createUntrustedContextMessage(
  blocks: readonly UntrustedContextBlock[],
): ModelMessage {
  return {
    role: 'user',
    content: serializeUntrustedContext(blocks),
  }
}

export function parseToolResultData(result: unknown): unknown {
  if (typeof result !== 'string') return result
  try {
    return JSON.parse(result) as unknown
  } catch {
    return result
  }
}

export function serializeToolResult(result: unknown): string {
  return serializeUntrustedContext([{
    kind: 'tool-result',
    data: parseToolResultData(result),
  }])
}
