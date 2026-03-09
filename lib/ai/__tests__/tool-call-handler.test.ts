import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MutableRefObject } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { handleToolCall } from '../tool-call-handler'
import type { ToolCallInfo, AddToolOutputFn } from '../tool-call-handler'

// Mock the GitHub client proxy functions
vi.mock('@/lib/github/client', () => ({
  fetchCommitsViaProxy: vi.fn(),
  fetchFileCommitsViaProxy: vi.fn(),
  fetchBlameViaProxy: vi.fn(),
  fetchCommitDetailViaProxy: vi.fn(),
}))

// Mock fetchFileContent (used by readFile fallback)
vi.mock('@/lib/github/fetcher', () => ({
  fetchFileContent: vi.fn(),
}))

import {
  fetchCommitsViaProxy,
  fetchFileCommitsViaProxy,
  fetchBlameViaProxy,
  fetchCommitDetailViaProxy,
} from '@/lib/github/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockIndex(): CodeIndex {
  let index = createEmptyIndex()
  index = indexFile(
    index,
    'src/hello.ts',
    'export function hello() { return "hi" }\n',
    'typescript',
  )
  return index
}

function createMockRef(index: CodeIndex | null): MutableRefObject<CodeIndex | null> {
  return { current: index }
}

// ---------------------------------------------------------------------------
// handleToolCall
// ---------------------------------------------------------------------------

