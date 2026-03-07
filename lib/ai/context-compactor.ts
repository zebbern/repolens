import type { ModelMessage, ToolModelMessage } from 'ai'

import {
  extractSignature,
  getExportRegex,
  getImportRegex,
  getLanguagePatterns,
  inferLanguage,
  isCodeFile,
} from './structural-index'

/** Minimum number of recent steps whose tool results are kept in full. */
const MIN_FULL_RESULT_STEPS = 8

/** Default max length for compacted tool results. */
const DEFAULT_TOOL_RESULT_LENGTH = 6000

/** Tool-specific limits for non-file-read tools during compaction. */
export const TOOL_RESULT_LIMITS: Record<string, number> = {
  searchFiles: 6000,
  analyzeImports: 6000,
  listDirectory: 3000,
  findSymbol: 4000,
  getFileStats: 1500,
  scanIssues: 6000,
  getProjectOverview: 0, // handled by PINNED_TOOLS (never truncated)
  generateDiagram: 1500,
  generateTour: 3000,
}

/** Tools whose results must never be truncated — they provide critical structural context. */
const PINNED_TOOLS = new Set(['getProjectOverview'])

/** Maximum items per structural section in a compaction summary. */
const MAX_SUMMARY_ITEMS = 20

interface CompactorOptions {
  maxSteps?: number
  /** Model context window in tokens. */
  contextWindow?: number
  /** AI provider ('openai' | 'google' | 'anthropic' | 'openrouter'). Informational — scaling uses contextWindow. */
  provider?: string
}

interface ContextScaling {
  /** Multiplier applied to all truncation limits. */
  limitMultiplier: number
  /** Fraction of maxSteps to keep full results for. */
  keepFullRatio: number
  /** Minimum number of full-result steps. */
  minFullSteps: number
}

/**
 * Compute context-aware scaling factors.
 * Models with larger context windows get more generous compaction thresholds.
 */
function getContextScaling(contextWindow: number): ContextScaling {
  // Large context models (Google Gemini 1M+) — barely need compaction
  if (contextWindow >= 500_000) {
    return { limitMultiplier: 3.0, keepFullRatio: 0.35, minFullSteps: 12 }
  }
  // Standard context models (128K-500K — most OpenAI, Anthropic)
  if (contextWindow >= 128_000) {
    return { limitMultiplier: 1.0, keepFullRatio: 0.25, minFullSteps: 8 }
  }
  // Smaller context models (<128K)
  return { limitMultiplier: 0.8, keepFullRatio: 0.20, minFullSteps: 6 }
}

/**
 * Create a `prepareStep` callback for `streamText()` that trims older
 * tool-result messages to prevent unbounded context growth during
 * multi-step tool-calling sessions.
 *
 * Strategy:
 * - Scales thresholds based on the model's context window size
 * - Keep the last `fullResultSteps` worth of assistant+tool message pairs intact
 *   (scales with maxSteps via keepFullRatio, minimum from context scaling)
 * - For older tool messages, truncate large tool-result content to a short summary
 * - Pinned tools (e.g. `getProjectOverview`) are never truncated
 * - Never modify user or system messages
 *
 * @param options.maxSteps      Maximum tool-calling steps (default 50)
 * @param options.contextWindow  Model context window in tokens (default 128_000)
 * @param options.provider       AI provider name — informational only
 */
export function createContextCompactor(options?: CompactorOptions) {
  const maxSteps = options?.maxSteps ?? 50
  const contextWindow = options?.contextWindow ?? 128_000
  const scaling = getContextScaling(contextWindow)

  const fullResultSteps = Math.max(
    scaling.minFullSteps,
    Math.floor(maxSteps * scaling.keepFullRatio)
  )

  return ({ stepNumber, messages }: { stepNumber: number; messages: ModelMessage[] }) => {
    // No compaction needed for early steps
    if (stepNumber < fullResultSteps) return undefined

    const compacted = compactMessages(messages, fullResultSteps, scaling.limitMultiplier)
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
  limitMultiplier: number = 1.0,
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
    return compactToolMessage(msg as ToolModelMessage, limitMultiplier)
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
    return content.slice(0, DEFAULT_TOOL_RESULT_LENGTH) + (content.length > DEFAULT_TOOL_RESULT_LENGTH ? '… [truncated]' : '')
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
 * applies scaled truncation. Pinned tools are never truncated.
 */
function compactToolMessage(msg: ToolModelMessage, limitMultiplier: number): ToolModelMessage {
  return {
    ...msg,
    content: msg.content.map(part => {
      if (part.type !== 'tool-result') return part

      const toolName = 'toolName' in part ? (part as { toolName: string }).toolName : undefined

      // NEVER truncate pinned tools
      if (toolName && PINNED_TOOLS.has(toolName)) return part

      const output = part.output as { type: string; value: unknown }

      // Structural summarization for file-read tools
      if (toolName && FILE_READ_TOOLS.has(toolName)) {
        return compactFileReadResult(part, output, toolName)
      }

      // Default truncation for all other tools
      return truncateToolOutput(part, output, toolName, limitMultiplier)
    }) as ToolModelMessage['content'],
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

    // readFiles returns { files: [...] } wrapper shape
    if (toolName === 'readFiles' && typeof value === 'object' && value !== null && 'files' in value) {
      const filesArray = (value as Record<string, unknown>).files
      if (Array.isArray(filesArray)) {
        const summaries = filesArray.map((file: Record<string, unknown>) => {
          const content = typeof file.content === 'string' ? file.content : ''
          const path = typeof file.path === 'string' ? file.path : ''
          return summarizeCodeForCompaction(content, path)
        })
        return {
          ...(part as Record<string, unknown>),
          output: { type: 'text' as const, value: `[compacted batch] ${summaries.join('\n')}` },
        }
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
    if (text.length <= DEFAULT_TOOL_RESULT_LENGTH) return part
    // Text readFile results may be raw content — try structural summary
    // but we lack a path, so fall back to truncation
    return {
      ...(part as Record<string, unknown>),
      output: {
        ...output,
        value: text.slice(0, DEFAULT_TOOL_RESULT_LENGTH) + '… [truncated]',
      },
    }
  }

  return part
}

/**
 * Default truncation for non-file-read tool results.
 * Uses tool-specific limits when available, otherwise DEFAULT_TOOL_RESULT_LENGTH.
 * The base limit is scaled by `limitMultiplier` for context-window-aware compaction.
 */
function truncateToolOutput(
  part: unknown,
  output: { type: string; value: unknown },
  toolName?: string,
  limitMultiplier: number = 1.0,
): unknown {
  const baseLimit = (toolName && TOOL_RESULT_LIMITS[toolName]) || DEFAULT_TOOL_RESULT_LENGTH
  const maxLength = Math.floor(baseLimit * limitMultiplier)

  if (output.type === 'text') {
    const text = output.value as string
    if (text.length <= maxLength) return part
    return {
      ...(part as Record<string, unknown>),
      output: {
        ...output,
        value: text.slice(0, maxLength) + '… [truncated]',
      },
    }
  }

  if (output.type === 'json') {
    const serialized = JSON.stringify(output.value)
    if (serialized.length <= maxLength) return part
    return {
      ...(part as Record<string, unknown>),
      output: {
        type: 'text' as const,
        value: serialized.slice(0, maxLength) + '… [truncated]',
      },
    }
  }

  // For 'execution-denied', 'error-text', etc. — leave as-is (small)
  return part
}
