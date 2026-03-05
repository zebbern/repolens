"use client"

import { useMemo } from "react"
import { LogIn, User } from "lucide-react"
import { signIn } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { GitHubCommit } from "@/types/repository"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// AuthorAvatar
// ---------------------------------------------------------------------------

interface AuthorAvatarProps {
  login: string | null
  avatarUrl: string | null
  name: string
  size?: number
}

export function AuthorAvatar({ login, avatarUrl, name, size = 24 }: AuthorAvatarProps) {
  const initials = name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={login ?? name}
        width={size}
        height={size}
        className="rounded-full shrink-0"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    )
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {initials || <User className="h-3 w-3" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitMessage
// ---------------------------------------------------------------------------

interface CommitMessageProps {
  message: string
  maxLength?: number
}

export function CommitMessage({ message, maxLength = 72 }: CommitMessageProps) {
  const headline = message.split('\n')[0]
  const isTruncated = headline.length > maxLength

  if (!isTruncated) {
    return <span className="truncate text-sm">{headline}</span>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate text-sm">
            {headline.slice(0, maxLength)}…
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap">
          {message}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// DiffStats
// ---------------------------------------------------------------------------

interface DiffStatsProps {
  additions: number
  deletions: number
}

export function DiffStats({ additions, deletions }: DiffStatsProps) {
  return (
    <span className="flex items-center gap-1 text-xs font-mono shrink-0">
      {additions > 0 && (
        <span className="text-green-600 dark:text-green-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FileStatusBadge
// ---------------------------------------------------------------------------

interface FileStatusBadgeProps {
  status: string
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  added: { label: 'A', variant: 'default' },
  removed: { label: 'D', variant: 'destructive' },
  modified: { label: 'M', variant: 'secondary' },
  renamed: { label: 'R', variant: 'outline' },
  copied: { label: 'C', variant: 'outline' },
  changed: { label: 'C', variant: 'secondary' },
  unchanged: { label: 'U', variant: 'outline' },
}

export function FileStatusBadge({ status }: FileStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status[0]?.toUpperCase() ?? '?', variant: 'outline' as const }
  return (
    <Badge variant={config.variant} className="text-[10px] px-1.5 py-0 h-5 shrink-0">
      {config.label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// AgeIndicator
// ---------------------------------------------------------------------------

interface AgeIndicatorProps {
  age: number
}

/**
 * Maps a GitHub blame age (0 = newest, 10 = oldest) to a hue.
 * Recent commits → green (120°), old commits → blue (240°).
 */
function ageToColor(age: number): string {
  const clamped = Math.max(0, Math.min(10, age))
  const hue = 120 + (clamped / 10) * 120 // 120 (green) → 240 (blue)
  return `hsl(${hue}, 60%, 50%)`
}

export function AgeIndicator({ age }: AgeIndicatorProps) {
  return (
    <div
      className="w-2 h-full min-h-[20px] rounded-sm shrink-0"
      style={{ backgroundColor: ageToColor(age) }}
      aria-label={`Commit age: ${age}`}
    />
  )
}

export { ageToColor }

// ---------------------------------------------------------------------------
// RelativeDate
// ---------------------------------------------------------------------------

interface RelativeDateProps {
  date: string
}

export function RelativeDate({ date }: RelativeDateProps) {
  const formatted = useMemo(() => formatRelativeDate(date), [date])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={date} className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatted}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          {new Date(date).toLocaleString()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function formatRelativeDate(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffWeek < 5) return `${diffWeek}w ago`
  if (diffMonth < 12) return `${diffMonth}mo ago`
  return `${diffYear}y ago`
}

// ---------------------------------------------------------------------------
// LoginRequiredNotice
// ---------------------------------------------------------------------------

export function LoginRequiredNotice() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <LogIn className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Login to view blame data</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Blame information requires GitHub authentication via the GraphQL API.
        </p>
      </div>
      <Button onClick={() => signIn("github")} variant="default" size="sm">
        <LogIn className="h-4 w-4 mr-2" />
        Sign in with GitHub
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommitRow — shared commit row used by timeline and file history
// ---------------------------------------------------------------------------

interface CommitRowProps {
  commit: GitHubCommit
  onSelect: (sha: string) => void
}

export function CommitRow({ commit, onSelect }: CommitRowProps) {
  return (
    <button
      key={commit.sha}
      type="button"
      className="flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/60 transition-colors group"
      onClick={() => onSelect(commit.sha)}
    >
      <AuthorAvatar
        login={commit.authorLogin}
        avatarUrl={commit.authorAvatarUrl}
        name={commit.authorName}
        size={24}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <CommitMessage message={commit.message} />
        <span className="text-[11px] text-muted-foreground">
          {commit.authorName}
        </span>
      </div>
      <RelativeDate date={commit.authorDate} />
      {commit.parents.length > 1 && (
        <span className="text-[10px] text-muted-foreground/70 bg-muted rounded px-1">
          merge
        </span>
      )}
    </button>
  )
}
