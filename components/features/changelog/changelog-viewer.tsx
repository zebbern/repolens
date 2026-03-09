"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  History, AlertCircle, Trash2, Plus, Download,
  RefreshCw, ClipboardCopy, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAPIKeys, useRepositoryData, useChangelog } from '@/providers'
import { downloadFile } from '@/lib/export'
import {
  CHANGELOG_PRESETS,
  getAssistantText,
  type GeneratedChangelog,
} from '@/providers/changelog-provider'
import { useChangelogEngine } from '@/hooks/use-changelog-engine'
import { fetchTagsViaProxy, fetchBranchesViaProxy, fetchCompareViaProxy } from '@/lib/github/client'
import type { GitHubTag, GitHubBranch } from '@/types/repository'
import {
  getPresetIcon,
  ChangelogMarkdownContent,
  QUALITY_STEPS,
  type QualityLevel,
  type RefSource,
} from './changelog-helpers'
import { NewChangelogView } from './new-changelog-view'
import { SkillSelector } from '@/components/features/chat/skill-selector'

interface ChangelogViewerProps {
  className?: string
}

export function ChangelogViewer({ className }: ChangelogViewerProps) {
  const { selectedModel, getValidProviders } = useAPIKeys()
  const { repo } = useRepositoryData()
  const { activeChangelogId, setActiveChangelogId, showNewChangelog, setShowNewChangelog } = useChangelog()
  const {
    generatedChangelogs, messages, status, error,
    isGenerating, stop, handleGenerate, handleRegenerate, handleDeleteChangelog,
  } = useChangelogEngine()

  const hasValidKey = getValidProviders().length > 0 && selectedModel

  // --- Local UI state ---
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [refSource, setRefSource] = useState<RefSource>('tags')
  const [fromRef, setFromRef] = useState('')
  const [toRef, setToRef] = useState('')
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>('balanced')
  const [activeSkills, setActiveSkills] = useState<Set<string>>(new Set())

  const handleSkillToggle = useCallback((skillId: string) => {
    setActiveSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }, [])

  // --- Tags/Branches fetching ---
  const [tags, setTags] = useState<GitHubTag[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [refsLoading, setRefsLoading] = useState(false)
  const [refsError, setRefsError] = useState<string | null>(null)
  const [commitFetchError, setCommitFetchError] = useState<string | null>(null)
  const [isFetchingCommits, setIsFetchingCommits] = useState(false)

  const isMobile = useIsMobile()
  const activeChangelog = generatedChangelogs.find(c => c.id === activeChangelogId)
  const contentRef = useRef<HTMLDivElement>(null)

  // Fetch tags and branches when repo changes
  useEffect(() => {
    if (!repo) return
    let cancelled = false
    setRefsLoading(true)
    setRefsError(null)

    Promise.all([
      fetchTagsViaProxy(repo.owner, repo.name, 100).catch(() => [] as GitHubTag[]),
      fetchBranchesViaProxy(repo.owner, repo.name, 100).catch(() => [] as GitHubBranch[]),
    ]).then(([fetchedTags, fetchedBranches]) => {
      if (cancelled) return
      setTags(fetchedTags)
      setBranches(fetchedBranches)
      if (fetchedTags.length === 0 && fetchedBranches.length === 0) {
        setRefsError('No tags or branches found for this repository.')
      }
      // Auto-select first two tags if available
      if (fetchedTags.length >= 2) {
        setFromRef(fetchedTags[1].name)
        setToRef(fetchedTags[0].name)
        setRefSource('tags')
      } else if (fetchedBranches.length >= 1) {
        setRefSource('branches')
        const main = fetchedBranches.find(b => b.name === 'main' || b.name === 'master')
        if (main) {
          setToRef(main.name)
          const other = fetchedBranches.find(b => b.name !== main.name)
          if (other) setFromRef(other.name)
        }
      }
      setRefsLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setRefsError(err instanceof Error ? err.message : 'Failed to load refs')
      setRefsLoading(false)
    })
    return () => { cancelled = true }
  }, [repo])

  // Auto-scroll during streaming
  useEffect(() => {
    if (isGenerating && contentRef.current) {
      const el = contentRef.current
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      if (isNearBottom) el.scrollTop = el.scrollHeight
    }
  }, [messages, isGenerating])

  const refOptions = useMemo(() => {
    if (refSource === 'tags') return tags.map(t => ({ label: t.name, value: t.name }))
    return branches.map(b => ({ label: b.name, value: b.name }))
  }, [refSource, tags, branches])

  // --- Handlers ---
  const onGenerate = async (preset: (typeof CHANGELOG_PRESETS)[number]) => {
    if (!hasValidKey || !repo || !fromRef || !toRef) return
    if (preset.id === 'custom' && !customPrompt.trim()) { setSelectedPreset('custom'); return }

    setSelectedPreset(preset.id)
    setCommitFetchError(null)
    setIsFetchingCommits(true)
    try {
      const comparison = await fetchCompareViaProxy(repo.owner, repo.name, fromRef, toRef)
      const commitSummary = comparison.commits
        .map(c => `- ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]} (${c.authorName})`)
        .join('\n')
      const commitData = [
        `## Comparison: ${fromRef}...${toRef}`,
        `Total commits: ${comparison.totalCommits}`,
        `Files changed: ${comparison.files.length}`,
        '', '### Commits', commitSummary, '',
        '### Files Changed',
        comparison.files.map(f => `- ${f.status} ${f.filename} (+${f.additions} -${f.deletions})`).join('\n'),
      ].join('\n')
      setIsFetchingCommits(false)
      handleGenerate(preset, fromRef, toRef, customPrompt, commitData, QUALITY_STEPS[qualityLevel], Array.from(activeSkills))
    } catch (err) {
      setIsFetchingCommits(false)
      setCommitFetchError(err instanceof Error ? err.message : 'Failed to fetch commit data for the selected range.')
    }
  }

  const onRegenerate = (changelog: GeneratedChangelog) => {
    if (changelog.fromRef) setFromRef(changelog.fromRef)
    if (changelog.toRef) setToRef(changelog.toRef)
    setCustomPrompt(changelog.customPrompt || '')
    setSelectedPreset(changelog.type)
    handleRegenerate(changelog)
  }

  const handleCopyToClipboard = () => {
    if (!activeChangelog) return
    navigator.clipboard.writeText(getAssistantText(activeChangelog.messages))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => console.warn('Failed to copy to clipboard'))
  }

  // --- Empty states ---
  if (!repo) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="flex flex-col items-center gap-4 text-text-muted animate-in fade-in duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
            <History className="h-6 w-6 text-text-secondary" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-text-secondary">No repository connected</p>
            <p className="text-xs text-center max-w-[260px]">Connect a GitHub repository to generate changelogs between tags, branches, or commits</p>
          </div>
        </div>
      </div>
    )
  }
  if (!hasValidKey) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-status-warning/10 border border-status-warning/20">
            <AlertCircle className="h-6 w-6 text-status-warning" />
          </div>
          <div className="flex flex-col items-center gap-1 text-center max-w-sm">
            <p className="text-sm font-medium text-text-secondary">API key required</p>
            <p className="text-xs text-text-muted">Add an API key in Settings and select a model to generate changelogs with AI.</p>
          </div>
        </div>
      </div>
    )
  }

  // --- Sidebar handlers ---
  const handleChangelogClick = (id: string) => {
    if (isGenerating) return
    setActiveChangelogId(id)
    setShowNewChangelog(false)
    if (isMobile) setSidebarOpen(false)
  }
  const handleNewClick = () => {
    setShowNewChangelog(true)
    setActiveChangelogId(null)
    setSelectedPreset(null)
    if (isMobile) setSidebarOpen(false)
  }

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-3 h-10 border-b border-foreground/[0.06] shrink-0">
        <span className="text-xs font-medium text-text-secondary">Generated Changelogs</span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-text-muted hover:text-text-primary px-1.5" onClick={handleNewClick} disabled={isGenerating} title="New changelog">
          <Plus className="h-3.5 w-3.5" /><span className="text-[10px]">New</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {generatedChangelogs.length === 0 && (
          <p className="text-[10px] text-text-muted px-3 py-4 text-center">No changelogs generated yet. Select a range and preset to get started.</p>
        )}
        {generatedChangelogs.map(cl => (
          <div key={cl.id} role="button" tabIndex={isGenerating ? -1 : 0} aria-disabled={isGenerating || undefined}
            onClick={() => handleChangelogClick(cl.id)}
            onKeyDown={e => { if (isGenerating) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleChangelogClick(cl.id) } }}
            className={cn(
              'w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-foreground/5 transition-colors group cursor-pointer',
              activeChangelogId === cl.id && 'bg-foreground/[0.07]',
              isGenerating && 'pointer-events-none opacity-50',
            )}>
            <span className="text-text-muted shrink-0 mt-0.5">{getPresetIcon(cl.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-secondary truncate group-hover:text-text-primary">{cl.title}</p>
              <p className="text-[10px] text-text-muted">{cl.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button onClick={e => e.stopPropagation()} aria-label="Delete changelog"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded shrink-0 text-text-muted hover:text-red-400 transition-all">
                  <Trash2 className="h-3 w-3" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this changelog?</AlertDialogTitle>
                  <AlertDialogDescription>This will permanently remove this generated changelog.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDeleteChangelog(cl.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </>
  )

  return (
    <div className={cn('flex h-full', className)}>
      {!isMobile && <div className="w-56 border-r border-foreground/[0.06] flex flex-col shrink-0">{sidebarContent}</div>}
      <div className="flex-1 flex flex-col min-w-0">
        {showNewChangelog || !activeChangelog ? (
          <NewChangelogView
            contentRef={contentRef} isMobile={isMobile} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
            sidebarContent={sidebarContent} isGenerating={isGenerating} isFetchingCommits={isFetchingCommits}
            messages={messages} stop={stop} selectedModel={selectedModel}
            refSource={refSource} setRefSource={setRefSource} tags={tags} branches={branches}
            refsLoading={refsLoading} refsError={refsError} refOptions={refOptions}
            fromRef={fromRef} setFromRef={setFromRef} toRef={toRef} setToRef={setToRef}
            qualityLevel={qualityLevel} setQualityLevel={setQualityLevel}
            activeSkills={activeSkills} onSkillToggle={handleSkillToggle}
            commitFetchError={commitFetchError} error={error}
            selectedPreset={selectedPreset} setSelectedPreset={setSelectedPreset}
            customPrompt={customPrompt} setCustomPrompt={setCustomPrompt}
            onGenerate={onGenerate}
          />
        ) : (
          <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-foreground/[0.06]">
                {getPresetIcon(activeChangelog.type)}
                <h1 className="text-lg font-semibold text-text-primary flex-1">{activeChangelog.title}</h1>
                {activeChangelog.fromRef && activeChangelog.toRef && (
                  <code className="text-[10px] text-text-muted bg-foreground/[0.04] px-1.5 py-0.5 rounded">{activeChangelog.fromRef}...{activeChangelog.toRef}</code>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-text-muted hover:text-text-primary shrink-0"
                  title="Regenerate" aria-label="Regenerate this changelog" onClick={() => onRegenerate(activeChangelog)} disabled={isGenerating}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-text-muted hover:text-text-primary shrink-0"
                  title="Copy to clipboard" aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'} onClick={handleCopyToClipboard}>
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <ClipboardCopy className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-text-muted hover:text-text-primary shrink-0"
                  title="Export as Markdown" aria-label="Export as Markdown"
                  onClick={() => downloadFile({ content: getAssistantText(activeChangelog.messages), filename: `changelog-${activeChangelog.fromRef || 'unknown'}..${activeChangelog.toRef || 'HEAD'}.md`, mimeType: 'text/markdown' })}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
              <div className="prose prose-invert max-w-none">
                <ChangelogMarkdownContent messages={activeChangelog.messages} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
