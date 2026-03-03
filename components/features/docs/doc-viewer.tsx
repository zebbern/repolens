"use client"

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  FileText, Code, BookOpen, Rocket, FileCode, MessageSquare,
  Loader2, AlertCircle, Trash2, ChevronDown, Search, X, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAPIKeys, useRepository } from '@/providers'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { buildFileTreeString } from '@/lib/github/fetcher'
import { flattenFiles } from '@/lib/code/code-index'
import type { FileNode } from '@/types/repository'

type DocType = 'architecture' | 'setup' | 'api-reference' | 'file-explanation' | 'custom'

interface DocPreset {
  id: DocType
  label: string
  description: string
  icon: React.ReactNode
  prompt: string
}

const DOC_PRESETS: DocPreset[] = [
  {
    id: 'architecture',
    label: 'Architecture Overview',
    description: 'How the project is structured, modules, data flow, and design decisions',
    icon: <BookOpen className="h-5 w-5" />,
    prompt: 'Generate a comprehensive architecture overview for this codebase. Cover the high-level structure, key modules, data flow, and notable design decisions.',
  },
  {
    id: 'setup',
    label: 'Setup / Getting Started',
    description: 'Installation, configuration, and how to run the project locally',
    icon: <Rocket className="h-5 w-5" />,
    prompt: 'Generate a Getting Started guide for this project. Include prerequisites, installation steps, configuration (env vars, etc.), and how to run it locally.',
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    description: 'Exported functions, classes, types, and interfaces with signatures',
    icon: <Code className="h-5 w-5" />,
    prompt: 'Generate an API reference documenting all significant exported functions, classes, types, and interfaces. Include type signatures, parameter descriptions, and usage examples.',
  },
  {
    id: 'file-explanation',
    label: 'Explain a File',
    description: 'Deep explanation of a specific file -- purpose, logic, and how it fits',
    icon: <FileCode className="h-5 w-5" />,
    prompt: '', // set dynamically based on selected file
  },
  {
    id: 'custom',
    label: 'Custom Prompt',
    description: 'Ask the AI to generate any docs you need',
    icon: <MessageSquare className="h-5 w-5" />,
    prompt: '',
  },
]

interface GeneratedDoc {
  id: string
  type: DocType
  title: string
  messages: UIMessage[]
  createdAt: Date
  targetFile?: string
}

interface DocViewerProps {
  className?: string
}

