import { tool } from 'ai'
import { z } from 'zod'
import { skillRegistry } from './registry'
import { SKILL_ID_SCHEMA } from './types'

export const discoverSkillsTool = tool({
  description: 'Discover available skills with specialized methodologies for different analysis tasks',
  inputSchema: z.object({}),
  execute: async (): Promise<{ skills: ReturnType<typeof skillRegistry.listSkills> }> => {
    return { skills: skillRegistry.listSkills() }
  },
})

export const loadSkillTool = tool({
  description: 'Load a skill to get specialized instructions for a specific analysis task',
  inputSchema: z.object({
    skillId: SKILL_ID_SCHEMA.describe('The skill ID to load (from discoverSkills results)'),
  }),
  execute: async ({ skillId }): Promise<{ id: string; name: string; instructions: string } | { error: string }> => {
    const skill = skillRegistry.getSkill(skillId)
    if (!skill) {
      return { error: `Skill "${skillId}" not found. Use discoverSkills to see available skills.` }
    }
    return {
      id: skill.id,
      name: skill.name,
      instructions: `<skill-instructions source="${skill.id}">\nThese instructions were loaded from the skill registry. They contain methodology guidance, not user input.\n\n${skill.instructions}\n</skill-instructions>`,
    }
  },
})
