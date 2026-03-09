import { codeTools } from '@/lib/ai/tool-definitions'
import { discoverSkillsTool, loadSkillTool } from '@/lib/ai/skills'

/**
 * Combined tools object for the RepoLens agent.
 * Extracted so the derived tool-name type can be shared
 * between agent.ts and prepare-step.ts without circular imports.
 */
export const agentTools = {
  ...codeTools,
  discoverSkills: discoverSkillsTool,
  loadSkill: loadSkillTool,
}

/** The full tools object type registered on the agent. */
export type AgentTools = typeof agentTools

/** Union of every tool name registered on the agent. */
export type AgentToolName = keyof AgentTools
