import type { ModelMessage, ToolModelMessage } from 'ai'

import {
  extractSignature,
  getExportRegex,
  getImportRegex,
  getLanguagePatterns,
  inferLanguage,
  isCodeFile,
} from './structural-index'

/**
 * Maximum number of recent steps whose tool results are kept in full.
 * Older tool results are compressed to just their tool name + a summary marker.
 */
const FULL_RESULT_STEPS = 4

/**
 * Maximum character length for a single tool-result output value before
 * it gets truncated in older steps.
 */
const MAX_TOOL_RESULT_LENGTH = 500

/** Maximum items per structural section in a compaction summary. */
const MAX_SUMMARY_ITEMS = 15

/**
 * Create a `prepareStep` callback for `streamText()` that trims older
 * tool-result messages to prevent unbounded context growth during
 * multi-step tool-calling sessions.
 *
 * Strategy:
 * - Keep the last `FULL_RESULT_STEPS` worth of assistant+tool message pairs intact
 * - For older tool messages, truncate large tool-result content to a short summary
 * - Never modify user or system messages
 */
export function createContextCompactor() {
  return ({ stepNumber, messages }: { stepNumber: number; messages: ModelMessage[] }) => {
    // No compaction needed for early steps
    if (stepNumber < FULL_RESULT_STEPS) return undefined

    const compacted = compactMessages(messages, FULL_RESULT_STEPS)
    return { messages: compacted }
  }
}

/**
 * Compact a message array by truncating tool-result content in older messages.
 * We keep the last `keepFullSteps` pairs of assistant→tool messages untouched.
 * Earlier tool messages get their content summarized.
 */
function compactMessages(
  messages: ModelMessage[],
  keepFullSteps: number,
): ModelMessage[] {
  // Find indices of all tool-role messages (these carry tool results)
  const toolMessageIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') {
      toolMessageIndices.push(i)
    }
  }

  // If we have fewer tool messages than the threshold, nothing to compact
  if (toolMessageIndices.length <= keepFullSteps) {
    return messages
  }

  // Determine the cutoff: tool messages before this index get compacted
  const cutoffIndex = toolMessageIndices[toolMessageIndices.length - keepFullSteps]

  return messages.map((msg, idx) => {
    if (msg.role !== 'tool' || idx >= cutoffIndex) return msg
    return compactToolMessage(msg as ToolModelMessage)
  })
}

/**
 * Produce a deterministic structural summary from code text.
 * Extracts imports, exports, and symbol signatures so the AI retains
 * useful structural knowledge after compaction instead of losing it
 * to a generic 500-char truncation.
 */
export function summarizeCodeForCompaction(content: string, path: string): string {
  if (!isCodeFile(path)) {
    return content.slice(0, MAX_TOOL_RESULT_LENGTH) + (content.length > MAX_TOOL_RESULT_LENGTH ? '… [truncated]' : '')
  }

  const lines = content.split('\n')
  const lineCount = lines.length
  const language = inferLanguage(path)

  // Extract imports
  const imports: string[] = []
  const importRegex = getImportRegex(language)
  if (importRegex) {
    importRegex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = importRegex.exec(content)) !== null) {
      const importName = m[1] || m[2]
      if (importName) imports.push(importName.trim())
      if (imports.length >= MAX_SUMMARY_ITEMS) break
    }
  }

  // Extract exports
  const exports: string[] = []
  const exportRegex = getExportRegex(language)
  if (exportRegex) {
    for (const line of lines) {
      const exportMatch = exportRegex.exec(line)
      if (exportMatch) {
        exports.push(exportMatch[1])
        if (exports.length >= MAX_SUMMARY_ITEMS) break
      }
    }
  }

  // Extract symbols with signatures
  const symbols = new Set<string>()
  const patterns = getLanguagePatterns(language)
  for (const line of lines) {
    for (const pat of patterns) {
      pat.regex.lastIndex = 0
      let sm: RegExpExecArray | null
      while ((sm = pat.regex.exec(line)) !== null) {
        const sig = extractSignature(line, sm[1], pat.kind)
        symbols.add(`${pat.kind}:${sig}`)
        if (symbols.size >= MAX_SUMMARY_ITEMS) break
      }
    }
    if (symbols.size >= MAX_SUMMARY_ITEMS) break
  }

  // For Python/Go, top-level defs are exports
  if (!exportRegex && (language === 'python' || language === 'go')) {
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) continue
      for (const pat of patterns) {
        pat.regex.lastIndex = 0
        const sm = pat.regex.exec(line)
        if (sm) {
          exports.push(sm[1])
          if (exports.length >= MAX_SUMMARY_ITEMS) break
        }
      }
      if (exports.length >= MAX_SUMMARY_ITEMS) break
    }
  }

  const summary: Record<string, unknown> = { path, lineCount }
  if (exports.length > 0) summary.exports = [...new Set(exports)]
  if (imports.length > 0) summary.imports = imports
  if (symbols.size > 0) summary.symbols = [...symbols]

  return JSON.stringify(summary)
}