export function DocViewer({ className }: DocViewerProps) {
  const { selectedModel, apiKeys, getValidProviders } = useAPIKeys()
  const { repo, files, codeIndex } = useRepository()

  const hasValidKey = getValidProviders().length > 0 && selectedModel

  // All generated docs
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // New doc generation state
  const [showNewDoc, setShowNewDoc] = useState(true)
  const [selectedPreset, setSelectedPreset] = useState<DocType | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [targetFile, setTargetFile] = useState<string | null>(null)
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [showFileSearch, setShowFileSearch] = useState(false)

  const activeDoc = generatedDocs.find(d => d.id === activeDocId)
  const contentRef = useRef<HTMLDivElement>(null)

  // Flatten files for file picker
  const allFiles = useMemo(() => files.length > 0 ? flattenFiles(files) : [], [files])
  const filteredFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return allFiles.slice(0, 20)
    const q = fileSearchQuery.toLowerCase()
    return allFiles.filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)).slice(0, 15)
  }, [allFiles, fileSearchQuery])

  // Repo context for AI -- includes file tree for orientation
  const repoContext = useMemo(() => {
    if (!repo || files.length === 0) return undefined
    return {
      name: repo.fullName,
      description: repo.description || 'No description',
      structure: buildFileTreeString(files),
    }
  }, [repo, files])

  // Build a map of all indexed file contents for the AI to browse via tools
  const fileContentsMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (codeIndex?.files) {
      for (const [path, file] of codeIndex.files) {
        if (file.content) map[path] = file.content
      }
    }
    return map
  }, [codeIndex])

  // Use refs to capture current generation context -- avoids stale closures in transport
  const genContextRef = useRef<{
    docType: DocType
    targetFile: string | null
    customPrompt: string
  }>({ docType: 'architecture', targetFile: null, customPrompt: '' })

  // Transport for the active generation -- sends file contents for tool access
  const transport = useMemo(() => {
    if (!selectedModel || !hasValidKey || !repoContext) return undefined
    return new DefaultChatTransport({
      api: '/api/docs/generate',
      prepareSendMessagesRequest: ({ messages }) => {
        const ctx = genContextRef.current
        return {
          body: {
            messages,
            provider: selectedModel.provider,
            model: selectedModel.id,
            apiKey: apiKeys[selectedModel.provider].key,
            docType: ctx.docType,
            repoContext,
            fileContents: fileContentsMap,
            targetFile: ctx.targetFile,
          },
        }
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, hasValidKey, apiKeys, repoContext, fileContentsMap])

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transport ?? undefined,
    id: 'docs-generator',
  })

  const isGenerating = status === 'streaming' || status === 'submitted'

  // When generation completes, save the doc
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current === 'streaming' && status === 'ready' && messages.length > 0) {
      const ctx = genContextRef.current
      const preset = DOC_PRESETS.find(p => p.id === ctx.docType)
      const docId = `doc-${Date.now()}`
      const title = ctx.docType === 'file-explanation' && ctx.targetFile
        ? `${ctx.targetFile.split('/').pop()} Explained`
        : ctx.docType === 'custom'
          ? ctx.customPrompt.slice(0, 50) + (ctx.customPrompt.length > 50 ? '...' : '')
          : preset?.label || 'Documentation'

      const newDoc: GeneratedDoc = {
        id: docId,
        type: ctx.docType,
        title,
        messages: [...messages],
        createdAt: new Date(),
        targetFile: ctx.targetFile || undefined,
      }

      setGeneratedDocs(prev => [newDoc, ...prev])
      setActiveDocId(docId)
      setShowNewDoc(false)
      setSelectedPreset(null)
      setCustomPrompt('')
      setTargetFile(null)
    }
    prevStatus.current = status
  }, [status, messages])

  // Auto-scroll during streaming
  useEffect(() => {
    if (isGenerating && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [messages, isGenerating])

  const handleGenerate = (preset: DocPreset) => {
    if (!hasValidKey || !repoContext || !transport) return

    if (preset.id === 'file-explanation' && !targetFile) {
      setSelectedPreset('file-explanation')
      setShowFileSearch(true)
      return
    }

    if (preset.id === 'custom' && !customPrompt.trim()) {
      setSelectedPreset('custom')
      return
    }

    // Snapshot context into ref before sending -- no stale closure issues
    genContextRef.current = {
      docType: preset.id,
      targetFile,
      customPrompt,
    }

    setSelectedPreset(preset.id)
    setMessages([])

    const prompt = preset.id === 'file-explanation' && targetFile
      ? `Explain this file in detail: \`${targetFile}\`. Cover its purpose, how it fits in the architecture, key functions/classes, and walk through the main logic.`
      : preset.id === 'custom'
        ? customPrompt
        : preset.prompt

    // Let React flush setMessages([]) before sending
    setTimeout(() => sendMessage({ text: prompt }), 50)
  }

  const handleFileSelect = (path: string) => {
    setTargetFile(path)
    setShowFileSearch(false)
    setFileSearchQuery('')
  }

  const handleDeleteDoc = (id: string) => {
    setGeneratedDocs(prev => prev.filter(d => d.id !== id))
    if (activeDocId === id) {
      setActiveDocId(null)
      setShowNewDoc(true)
    }
  }

  // --- Render ---

  // No repo
  if (!repo) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-center text-text-secondary">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Connect a repository to generate documentation</p>
        </div>
      </div>
    )
  }

  // No API key
  if (!hasValidKey) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-center max-w-sm">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary mb-1">API key required</p>
          <p className="text-xs text-text-muted">Add an API key in Settings and select a model to generate documentation with AI.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* Sidebar -- generated docs list */}
      <div className="w-56 border-r border-foreground/[0.06] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 h-10 border-b border-foreground/[0.06] shrink-0">
          <span className="text-xs font-medium text-text-secondary">Generated Docs</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-text-muted hover:text-text-primary"
            onClick={() => { setShowNewDoc(true); setActiveDocId(null); setSelectedPreset(null) }}
            title="New document"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {generatedDocs.length === 0 && (
            <p className="text-[10px] text-text-muted px-3 py-4 text-center">No docs generated yet. Pick a template to get started.</p>
          )}
          {generatedDocs.map(doc => {
            const preset = DOC_PRESETS.find(p => p.id === doc.type)
            return (
              <button
                key={doc.id}
                onClick={() => { setActiveDocId(doc.id); setShowNewDoc(false) }}
                className={cn(
                  'w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-foreground/5 transition-colors group',
                  activeDocId === doc.id && 'bg-foreground/[0.07]'
                )}
              >
                <span className="text-text-muted shrink-0 mt-0.5">{preset?.icon || <FileText className="h-4 w-4" />}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary truncate group-hover:text-text-primary">{doc.title}</p>
                  <p className="text-[10px] text-text-muted">{doc.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                  className="opacity-0 group-hover:opacity-100 shrink-0 text-text-muted hover:text-red-400 transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {showNewDoc || !activeDoc ? (
          // New doc generation view
          <div ref={isGenerating ? contentRef : undefined} className="flex-1 overflow-y-auto flex flex-col">
            {/* Currently generating */}
            {isGenerating && messages.length > 0 ? (
              <div className="p-6 max-w-3xl">
                <ToolActivity messages={messages} />
                <div className="prose prose-invert max-w-none">
                  <MarkdownContent messages={messages} />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
                <div className="w-full max-w-xl">
                  <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">Generate Documentation</h2>
                  <p className="text-xs text-text-muted text-center mb-6">
                    AI reads your code and writes real documentation. Pick a template or write a custom prompt.
                  </p>

                  <div className="flex flex-col gap-2">
                    {DOC_PRESETS.map(preset => (
                      <div key={preset.id}>
                        <button
                          onClick={() => {
                            if (preset.id === 'custom') {
                              setSelectedPreset('custom')
                            } else if (preset.id === 'file-explanation') {
                              setSelectedPreset('file-explanation')
                              setShowFileSearch(true)
                            } else {
                              handleGenerate(preset)
                            }
                          }}
                          disabled={isGenerating}
                          className={cn(
                            'w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left',
                            'hover:bg-foreground/[0.03] hover:border-foreground/15',
                            selectedPreset === preset.id
                              ? 'border-foreground/20 bg-foreground/[0.04]'
                              : 'border-foreground/[0.06] bg-foreground/[0.01]',
                            isGenerating && 'opacity-50 pointer-events-none'
                          )}
                        >
                          <span className="text-text-muted shrink-0">{preset.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary font-medium">{preset.label}</p>
                            <p className="text-[11px] text-text-muted leading-tight">{preset.description}</p>
                          </div>
                          {preset.id !== 'custom' && preset.id !== 'file-explanation' && (
                            <ChevronDown className="h-4 w-4 text-text-muted shrink-0 -rotate-90" />
                          )}
                        </button>

                        {/* File picker for file-explanation */}
                        {selectedPreset === 'file-explanation' && preset.id === 'file-explanation' && (
                          <div className="mt-2">
                            {targetFile ? (
                              <div className="flex items-center gap-2 mb-2">
                                <FileCode className="h-3.5 w-3.5 text-text-muted" />
                                <span className="text-xs text-text-secondary font-mono flex-1 truncate">{targetFile}</span>
                                <button onClick={() => { setTargetFile(null); setShowFileSearch(true) }} className="text-text-muted hover:text-text-secondary">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : null}
                            {showFileSearch && (
                              <div className="rounded-lg border border-foreground/10 bg-card overflow-hidden">
                                <div className="flex items-center gap-2 px-2 border-b border-foreground/[0.06]">
                                  <Search className="h-3.5 w-3.5 text-text-muted shrink-0" />
                                  <Input
                                    autoFocus
                                    value={fileSearchQuery}
                                    onChange={e => setFileSearchQuery(e.target.value)}
                                    placeholder="Search for a file..."
                                    className="h-8 border-0 bg-transparent text-xs focus-visible:ring-0 px-0"
                                  />
                                </div>
                                <div className="max-h-40 overflow-y-auto py-1">
                                  {filteredFiles.map(f => (
                                    <button
                                      key={f.path}
                                      onClick={() => handleFileSelect(f.path)}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-foreground/5 text-xs text-text-secondary hover:text-text-primary"
                                    >
                                      <FileCode className="h-3 w-3 text-text-muted shrink-0" />
                                      <span className="truncate">{f.path}</span>
                                    </button>
                                  ))}
                                  {filteredFiles.length === 0 && (
                                    <p className="px-3 py-2 text-[10px] text-text-muted text-center">No files found</p>
                                  )}
                                </div>
                              </div>
                            )}
                            {targetFile && (
                              <Button
                                size="sm"
                                onClick={() => handleGenerate(preset)}
                                disabled={isGenerating}
                                className="mt-2 h-7 text-xs"
                              >
                                Generate
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Custom prompt input */}
                        {selectedPreset === 'custom' && preset.id === 'custom' && (
                          <div className="mt-2 flex flex-col gap-2">
                            <textarea
                              autoFocus
                              value={customPrompt}
                              onChange={e => setCustomPrompt(e.target.value)}
                              placeholder="e.g. 'Explain the auth flow', 'Document the database schema', 'Write a deployment guide'..."
                              className="w-full h-20 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-foreground/20"
                              onKeyDown={e => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && customPrompt.trim()) {
                                  handleGenerate(preset)
                                }
                              }}
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-text-muted">Ctrl+Enter to generate</span>
                              <Button
                                size="sm"
                                onClick={() => handleGenerate(preset)}
                                disabled={isGenerating || !customPrompt.trim()}
                                className="h-7 text-xs"
                              >
                                Generate
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Viewing a generated doc
          <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-foreground/[0.06]">
                {DOC_PRESETS.find(p => p.id === activeDoc.type)?.icon}
                <h1 className="text-lg font-semibold text-text-primary">{activeDoc.title}</h1>
                {activeDoc.targetFile && (
                  <code className="text-[10px] text-text-muted bg-foreground/[0.04] px-1.5 py-0.5 rounded ml-auto">{activeDoc.targetFile}</code>
                )}
              </div>
              <div className="prose prose-invert max-w-none">
                <MarkdownContent messages={activeDoc.messages} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Shows which files the AI is reading during tool-calling phase. */
function ToolActivity({ messages }: { messages: UIMessage[] }) {
  // Extract tool invocations from all messages
  const toolCalls: { name: string; path?: string; state: string }[] = []
  const hasText = messages.some(m =>
    m.role === 'assistant' && m.parts?.some(p => p.type === 'text' && p.text.trim().length > 0)
  )

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts || []) {
      if (part.type === 'dynamic-tool') {
        const input = (part.input as Record<string, unknown> | undefined) ?? {}
        toolCalls.push({
          name: part.toolName,
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
        <span className="text-sm text-text-secondary">Starting documentation generation...</span>
      </div>
    )
  }

  const isStillReading = toolCalls.length > 0 && toolCalls.some(t => t.state !== 'output-available' && t.state !== 'output-error')
  const readFiles = toolCalls.filter(t => t.name === 'readFile' && t.path)
  const searches = toolCalls.filter(t => t.name === 'searchFiles')

  return (
    <div className="mb-4">
      {(isStillReading || !hasText) && (
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
          <span className="text-sm text-text-secondary">
            {hasText ? 'Writing documentation...' : isStillReading ? 'Reading codebase...' : 'Analyzing...'}
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
          {readFiles.slice(-5).map((t, i) => (
            <span key={i} className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-foreground/[0.03] border border-foreground/[0.06]">
              {t.path?.split('/').slice(-2).join('/') || t.path}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Renders the assistant text from chat messages as formatted markdown. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function MarkdownContent({ messages }: { messages: UIMessage[] }) {
  const text = messages
    .filter(m => m.role === 'assistant')
    .flatMap(m => m.parts?.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text) || [])
    .join('')

  if (!text) return null

  // Escape HTML first to prevent XSS, then apply markdown transformations
  const html = escapeHtml(text)
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-foreground/5 rounded-lg p-4 my-3 overflow-x-auto text-xs leading-relaxed"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-foreground/5 px-1.5 py-0.5 rounded text-xs">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-text-primary mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-text-primary mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-text-primary mt-8 mb-4">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-text-primary font-medium">$1</strong>')
    .replace(/^\- (.+)$/gm, '<li class="text-text-secondary text-sm ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="text-text-secondary text-sm ml-4 list-decimal">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')

  return (
    <div
      className="text-sm text-text-secondary leading-relaxed [&_h1]:leading-tight [&_h2]:leading-tight [&_h3]:leading-tight"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
