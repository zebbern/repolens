import { z } from 'zod'

export const SKILL_ID_SCHEMA = z.string().regex(/^[a-z0-9-]+$/).max(50)

export interface SkillDefinition {
  id: string
  name: string
  description: string
  trigger: string
  relatedTools: string[]
  instructions: string
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  trigger: string
  relatedTools: string[]
}
