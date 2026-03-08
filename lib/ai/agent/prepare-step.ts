import { pruneMessages, type ModelMessage } from 'ai'
import { createContextCompactor } from '@/lib/ai/context-compactor'
import type { CompactionContext } from './prepare-call'

/**
 * ADR-6: prepareStep vs Anthropic contextManagement interaction
 *
 * RepoLens uses two complementary compaction mechanisms for Anthropic models:
 *
 * 1. **prepareStep (content-level compaction)** — implemented by
 *    `createContextCompactor`. Runs before each LLM call. Truncates old
 *    tool-result content to short summaries, keeping recent steps fully
 *    intact. Operates on the message array directly. Affects ALL providers.
 *
 * 2. **Anthropic contextManagement (token-level compaction)** — configured
 *    via `providerOptions.anthropic.contextManagement` in `prepareCall`.
 *    Runs inside the Anthropic provider. Two edits:
 *    - `clear_tool_uses_20250919`: clears old tool-use/result pairs when
 *      input tokens exceed ~80k, keeping the 10 most recent.
 *    - `compact_20260112`: triggers provider-side context summarization
 *      when input tokens exceed ~150k.
 *
 * These mechanisms are complementary, NOT redundant:
 * - `prepareStep` reduces content bulk early (long file contents → short summaries),
 *   preventing token waste on stale tool results across ALL providers.
 * - Anthropic `contextManagement` handles token-level pressure that content
 *   truncation alone cannot solve (e.g., many small tool calls, large system
 *   prompts, accumulated assistant reasoning).
 *
 * Both are always active for Anthropic.
 * For non-Anthropic providers, only `prepareStep` runs.
 */

type PrepareStepParams = {
  stepNumber: number
  messages: ModelMessage[]
  experimental_context: unknown
}

type PrepareStepResult = {
  messages?: ModelMessage[]
  activeTools?: string[]
} | undefined

/**
 * Core tools always available to the agent regardless of loaded skills.
 */
const CORE_TOOLS = [
  'readFile', 'readFiles', 'searchFiles', 'listDirectory',
  'findSymbol', 'getFileStats', 'loadSkill', 'discoverSkills',
] as const

/**
 * Tools unlocked when specific skills are loaded.
 */
const SKILL_TOOLS: Record<string, string[]> = {
  'security-audit': ['scanIssues'],
  'architecture-analysis': ['analyzeImports', 'generateDiagram', 'getProjectOverview'],
  'tour-creation': ['generateTour'],
  'git-analysis': ['getGitHistory'],
}

/**
 * Extracts loaded skill IDs from the message history by scanning for
 * skill-instructions delimiters in tool result content.
 */
function extractLoadedSkillIds(messages: ModelMessage[]): string[] {
  const ids = new Set<string>()
  // Handle both raw quotes and JSON-escaped quotes (\" → \\ and " in the string)
  const SKILL_TAG_PATTERN = /<skill-instructions source=\\?"([^"\\]+)\\?">/g
  for (const msg of messages) {
    if (msg.role !== 'tool') continue
    // Only scan loadSkill tool results to prevent spoofing via repo content
    const parts = Array.isArray(msg.content) ? msg.content : []
    for (const part of parts) {
      if ((part as { toolName?: string }).toolName !== 'loadSkill') continue
      const serialized = JSON.stringify(part)
      let match: RegExpExecArray | null
      while ((match = SKILL_TAG_PATTERN.exec(serialized)) !== null) {
        ids.add(match[1])
      }
      SKILL_TAG_PATTERN.lastIndex = 0
    }
  }
  return [...ids]
}

/**
 * Determines the active tools based on loaded skills.
 * Core tools are always available. Skill-specific tools are unlocked
 * when the corresponding skill has been loaded via `loadSkill`.
 */
function getActiveTools(messages: ModelMessage[]): string[] {
  const loadedSkills = extractLoadedSkillIds(messages)
  const skillTools = loadedSkills.flatMap(id => SKILL_TOOLS[id] ?? [])
  return [...CORE_TOOLS, ...skillTools]
}

/** Cache of compactor functions keyed by `maxSteps-model`. */
const compactorCache = new Map<string, (params: { stepNumber: number; messages: ModelMessage[] }) => { messages: ModelMessage[] } | undefined>()

/**
 * Build the `prepareStep` function for the ToolLoopAgent.
 *
 * Responsibilities:
 * 1. Message pruning via `pruneMessages` — removes stale reasoning before the last message
 * 2. Content-level compaction via `createContextCompactor` (always active)
 * 3. Progressive tool disclosure via `activeTools` — only core tools available
 *    until skills are loaded, which unlock additional tools
 */
export function buildPrepareStep() {
  return ({ stepNumber, messages, experimental_context }: PrepareStepParams): PrepareStepResult => {
    const ctx = experimental_context as CompactionContext | undefined

    // 1. Prune messages: remove stale reasoning to reduce token usage
    let processedMessages = pruneMessages({
      messages,
      reasoning: 'before-last-message',
    })

    // 2. Content-level compaction (always enabled)
    if (ctx) {
      const cacheKey = `${ctx.maxSteps}-${ctx.model}`
      let compactor = compactorCache.get(cacheKey)
      if (!compactor) {
        compactor = createContextCompactor({
          maxSteps: ctx.maxSteps,
          contextWindow: ctx.contextWindow,
          provider: ctx.provider,
        })
        compactorCache.set(cacheKey, compactor)
      }

      const compacted = compactor({ stepNumber, messages: processedMessages })
      if (compacted) {
        processedMessages = compacted.messages
      }
    }

    // 3. Progressive tool disclosure
    const activeTools = getActiveTools(processedMessages)

    return { messages: processedMessages, activeTools }
  }
}
