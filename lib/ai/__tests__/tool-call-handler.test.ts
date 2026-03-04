import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MutableRefObject } from 'react'
import type { CodeIndex } from '@/lib/code/code-index'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { handleToolCall } from '../tool-call-handler'
import type { ToolCallInfo, AddToolOutputFn } from '../tool-call-handler'

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

  it('calls addToolOutput with output on successful tool execution', () => {
    const codeIndexRef = createMockRef(buildMockIndex())
    const toolCall: ToolCallInfo = {
      toolName: 'readFile',
      input: { path: 'src/hello.ts' },
      toolCallId: 'call_1',
    }

    handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, codeIndexRef)

    expect(addToolOutput).toHaveBeenCalledOnce()
    const call = addToolOutput.mock.calls[0][0]
    expect(call).toHaveProperty('output')
    expect(call.toolCallId).toBe('call_1')
    // Output should be a JSON string from executeToolLocally
    expect(typeof call.output).toBe('string')
    const parsed = JSON.parse(call.output as string)
    expect(parsed.path).toBe('src/hello.ts')
  })

  it('calls addToolOutput with state output-error and errorText when tool throws', () => {
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

    handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, badRef)

    expect(addToolOutput).toHaveBeenCalledOnce()
    const call = addToolOutput.mock.calls[0][0]
    expect(call.state).toBe('output-error')
    expect(call.toolCallId).toBe('call_err')
    expect(call.errorText).toContain('Index unavailable')
  })

  it('returns early (no addToolOutput call) when toolCall.dynamic is true', () => {
    const codeIndexRef = createMockRef(buildMockIndex())
    const toolCall: ToolCallInfo = {
      dynamic: true,
      toolName: 'readFile',
      input: { path: 'src/hello.ts' },
      toolCallId: 'call_dyn',
    }

    handleToolCall(toolCall, addToolOutput as unknown as AddToolOutputFn, codeIndexRef)

    expect(addToolOutput).not.toHaveBeenCalled()
  })
})
