"use client"

import type { ReactNode, RefObject } from 'react'
import {
  AlertCircle, ArrowRight, ChevronDown, GitBranch,
  Loader2, Menu, Sparkles, Square, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { UIMessage } from 'ai'
import { CHANGELOG_PRESETS, type ChangelogType } from '@/providers/changelog-provider'
import type { GitHubTag, GitHubBranch } from '@/types/repository'
import type { ProviderModel } from '@/types/types'
import {
  getPresetIcon, ChangelogToolActivity, ChangelogMarkdownContent,
  type QualityLevel, type RefSource,
} from './changelog-helpers'
import { SkillSelector } from '@/components/features/chat/skill-selector'

interface NewChangelogViewProps {
  contentRef: RefObject<HTMLDivElement | null>
  isMobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  sidebarContent: ReactNode
  isGenerating: boolean
  isFetchingCommits: boolean
  messages: UIMessage[]
  stop: () => void
  selectedModel: ProviderModel | null
  refSource: RefSource
  setRefSource: (source: RefSource) => void
  tags: GitHubTag[]
  branches: GitHubBranch[]
  refsLoading: boolean
  refsError: string | null
  refOptions: { label: string; value: string }[]
  fromRef: string
  setFromRef: (ref: string) => void
  toRef: string
  setToRef: (ref: string) => void
  qualityLevel: QualityLevel
  setQualityLevel: (level: QualityLevel) => void
  activeSkills: Set<string>
  onSkillToggle: (skillId: string) => void
  commitFetchError: string | null
  error: Error | null | undefined
  selectedPreset: string | null
  setSelectedPreset: (preset: string | null) => void
  customPrompt: string
  setCustomPrompt: (prompt: string) => void
  onGenerate: (preset: (typeof CHANGELOG_PRESETS)[number]) => void
}

export function NewChangelogView(props: NewChangelogViewProps) {
  const {
    contentRef, isMobile, sidebarOpen, setSidebarOpen, sidebarContent,
    isGenerating, isFetchingCommits, messages, stop, selectedModel,
    refSource, setRefSource, tags, branches, refsLoading, refsError, refOptions,
    fromRef, setFromRef, toRef, setToRef,
    qualityLevel, setQualityLevel,
    activeSkills, onSkillToggle,
    commitFetchError, error, selectedPreset, setSelectedPreset,
    customPrompt, setCustomPrompt, onGenerate,
  } = props

  const showStreaming = (isGenerating || isFetchingCommits) && messages.length > 0

  return (
    <div ref={isGenerating ? contentRef : undefined} className="flex-1 overflow-y-auto flex flex-col">
      {isMobile && (
        <div className="flex items-center gap-2 px-4 h-10 border-b border-foreground/[0.06] shrink-0">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-text-muted hover:text-text-primary" aria-label="Open changelog sidebar">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 flex flex-col">
              <SheetHeader className="sr-only"><SheetTitle>Changelog Sidebar</SheetTitle></SheetHeader>
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <span className="text-xs text-text-secondary font-medium">Changelog</span>
        </div>
      )}

      {showStreaming ? (
        <div className="p-6 max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <ChangelogToolActivity messages={messages} />
            <Button variant="outline" size="sm" onClick={stop} className="h-7 text-xs gap-1.5 shrink-0 text-text-secondary hover:text-text-primary">
              <Square className="h-3 w-3" />Stop
            </Button>
          </div>
          <div className="prose prose-invert max-w-none"><ChangelogMarkdownContent messages={messages} /></div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
          <div className="w-full max-w-xl">
            <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">Generate Changelog</h2>
            {selectedModel && (
              <p className="text-[11px] text-text-muted text-center mb-1 flex items-center justify-center gap-1">
                <Sparkles className="h-3 w-3" />Using {selectedModel.name}
              </p>
            )}
            <p className="text-xs text-text-muted text-center mb-6">AI reads your commit history and generates a formatted changelog.</p>

            <RefRangeSelector refSource={refSource} setRefSource={setRefSource} tags={tags} branches={branches}
              refsLoading={refsLoading} refsError={refsError} refOptions={refOptions}
              fromRef={fromRef} setFromRef={setFromRef} toRef={toRef} setToRef={setToRef} />
            <QualitySelector qualityLevel={qualityLevel} setQualityLevel={setQualityLevel}
              activeSkills={activeSkills} onSkillToggle={onSkillToggle} />
            <ErrorDisplays commitFetchError={commitFetchError} error={error}
              isGenerating={isGenerating} selectedPreset={selectedPreset} onGenerate={onGenerate} />
            <PresetPicker isGenerating={isGenerating} isFetchingCommits={isFetchingCommits}
              fromRef={fromRef} toRef={toRef} selectedPreset={selectedPreset} setSelectedPreset={setSelectedPreset}
              customPrompt={customPrompt} setCustomPrompt={setCustomPrompt} onGenerate={onGenerate} />
          </div>
        </div>
      )}
    </div>
  )
}

function RefRangeSelector({ refSource, setRefSource, tags, branches, refsLoading, refsError, refOptions, fromRef, setFromRef, toRef, setToRef }: {
  refSource: RefSource; setRefSource: (s: RefSource) => void; tags: GitHubTag[]; branches: GitHubBranch[]
  refsLoading: boolean; refsError: string | null; refOptions: { label: string; value: string }[]
  fromRef: string; setFromRef: (r: string) => void; toRef: string; setToRef: (r: string) => void
}) {
  return (
    <div className="mb-4 rounded-lg border border-foreground/[0.06] bg-foreground/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-text-secondary">Range</span>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant={refSource === 'tags' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] px-2 gap-1"
            onClick={() => setRefSource('tags')} disabled={tags.length === 0}>
            <Tag className="h-3 w-3" />Tags
          </Button>
          <Button variant={refSource === 'branches' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] px-2 gap-1"
            onClick={() => setRefSource('branches')} disabled={branches.length === 0}>
            <GitBranch className="h-3 w-3" />Branches
          </Button>
        </div>
      </div>
      {refsLoading ? (
        <div className="flex items-center gap-2 py-3 justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" /><span className="text-xs text-text-muted">Loading refs...</span>
        </div>
      ) : refsError && refOptions.length === 0 ? (
        <div className="flex items-center gap-2 py-3">
          <AlertCircle className="h-4 w-4 text-status-warning shrink-0" /><span className="text-xs text-text-muted">{refsError}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-muted mb-1 block">From</label>
            <Select value={fromRef} onValueChange={setFromRef}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select start ref" /></SelectTrigger>
              <SelectContent>{refOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted shrink-0 mt-4" />
          <div className="flex-1">
            <label className="text-[10px] text-text-muted mb-1 block">To</label>
            <Select value={toRef} onValueChange={setToRef}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select end ref" /></SelectTrigger>
              <SelectContent>{refOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

function QualitySelector({ qualityLevel, setQualityLevel, activeSkills, onSkillToggle }: {
  qualityLevel: QualityLevel; setQualityLevel: (l: QualityLevel) => void
  activeSkills: Set<string>; onSkillToggle: (skillId: string) => void
}) {
  return (
    <div className="flex items-center justify-center gap-4 text-sm mb-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Quality:</span>
        <Select value={qualityLevel} onValueChange={(v) => setQualityLevel(v as QualityLevel)}>
          <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast (20 steps)</SelectItem>
            <SelectItem value="balanced">Balanced (40)</SelectItem>
            <SelectItem value="thorough">Thorough (60)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <SkillSelector activeSkills={activeSkills} onToggle={onSkillToggle} />
    </div>
  )
}

function ErrorDisplays({ commitFetchError, error, isGenerating, selectedPreset, onGenerate }: {
  commitFetchError: string | null; error: Error | null | undefined; isGenerating: boolean
  selectedPreset: string | null; onGenerate: (preset: (typeof CHANGELOG_PRESETS)[number]) => void
}) {
  if (!commitFetchError && !(error && !isGenerating)) return null
  return (
    <>
      {commitFetchError && (
        <div role="alert" className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" /><span className="text-sm text-destructive">{commitFetchError}</span>
          </div>
        </div>
      )}
      {error && !isGenerating && (
        <div role="alert" className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" /><span className="text-sm text-destructive">{error.message || 'An unexpected error occurred.'}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => onGenerate(CHANGELOG_PRESETS.find(p => p.id === selectedPreset) || CHANGELOG_PRESETS[0])} className="mt-2 h-7 text-xs">Try Again</Button>
        </div>
      )}
    </>
  )
}

function PresetPicker({ isGenerating, isFetchingCommits, fromRef, toRef, selectedPreset, setSelectedPreset, customPrompt, setCustomPrompt, onGenerate }: {
  isGenerating: boolean; isFetchingCommits: boolean; fromRef: string; toRef: string
  selectedPreset: string | null; setSelectedPreset: (p: string | null) => void
  customPrompt: string; setCustomPrompt: (p: string) => void
  onGenerate: (preset: (typeof CHANGELOG_PRESETS)[number]) => void
}) {
  const isDisabled = isGenerating || isFetchingCommits || !fromRef || !toRef
  return (
    <div className="flex flex-col gap-2">
      {CHANGELOG_PRESETS.map(preset => (
        <div key={preset.id}>
          <button onClick={() => preset.id === 'custom' ? setSelectedPreset('custom') : onGenerate(preset)} disabled={isDisabled}
            aria-pressed={selectedPreset === preset.id}
            className={cn(
              'w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left hover:bg-foreground/[0.03] hover:border-foreground/15',
              selectedPreset === preset.id ? 'border-foreground/20 bg-foreground/[0.04]' : 'border-foreground/[0.06] bg-foreground/[0.01]',
              isDisabled && 'opacity-50 pointer-events-none',
            )}>
            <span className="text-text-muted shrink-0">{getPresetIcon(preset.id as ChangelogType)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary font-medium">{preset.label}</p>
              <p className="text-[11px] text-text-muted leading-tight">{preset.description}</p>
            </div>
            {preset.id !== 'custom' && <ChevronDown className="h-4 w-4 text-text-muted shrink-0 -rotate-90" />}
          </button>
          {selectedPreset === 'custom' && preset.id === 'custom' && (
            <div className="mt-2 flex flex-col gap-2">
              <textarea autoFocus value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                placeholder="e.g. 'Focus on breaking changes', 'Write in Spanish'..." aria-label="Custom changelog prompt"
                className="w-full h-20 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-foreground/20"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && customPrompt.trim()) onGenerate(preset) }} />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">Ctrl+Enter to generate</span>
                <Button size="sm" onClick={() => onGenerate(preset)} disabled={isGenerating || isFetchingCommits || !customPrompt.trim() || !fromRef || !toRef} className="h-7 text-xs">
                  {isFetchingCommits ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Fetching...</> : 'Generate'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
