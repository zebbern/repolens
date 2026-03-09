import type { MutableRefObject } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { executeToolLocally, MAX_FILE_CONTENT_CHARS, type ToolExecutorOptions } from './client-tool-executor'
import { fetchFileContent } from '@/lib/github/fetcher'
import {
  fetchCommitsViaProxy,
  fetchFileCommitsViaProxy,
  fetchBlameViaProxy,
  fetchCommitDetailViaProxy,
} from '@/lib/github/client'

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

  // ── getGitHistory: async handler (must run before executeToolLocally) ──
  if (toolCall.toolName === 'getGitHistory') {
    const input = toolCall.input as Record<string, unknown>
    const repoInfo = options?.repoInfo
    if (!repoInfo) {
      addToolOutput({
        state: 'output-error' as const,
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        errorText: 'Repository context is required for git history. Connect a GitHub repository first.',
      })
      return
    }
    const { owner, name, defaultBranch } = repoInfo
    try {
      let output: unknown
      const mode = input.mode as string

      if (mode === 'commits') {
        const maxResults = (input.maxResults as number | undefined) ?? 20
        const path = input.path as string | undefined
        const sha = input.sha as string | undefined
        const commits = path
          ? await fetchFileCommitsViaProxy(owner, name, path, { perPage: maxResults })
          : await fetchCommitsViaProxy(owner, name, { sha, perPage: maxResults })
        output = {
          commits: commits.map(c => ({
            sha: c.sha,
            messageHeadline: c.message.split('\n')[0],
            authorName: c.authorName,
            authorDate: c.authorDate,
          })),
          total: commits.length,
        }
      } else if (mode === 'blame') {
        const path = input.path as string
        const ref = (input.ref as string | undefined) ?? defaultBranch
        const blameData = await fetchBlameViaProxy(owner, name, ref, path)
        const authorStats: Record<string, number> = {}
        for (const range of blameData.ranges) {
          const authorName = range.commit.author?.name ?? 'Unknown'
          const lineCount = range.endingLine - range.startingLine + 1
          authorStats[authorName] = (authorStats[authorName] ?? 0) + lineCount
        }
        output = {
          ranges: blameData.ranges.slice(0, 20).map(r => ({
            startingLine: r.startingLine,
            endingLine: r.endingLine,
            age: r.age,
            commitSha: r.commit.abbreviatedOid,
            message: r.commit.messageHeadline,
            author: r.commit.author?.name ?? 'Unknown',
            date: r.commit.committedDate,
          })),
          authorStats,
          totalRanges: blameData.ranges.length,
        }
      } else if (mode === 'commit-detail') {
        const sha = input.sha as string
        const detail = await fetchCommitDetailViaProxy(owner, name, sha)
        output = {
          ...detail,
          files: detail.files.slice(0, 50).map(({ patch, ...rest }) => rest),
          totalFiles: detail.files.length,
        }
      } else {
        throw new Error(`Unsupported git history mode: ${String(input.mode)}`)
      }

      addToolOutput({
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        output: JSON.stringify(output),
      })
    } catch (err) {
      addToolOutput({
        state: 'output-error' as const,
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        errorText: err instanceof Error ? err.message : 'Failed to fetch git history',
      })
    }
    return
  }

  try {
    const result = await executeToolLocally(
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
