import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'
import { SKILL_ID_SCHEMA, type SkillDefinition, type SkillSummary } from './types'

const DEFINITIONS_DIR = path.join(process.cwd(), 'lib', 'ai', 'skills', 'definitions')

const frontmatterSchema = z.object({
  id: SKILL_ID_SCHEMA,
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  trigger: z.string().min(1).max(500),
  relatedTools: z.array(z.string().min(1)).min(1),
})

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>()
  private loaded = false

  ensureLoaded(): void {
    if (this.loaded) return

    const definitionsDir = path.resolve(DEFINITIONS_DIR)

    let files: string[]
    try {
      files = fs.readdirSync(definitionsDir).filter((f) => f.endsWith('.md'))
    } catch {
      this.loaded = true
      return
    }

    for (const file of files) {
      const filePath = path.resolve(definitionsDir, file)

      // Path traversal prevention: resolved path must stay within definitions dir
      if (!filePath.startsWith(definitionsDir + path.sep) && filePath !== definitionsDir) {
        continue
      }

      const raw = fs.readFileSync(filePath, 'utf-8')
      const { data, content } = matter(raw)

      const parsed = frontmatterSchema.safeParse(data)
      if (!parsed.success) {
        console.error(`Skill file ${file} has invalid frontmatter: ${parsed.error.message}`)
        continue
      }

      const { id, name, description, trigger, relatedTools } = parsed.data

      this.skills.set(id, {
        id,
        name,
        description,
        trigger,
        relatedTools,
        instructions: content.trim(),
      })
    }

    this.loaded = true
  }

  getSkill(id: string): SkillDefinition | null {
    const validation = SKILL_ID_SCHEMA.safeParse(id)
    if (!validation.success) return null

    this.ensureLoaded()
    return this.skills.get(id) ?? null
  }

  listSkills(): SkillSummary[] {
    this.ensureLoaded()
    return Array.from(this.skills.values()).map(({ id, name, description, trigger, relatedTools }) => ({
      id,
      name,
      description,
      trigger,
      relatedTools,
    }))
  }
}

export const skillRegistry = new SkillRegistry()
