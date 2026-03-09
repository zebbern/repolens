"use client"

import { useState } from 'react'
import {
  History, ListChecks, FileText, Scroll, MessageSquare, Loader2,
} from 'lucide-react'
import { isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { getAssistantText, type ChangelogType } from '@/providers/changelog-provider'

// ---------------------------------------------------------------------------
// Icon mapping for changelog presets (kept in the UI layer)
// ---------------------------------------------------------------------------

const CHANGELOG_PRESET_ICONS: Record<ChangelogType, React.ReactNode> = {
  'conventional':     <ListChecks className="h-5 w-5" />,
  'release-notes':    <Scroll className="h-5 w-5" />,
  'keep-a-changelog': <FileText className="h-5 w-5" />,
  'custom':           <MessageSquare className="h-5 w-5" />,
}

export function getPresetIcon(id: ChangelogType): React.ReactNode {
  return CHANGELOG_PRESET_ICONS[id] ?? <History className="h-5 w-5" />
}

// ---------------------------------------------------------------------------
// Quality levels
// ---------------------------------------------------------------------------

export type QualityLevel = 'fast' | 'balanced' | 'thorough'

export const QUALITY_STEPS: Record<QualityLevel, number> = {
  fast: 20,
  balanced: 40,
  thorough: 60,
}

// ---------------------------------------------------------------------------
// Ref source type: tags or branches
// ---------------------------------------------------------------------------

export type RefSource = 'tags' | 'branches'

// ---------------------------------------------------------------------------
// ChangelogToolActivity — shows AI reading progress during generation
// ---------------------------------------------------------------------------

export function ChangelogToolActivity({ messages }: { messages: UIMessage[] }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toolCalls: { name: string; path?: string; state: string }[] = []
  const hasText = messages.some(m =>
    m.role === 'assistant' && m.parts?.some(p => p.type === 'text' && p.text.trim().length > 0),
  )

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts || []) {
      if (isToolUIPart(part)) {
        const input = (part.input as Record<string, unknown> | undefined) ?? {}
        toolCalls.push({
          name: getToolName(part),
          path: (input.path as string) || (input.query as string) || undefined,
          state: part.state,
        })
      }
    }
  }

  if (toolCalls.length === 0 && !hasText) {
    return (
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
        <span className="text-sm text-text-secondary">Starting changelog generation...</span>
      </div>
    )
  }

  const isStillReading = toolCalls.length > 0 && toolCalls.some(t => t.state !== 'output-available' && t.state !== 'output-error')
  const readFiles = toolCalls.filter(t => t.name === 'readFile' && t.path)
  const searches = toolCalls.filter(t => t.name === 'searchFiles')
  const COLLAPSED_LIMIT = 5
  const visibleFiles = isExpanded ? readFiles : readFiles.slice(-COLLAPSED_LIMIT)
  const hasMoreFiles = readFiles.length > COLLAPSED_LIMIT

  return (
    <div className="mb-4">
      {(isStillReading || !hasText) && (
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
          <span className="text-sm text-text-secondary">
            {hasText ? 'Writing changelog...' : isStillReading ? 'Reading codebase...' : 'Analyzing...'}
          </span>
        </div>
      )}
      {toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {readFiles.length > 0 && (
            <span className="text-[10px] text-text-muted px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              Read {readFiles.length} files
            </span>
          )}
          {searches.length > 0 && (
            <span className="text-[10px] text-text-muted px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
              {searches.length} searches
            </span>
          )}
          {visibleFiles.map((t, i) => (
            <span key={i} className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-foreground/3 border border-foreground/6">
              {t.path?.split('/').slice(-2).join('/') || t.path}
            </span>
          ))}
          {hasMoreFiles && (
            <button
              onClick={() => setIsExpanded(prev => !prev)}
              aria-expanded={isExpanded}
              className="text-[10px] text-text-muted hover:text-text-secondary px-2 py-0.5 rounded bg-foreground/3 border border-foreground/6 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
            >
              {isExpanded ? 'Show less' : `Show all ${readFiles.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChangelogMarkdownContent — renders assistant text as markdown
// ---------------------------------------------------------------------------

export function ChangelogMarkdownContent({ messages }: { messages: UIMessage[] }) {
  const text = getAssistantText(messages)
  if (!text) return null
  return <MarkdownRenderer content={text} />
}