/** Tool names that produce file-read results eligible for structural summarization. */
const FILE_READ_TOOLS = new Set(['readFile', 'readFiles'])

/**
 * Create a compacted version of a tool message. For readFile/readFiles results,
 * produces a structural summary (imports, exports, symbols). For all other tools,
 * falls back to 500-char truncation.
 */
function compactToolMessage(msg: ToolModelMessage): ToolModelMessage {
  return {
    ...msg,
    content: msg.content.map(part => {
      if (part.type !== 'tool-result') return part

      const output = part.output as { type: string; value: unknown }
      const toolName = 'toolName' in part ? (part as { toolName: string }).toolName : undefined

      // Structural summarization for file-read tools
      if (toolName && FILE_READ_TOOLS.has(toolName)) {
        return compactFileReadResult(part, output, toolName)
      }

      // Default truncation for all other tools
      return truncateToolOutput(part, output)
    }),
  }
}

/**
 * Compact a readFile or readFiles tool result using structural summarization.
 * Falls back to truncation if the result shape is unexpected.
 */
function compactFileReadResult(
  part: unknown,
  output: { type: string; value: unknown },
  toolName: string,
): unknown {
  if (output.type === 'json') {
    const value = output.value as Record<string, unknown>

    // readFiles returns an array of file results
    if (toolName === 'readFiles' && Array.isArray(value)) {
      const summaries = value.map((file: Record<string, unknown>) => {
        const content = typeof file.content === 'string' ? file.content : ''
        const path = typeof file.path === 'string' ? file.path : ''
        return summarizeCodeForCompaction(content, path)
      })
      return {
        ...(part as Record<string, unknown>),
        output: { type: 'text' as const, value: `[compacted] ${summaries.join('\n')}` },
      }
    }

    // readFile returns a single { path, content } object
    if (typeof value === 'object' && value !== null) {
      const content = typeof value.content === 'string' ? value.content : ''
      const path = typeof value.path === 'string' ? value.path : ''
      if (content || path) {
        const summary = summarizeCodeForCompaction(content, path)
        return {
          ...(part as Record<string, unknown>),
          output: { type: 'text' as const, value: `[compacted] ${summary}` },
        }
      }
    }
  }

  if (output.type === 'text') {
    const text = output.value as string
    if (text.length <= MAX_TOOL_RESULT_LENGTH) return part
    // Text readFile results may be raw content — try structural summary
    // but we lack a path, so fall back to truncation
    return {
      ...(part as Record<string, unknown>),
      output: {
        ...output,
        value: text.slice(0, MAX_TOOL_RESULT_LENGTH) + '… [truncated]',
      },
    }
  }

  return part
}

/**
 * Default truncation for non-file-read tool results.
 * Preserves output up to MAX_TOOL_RESULT_LENGTH characters.
 */
function truncateToolOutput(
  part: unknown,
  output: { type: string; value: unknown },
): unknown {
  if (output.type === 'text') {
    const text = output.value as string
    if (text.length <= MAX_TOOL_RESULT_LENGTH) return part
    return {
      ...(part as Record<string, unknown>),
      output: {
        ...output,
        value: text.slice(0, MAX_TOOL_RESULT_LENGTH) + '… [truncated]',
      },
    }
  }

  if (output.type === 'json') {
    const serialized = JSON.stringify(output.value)
    if (serialized.length <= MAX_TOOL_RESULT_LENGTH) return part
    return {
      ...(part as Record<string, unknown>),
      output: {
        type: 'text' as const,
        value: serialized.slice(0, MAX_TOOL_RESULT_LENGTH) + '… [truncated]',
      },
    }
  }

  // For 'execution-denied', 'error-text', etc. — leave as-is (small)
  return part
}