describe('handleToolCall', () => {
  let addToolOutput: ReturnType<typeof vi.fn>

  beforeEach(() => {
    addToolOutput = vi.fn()
  })

  it('calls addToolOutput with output on successful tool execution', async () => {
    const codeIndexRef = createMockRef(buildMockIndex())
    const toolCall: ToolCallInfo = {
      toolName: 'readFile',
      input: { path: 'src/hello.ts' },
      toolCallId: 'call_1',
    }

    await handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, codeIndexRef)

    expect(addToolOutput).toHaveBeenCalledOnce()
    const call = addToolOutput.mock.calls[0][0]
    expect(call).toHaveProperty('output')
    expect(call.toolCallId).toBe('call_1')
    // Output should be a JSON string from executeToolLocally
    expect(typeof call.output).toBe('string')
    const parsed = JSON.parse(call.output as string)
    expect(parsed.path).toBe('src/hello.ts')
  })

  it('calls addToolOutput with state output-error and errorText when tool throws', async () => {
    // Pass a ref with null index — executeToolLocally won't throw but returns error.
    // To test actual throw, mock executeToolLocally to throw.
    const codeIndexRef = createMockRef(null)
    // executeToolLocally returns JSON with error for null index — but doesn't throw.
    // For a real throw scenario, we need the input to cause an exception.
    // The safest approach: use a proxy that throws on access.
    const badRef = {
      get current(): CodeIndex | null {
        throw new Error('Index unavailable')
      },
      set current(_v: CodeIndex | null) {
        // no-op
      },
    } as MutableRefObject<CodeIndex | null>

    const toolCall: ToolCallInfo = {
      toolName: 'readFile',
      input: { path: 'foo.ts' },
      toolCallId: 'call_err',
    }

    await handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, badRef)

    expect(addToolOutput).toHaveBeenCalledOnce()
    const call = addToolOutput.mock.calls[0][0]
    expect(call.state).toBe('output-error')
    expect(call.toolCallId).toBe('call_err')
    expect(call.errorText).toContain('Index unavailable')
  })

  it('returns early (no addToolOutput call) when toolCall.dynamic is true', async () => {
    const codeIndexRef = createMockRef(buildMockIndex())
    const toolCall: ToolCallInfo = {
      dynamic: true,
      toolName: 'readFile',
      input: { path: 'src/hello.ts' },
      toolCallId: 'call_dyn',
    }

    await handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, codeIndexRef)

    expect(addToolOutput).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // getGitHistory handler
  // ─────────────────────────────────────────────────────────────────────────

  const repoOptions = {
    repoInfo: { owner: 'octocat', name: 'hello-world', defaultBranch: 'main' },
  }

  const mockCommit = {
    sha: 'abc123',
    message: 'feat: add feature\n\nDetailed body',
    authorName: 'Octocat',
    authorEmail: 'octo@github.com',
    authorDate: '2025-01-15T10:00:00Z',
    committerName: 'Octocat',
    committerDate: '2025-01-15T10:00:00Z',
    url: 'https://github.com/octocat/hello-world/commit/abc123',
    authorLogin: 'octocat',
    authorAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
    parents: [{ sha: 'parent1' }],
  }

  describe('getGitHistory — commits mode', () => {
    it('calls fetchCommitsViaProxy and returns commit data', async () => {
      vi.mocked(fetchCommitsViaProxy).mockResolvedValue([mockCommit])

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'commits', maxResults: 10 },
        toolCallId: 'git_commits_1',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(fetchCommitsViaProxy).toHaveBeenCalledWith('octocat', 'hello-world', {
        sha: undefined,
        perPage: 10,
      })
      expect(addToolOutput).toHaveBeenCalledOnce()
      const call = addToolOutput.mock.calls[0][0]
      expect(call.toolCallId).toBe('git_commits_1')
      const parsed = JSON.parse(call.output as string)
      expect(parsed.commits).toHaveLength(1)
      expect(parsed.commits[0].sha).toBe('abc123')
      expect(parsed.commits[0].messageHeadline).toBe('feat: add feature')
    })

    it('calls fetchFileCommitsViaProxy when path is provided', async () => {
      vi.mocked(fetchFileCommitsViaProxy).mockResolvedValue([mockCommit])

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'commits', path: 'src/index.ts', maxResults: 5 },
        toolCallId: 'git_file_commits_1',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(fetchFileCommitsViaProxy).toHaveBeenCalledWith('octocat', 'hello-world', 'src/index.ts', {
        perPage: 5,
      })
      expect(addToolOutput).toHaveBeenCalledOnce()
    })
  })

  describe('getGitHistory — blame mode', () => {
    it('calls fetchBlameViaProxy and returns blame data', async () => {
      const mockBlame = {
        ranges: [
          {
            startingLine: 1,
            endingLine: 10,
            age: 3,
            commit: {
              oid: 'abc123full',
              abbreviatedOid: 'abc123',
              message: 'initial commit',
              messageHeadline: 'initial commit',
              committedDate: '2025-01-01T00:00:00Z',
              url: 'https://github.com/octocat/hello-world/commit/abc123',
              author: { name: 'Octocat', email: 'o@g.com', date: '2025-01-01', user: null },
            },
          },
        ],
        isTruncated: false,
        byteSize: 500,
      }
      vi.mocked(fetchBlameViaProxy).mockResolvedValue(mockBlame)

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'blame', path: 'src/utils.ts' },
        toolCallId: 'git_blame_1',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(fetchBlameViaProxy).toHaveBeenCalledWith('octocat', 'hello-world', 'main', 'src/utils.ts')
      expect(addToolOutput).toHaveBeenCalledOnce()
      const parsed = JSON.parse(addToolOutput.mock.calls[0][0].output as string)
      expect(parsed.ranges).toHaveLength(1)
      expect(parsed.ranges[0].author).toBe('Octocat')
      expect(parsed.authorStats).toEqual({ Octocat: 10 })
      expect(parsed.totalRanges).toBe(1)
    })

    it('uses custom ref when provided', async () => {
      vi.mocked(fetchBlameViaProxy).mockResolvedValue({ ranges: [], isTruncated: false, byteSize: 0 })

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'blame', path: 'README.md', ref: 'v2.0' },
        toolCallId: 'git_blame_ref',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(fetchBlameViaProxy).toHaveBeenCalledWith('octocat', 'hello-world', 'v2.0', 'README.md')
    })
  })

  describe('getGitHistory — commit-detail mode', () => {
    it('calls fetchCommitDetailViaProxy and returns detail', async () => {
      const mockDetail = {
        sha: 'abc123',
        message: 'feat: add feature',
        authorName: 'Octocat',
        authorEmail: 'o@g.com',
        authorDate: '2025-01-15T10:00:00Z',
        committerName: 'Octocat',
        committerDate: '2025-01-15T10:00:00Z',
        url: 'https://github.com/octocat/hello-world/commit/abc123',
        authorLogin: 'octocat',
        authorAvatarUrl: null,
        parents: [],
        stats: { additions: 10, deletions: 2, total: 12 },
        files: [{ filename: 'src/index.ts', status: 'modified' as const, additions: 10, deletions: 2, changes: 12 }],
      }
      vi.mocked(fetchCommitDetailViaProxy).mockResolvedValue(mockDetail)

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'commit-detail', sha: 'abc123' },
        toolCallId: 'git_detail_1',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(fetchCommitDetailViaProxy).toHaveBeenCalledWith('octocat', 'hello-world', 'abc123')
      expect(addToolOutput).toHaveBeenCalledOnce()
      const parsed = JSON.parse(addToolOutput.mock.calls[0][0].output as string)
      expect(parsed.sha).toBe('abc123')
      expect(parsed.stats.total).toBe(12)
    })
  })

  describe('getGitHistory — error handling', () => {
    it('returns output-error when repoInfo is missing', async () => {
      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'commits' },
        toolCallId: 'git_no_repo',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        undefined, // no options → no repoInfo
      )

      expect(addToolOutput).toHaveBeenCalledOnce()
      const call = addToolOutput.mock.calls[0][0]
      expect(call.state).toBe('output-error')
      expect(call.toolCallId).toBe('git_no_repo')
      expect(call.errorText).toContain('Repository context is required')
    })

    it('returns output-error when a proxy function throws', async () => {
      vi.mocked(fetchCommitsViaProxy).mockRejectedValue(new Error('API rate limit exceeded'))

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'commits' },
        toolCallId: 'git_api_err',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      expect(addToolOutput).toHaveBeenCalledOnce()
      const call = addToolOutput.mock.calls[0][0]
      expect(call.state).toBe('output-error')
      expect(call.errorText).toBe('API rate limit exceeded')
    })

    it('returns generic error message for non-Error throws', async () => {
      vi.mocked(fetchBlameViaProxy).mockRejectedValue('unknown failure')

      const toolCall: ToolCallInfo = {
        toolName: 'getGitHistory',
        input: { mode: 'blame', path: 'file.ts' },
        toolCallId: 'git_generic_err',
      }

      await handleToolCall(
        toolCall,
        addToolOutput as unknown as AddToolOutputFn,
        createMockRef(buildMockIndex()),
        undefined,
        repoOptions,
      )

      const call = addToolOutput.mock.calls[0][0]
      expect(call.state).toBe('output-error')
      expect(call.errorText).toBe('Failed to fetch git history')
    })
  })

  // ── Regression: existing readFile still works ──

  it('still handles readFile correctly after getGitHistory addition', async () => {
    const codeIndexRef = createMockRef(buildMockIndex())
    const toolCall: ToolCallInfo = {
      toolName: 'readFile',
      input: { path: 'src/hello.ts' },
      toolCallId: 'call_regression',
    }

    await handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, codeIndexRef)

    expect(addToolOutput).toHaveBeenCalledOnce()
    const call = addToolOutput.mock.calls[0][0]
    expect(call.toolCallId).toBe('call_regression')
    expect(call).toHaveProperty('output')
    const parsed = JSON.parse(call.output as string)
    expect(parsed.path).toBe('src/hello.ts')
  })
})
