import type { IssueSeverity, HealthGrade } from '@/lib/code/issue-scanner'
import type { CategoryFilterKey } from './issue-types'
import { Shield, AlertTriangle, Info, ShieldAlert, Wrench, Activity, Package, Network } from 'lucide-react'

export const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; color: string; bgColor: string; borderColor: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Critical', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20', icon: ShieldAlert },
  warning: { label: 'Warning', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20', icon: AlertTriangle },
  info: { label: 'Info', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/20', icon: Info },
}

export const CATEGORY_CONFIG: Record<CategoryFilterKey, { label: string; icon: typeof Shield }> = {
  'security': { label: 'Security', icon: Shield },
  'bad-practice': { label: 'Bad Practices', icon: Wrench },
  'reliability': { label: 'Reliability', icon: Activity },
  'supply-chain': { label: 'Supply Chain', icon: Package },
  'structural': { label: 'Structural', icon: Network },
}

export const GRADE_CONFIG: Record<HealthGrade, { color: string; bg: string; border: string; label: string }> = {
  A: { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Excellent' },
  B: { color: 'text-teal-700 dark:text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20', label: 'Good' },
  C: { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Fair' },
  D: { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'Poor' },
  F: { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Critical' },
}

export const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  'true-positive': { label: 'True Positive', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  'false-positive': { label: 'False Positive', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'uncertain': { label: 'Uncertain', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
}

export function getRiskScoreColor(score: number): { color: string; bg: string; border: string } {
  if (score >= 8.0) return { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' }
  if (score >= 5.0) return { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' }
  if (score >= 3.0) return { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' }
  return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }
}
