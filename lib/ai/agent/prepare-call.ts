import { stepCountIs, wrapLanguageModel } from 'ai'
import { createAIModel, getModelContextWindow } from '@/lib/ai/providers'
import { codeTools } from '@/lib/ai/tool-definitions'
import { buildChatPrompt } from './prompts/chat'
import { buildDocsPrompt } from './prompts/docs'
import { buildChangelogPrompt } from './prompts/changelog'
import { createLoggingMiddleware } from './middleware'
import type { CallOptions } from './options'

/**
 * Context passed through `experimental_context` for use in `prepareStep`.
 */
export interface CompactionContext {
  compactionEnabled: boolean
  maxSteps: number
  model: string
  provider: string
  contextWindow: number
}

/**
 * Per-mode compact_20260112 instructions for Anthropic context management.
 * Each mode preserves different analysis context during compaction.
 */
const COMPACTION_INSTRUCTIONS: Record<CallOptions['mode'], string> = {
  chat: 'Summarize the codebase analysis so far, preserving: all file paths examined, key code structure findings (exports, imports, patterns), decisions made about the codebase, and what remains to be analyzed.',
  docs: 'Summarize the codebase analysis so far, preserving: all file paths examined, key code structure findings (exports, imports, patterns), decisions made about the codebase, and what remains to be analyzed.',
  changelog: 'Summarize the changelog analysis so far, preserving: all commits examined, key changes identified, categorization decisions made, and what remains to be processed.',
}

function buildAnthropicProviderOptions(mode: CallOptions['mode']) {
  return {
    anthropic: {
      contextManagement: {
        edits: [
          {
            type: 'clear_tool_uses_20250919' as const,
            trigger: { type: 'input_tokens' as const, value: 80_000 },
            keep: { type: 'tool_uses' as const, value: 10 },
            clearAtLeast: { type: 'input_tokens' as const, value: 5_000 },
            clearToolInputs: false,
          },
          {
            type: 'compact_20260112' as const,
            trigger: { type: 'input_tokens' as const, value: 150_000 },
            instructions: COMPACTION_INSTRUCTIONS[mode],
            pauseAfterCompaction: false,
          },
        ],
      },
    },
  }
}

/**
 * Build the `prepareCall` function for the ToolLoopAgent.
 * Selects model, system prompt, stopWhen condition, and provider options
 * based on the discriminated `mode` field in `CallOptions`.
 */
const loggingMiddleware = createLoggingMiddleware()

export function buildPrepareCall() {
  return (baseCallArgs: { options: CallOptions } & Record<string, unknown>) => {
    const { options: callOptions } = baseCallArgs
    const { provider, model, apiKey, compactionEnabled } = callOptions
    const contextWindow = getModelContextWindow(model)
    const toolCount = Object.keys(codeTools).length
    const wrappedModel = wrapLanguageModel({
      model: createAIModel(provider, model, apiKey),
      middleware: loggingMiddleware,
    })

    const compactionContext: CompactionContext = {
      compactionEnabled: compactionEnabled ?? false,
      maxSteps: 50,
      model,
      provider,
      contextWindow,
    }

    switch (callOptions.mode) {
      case 'chat': {
        const stepBudget = callOptions.maxSteps ?? 50
        compactionContext.maxSteps = stepBudget

        return {
          ...baseCallArgs,
          model: wrappedModel,
          instructions: buildChatPrompt({
            repoContext: callOptions.repoContext,
            structuralIndex: callOptions.structuralIndex,
            pinnedContext: callOptions.pinnedContext,
            stepBudget,
            contextWindow,
            toolCount,
            model,
            activeSkills: callOptions.activeSkills,
          }),
          stopWhen: stepCountIs(stepBudget),
          ...(compactionEnabled && provider === 'anthropic' && {
            providerOptions: buildAnthropicProviderOptions('chat'),
          }),
          experimental_context: compactionContext,
        }
      }

      case 'docs': {
        const stepBudget = callOptions.maxSteps ?? 40
        compactionContext.maxSteps = stepBudget

        return {
          ...baseCallArgs,
          model: wrappedModel,
          instructions: buildDocsPrompt({
            docType: callOptions.docType,
            repoContext: callOptions.repoContext,
            structuralIndex: callOptions.structuralIndex,
            targetFile: callOptions.targetFile,
            stepBudget,
            model,
            activeSkills: callOptions.activeSkills,
          }),
          stopWhen: stepCountIs(stepBudget),
          ...(compactionEnabled && provider === 'anthropic' && {
            providerOptions: buildAnthropicProviderOptions('docs'),
          }),
          experimental_context: compactionContext,
        }
      }

      case 'changelog': {
        const stepBudget = callOptions.maxSteps ?? 40
        compactionContext.maxSteps = stepBudget

        return {
          ...baseCallArgs,
          model: wrappedModel,
          instructions: buildChangelogPrompt({
            changelogType: callOptions.changelogType,
            repoContext: callOptions.repoContext,
            structuralIndex: callOptions.structuralIndex,
            fromRef: callOptions.fromRef,
            toRef: callOptions.toRef,
            commitData: callOptions.commitData,
            stepBudget,
            model,
            activeSkills: callOptions.activeSkills,
          }),
          stopWhen: stepCountIs(stepBudget),
          ...(compactionEnabled && provider === 'anthropic' && {
            providerOptions: buildAnthropicProviderOptions('changelog'),
          }),
          experimental_context: compactionContext,
        }
      }
    }
  }
}
