import * as z from 'zod'
import { SKILL_ID_SCHEMA } from '@/lib/ai/skills/types'

const providerSchema = z.enum(['openai', 'google', 'anthropic', 'openrouter'])

const repoContextSchema = z.object({
  name: z.string(),
  description: z.string(),
  structure: z.string().max(200_000),
})

const baseFields = {
  provider: providerSchema,
  model: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:\/-]*$/),
  apiKey: z.string().min(1).max(500),
  compactionEnabled: z.boolean().optional(),
}

const chatOptionsSchema = z.object({
  ...baseFields,
  mode: z.literal('chat'),
  repoContext: repoContextSchema.optional(),
  structuralIndex: z.string().max(500_000).optional(),
  pinnedContext: z.string().max(200_000).optional(),
  maxSteps: z.number().int().min(10).max(100).optional(),
  activeSkills: z.array(SKILL_ID_SCHEMA).max(10).optional(),
})

const docsOptionsSchema = z.object({
  ...baseFields,
  mode: z.literal('docs'),
  docType: z.enum(['architecture', 'setup', 'api-reference', 'file-explanation', 'onboarding', 'custom']),
  repoContext: repoContextSchema,
  structuralIndex: z.string().max(500_000).optional(),
  targetFile: z.string().nullish(),
  maxSteps: z.number().int().min(10).max(80).optional(),
})

const changelogOptionsSchema = z.object({
  ...baseFields,
  mode: z.literal('changelog'),
  changelogType: z.enum(['conventional', 'release-notes', 'keep-a-changelog', 'custom']),
  repoContext: repoContextSchema,
  structuralIndex: z.string().max(500_000).optional(),
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  commitData: z.string().max(500_000),
  maxSteps: z.number().int().min(10).max(80).optional(),
})

export const callOptionsSchema = z.discriminatedUnion('mode', [
  chatOptionsSchema,
  docsOptionsSchema,
  changelogOptionsSchema,
])

export type CallOptions = z.infer<typeof callOptionsSchema>
