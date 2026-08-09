import { agentTools } from './agent-tools'

/** Named per-route tool sets used to validate replayed AI SDK UI tool parts. */
export const AGENT_ROUTE_TOOLS = {
  chat: agentTools,
  docs: agentTools,
  changelog: agentTools,
} as const
