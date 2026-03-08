import type { MutableRefObject } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { executeToolLocally, MAX_FILE_CONTENT_CHARS, type ToolExecutorOptions } from './client-tool-executor'
import { fetchFileContent } from '@/lib/github/fetcher'

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
 *
 * For `readFile` calls that return "File not found", an async fallback fetches
 * the file from GitHub via `fetchFileContent` when `options.repoInfo` is set.
 */
export async function handleToolCall(
  toolCall: ToolCallInfo,
  addToolOutput: AddToolOutputFn,
  codeIndexRef: MutableRefObject<CodeIndex | null>,
  allFilePaths?: string[],
  options?: ToolExecutorOptions,
): Promise<void> {
  if (toolCall.dynamic) return

  try {
    const result = executeToolLocally(
      toolCall.toolName,
      toolCall.input as Record<string, unknown>,
      codeIndexRef.current,
      allFilePaths,
      options,
    )

    // Async fallback: if readFile returned "File not found", try GitHub
    if (toolCall.toolName === 'readFile' && options?.repoInfo) {
      try {
        const parsed = JSON.parse(result) as Record<string, unknown>
        if (typeof parsed.error === 'string' && parsed.error.includes('File not found')) {
          const { owner, name, defaultBranch, token } = options.repoInfo
          const input = toolCall.input as { path: string }
          const content = await fetchFileContent(owner, name, defaultBranch, input.path, { token })
          const lines = content.split('\n')
          const truncated = content.length > MAX_FILE_CONTENT_CHARS
            ? content.slice(0, MAX_FILE_CONTENT_CHARS)
            : content
          const output: Record<string, unknown> = {
            path: input.path,
            content: truncated,
            lineCount: lines.length,
            totalLines: lines.length,
          }
          if (truncated !== content) {
            output.warning = `File truncated from ${content.length} to ${MAX_FILE_CONTENT_CHARS} characters. Use startLine/endLine to read specific sections.`
          }
          addToolOutput({
            tool: toolCall.toolName as never,
            toolCallId: toolCall.toolCallId,
            output: JSON.stringify(output),
          })
          return
        }
      } catch {
        // Fetch failed — fall through to return the original "File not found" result
      }
    }

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
