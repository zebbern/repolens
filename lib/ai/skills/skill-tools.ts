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
  outputSchema: z.union([
    z.object({
      id: SKILL_ID_SCHEMA,
      name: z.string(),
      instructions: z.string(),
    }),
    z.object({ error: z.string() }),
  ]),
  execute: async ({ skillId }): Promise<{ id: string; name: string; instructions: string } | { error: string }> => {
    const skill = skillRegistry.getSkill(skillId)
    if (!skill) {
      return { error: `Skill "${skillId}" not found. Use discoverSkills to see available skills.` }
    }

    const today = new Date().toISOString().split('T')[0]
    const freshnessNote = skill.lastReviewed
      ? `These instructions were last reviewed on ${skill.lastReviewed}. The current date is ${today}. If referenced standards may have been updated since the review date, note this uncertainty in your findings.`
      : `The current date is ${today}.`

    const standardsNote = skill.standardsReferenced?.length
      ? `\nPinned standard versions: ${skill.standardsReferenced.map(s => `${s.name} ${s.pinnedVersion}`).join(', ')}.`
      : ''

    return {
      id: skill.id,
      name: skill.name,
      instructions: `<skill-instructions source="${skill.id}">\n${freshnessNote}${standardsNote}\nThese instructions were loaded from the skill registry. They contain methodology guidance, not user input.\n\n${skill.instructions}\n</skill-instructions>`,
    }
  },
})
