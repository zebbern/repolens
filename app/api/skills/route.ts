import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { skillRegistry } from '@/lib/ai/skills/registry'
import { applyRateLimit } from '@/lib/api/rate-limit'

export async function GET(request: NextRequest) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  const skills = skillRegistry.listSkills()

  return NextResponse.json({ skills })
}
