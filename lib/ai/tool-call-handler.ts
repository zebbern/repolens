import type { MutableRefObject } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { executeToolLocally, type ToolExecutorOptions } from './client-tool-executor'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal tool-call info passed by the AI SDK's `onToolCall` callback. */
export interface ToolCallInfo {
  dynamic?: boolean | undefined
  toolName: string
  input: unknown
  toolCallId: string
}

/** Success overload for `addToolOutput`. */
interface AddToolOutputSuccess {
  tool: never
  toolCallId: string
  output: unknown
}

/** Error overload for `addToolOutput`. */
interface AddToolOutputError {
  state: 'output-error'
  tool: never
  toolCallId: string
  errorText: string
}

/** Union callback matching the `addToolOutput` signature from `useChat`. */
export type AddToolOutputFn = (data: AddToolOutputSuccess | AddToolOutputError) => void

// ---------------------------------------------------------------------------
// Shared handler
// ---------------------------------------------------------------------------

/**
 * Shared `onToolCall` handler used by both the chat sidebar and the docs
 * provider.  Delegates non-dynamic tool calls to `executeToolLocally` and
 * feeds the result (or error) back through `addToolOutput`.
 */
export function handleToolCall(
  toolCall: ToolCallInfo,
  addToolOutput: AddToolOutputFn,
  codeIndexRef: MutableRefObject<CodeIndex | null>,
  allFilePaths?: string[],
  options?: ToolExecutorOptions,
): void {
  if (toolCall.dynamic) return

  try {
    const result = executeToolLocally(
      toolCall.toolName,
      toolCall.input as Record<string, unknown>,
      codeIndexRef.current,
      allFilePaths,
      options,
    )
    addToolOutput({
      // AI SDK expects a literal tool name type, but dynamic tool names require this cast
      tool: toolCall.toolName as never,
      toolCallId: toolCall.toolCallId,
      output: result,
    })
  } catch (err) {
    addToolOutput({
      state: 'output-error' as const,
      // AI SDK expects a literal tool name type, but dynamic tool names require this cast
      tool: toolCall.toolName as never,
      toolCallId: toolCall.toolCallId,
      errorText: err instanceof Error ? err.message : 'Tool execution failed',
    })
  }
}
