import { ToolLoopAgent } from 'ai'
import { createAIModel } from '@/lib/ai/providers'
import { agentTools } from './agent-tools'
import { callOptionsSchema, type CallOptions } from './options'
import { buildPrepareCall } from './prepare-call'
import { buildPrepareStep } from './prepare-step'

/**
 * The main RepoLens agent. Handles chat, docs, and changelog modes
 * through a single `ToolLoopAgent` with mode-based `prepareCall` dispatch.
 */
export const repoLensAgent = new ToolLoopAgent<CallOptions, typeof agentTools>({
  callOptionsSchema,
  tools: agentTools,
  // Required constructor parameter — always overridden by prepareCall per request
  model: createAIModel('openai', 'gpt-4o', 'placeholder'),
  prepareCall: buildPrepareCall(),
  // SDK limitation: NoInfer<TOOLS> on PrepareStepFunction prevents type resolution.
  // CORE_TOOLS and SKILL_TOOLS in prepare-step.ts are typed as AgentToolName[]
  // for compile-time safety on tool names.
  prepareStep: buildPrepareStep() as never,
  experimental_repairToolCall: async ({ toolCall, error }) => {
    console.warn(
      `[agent] tool-call repair skipped for "${toolCall.toolName}" (${error.constructor.name})`,
    )
    return null
  },
})
