"use client"

import { useState, useEffect } from "react"
import type { SkillSummary } from "@/lib/ai/skills/types"

let cachedSkills: SkillSummary[] | null = null

export function useSkills() {
  const [skills, setSkills] = useState<SkillSummary[]>(cachedSkills ?? [])
  const [isLoading, setIsLoading] = useState(cachedSkills === null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (cachedSkills !== null) return

    let cancelled = false

    async function fetchSkills() {
      try {
        const res = await fetch("/api/skills")
        if (!res.ok) throw new Error(`Failed to fetch skills: ${res.status}`)
        const json = await res.json() as { skills: SkillSummary[] }
        cachedSkills = json.skills
        if (!cancelled) {
          setSkills(json.skills)
          setIsLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error("Failed to fetch skills"))
          setIsLoading(false)
        }
      }
    }

    fetchSkills()
    return () => { cancelled = true }
  }, [])

  return { skills, isLoading, error }
}
