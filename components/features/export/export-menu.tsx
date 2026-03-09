"use client"

import { useState, useMemo, useCallback } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Download,
  FileJson,
  FileText,
  Link2,
  Copy,
  Share2,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRepository } from '@/providers'
import type { FullAnalysis } from '@/lib/code/import-parser'
import { scanInWorker, type ScanResults } from '@/lib/code/issue-scanner'
import { generateProjectSummary } from '@/lib/diagrams/diagram-data'
import type { ProjectSummary } from '@/lib/diagrams/types'
import {
  downloadFile,
  copyToClipboard,
  exportToJson,
  exportToMarkdown,
  exportSummaryClipboard,
  buildShareableUrl,
} from '@/lib/export'

interface ExportMenuProps {
  /** Currently active tab id for shareable URL state */
  activeTab?: string
}

export function ExportMenu({ activeTab }: ExportMenuProps) {
  const { repo, codeIndex, codebaseAnalysis } = useRepository()
  const [isExporting, setIsExporting] = useState(false)

  const hasData = Boolean(repo && codeIndex.totalFiles > 0)

  // Use provider-level analysis instead of computing locally.
  const getAnalysisData = useCallback(async (): Promise<{
    analysis: FullAnalysis | null
    scanResults: ScanResults | null
    summary: ProjectSummary | null
  }> => {
    if (!codeIndex || codeIndex.totalFiles === 0 || !codebaseAnalysis) {
      return { analysis: null, scanResults: null, summary: null }
    }

    const scanResults = await scanInWorker(codeIndex, codebaseAnalysis)
    const summary = generateProjectSummary(codebaseAnalysis, codeIndex).data
    return { analysis: codebaseAnalysis, scanResults, summary }
  }, [codeIndex, codebaseAnalysis])

  const handleExportJson = useCallback(async () => {
    if (!repo) return
    setIsExporting(true)
    try {
      const { analysis, scanResults } = await getAnalysisData()
      const json = exportToJson(repo, codeIndex, analysis, scanResults)
      downloadFile({
        content: json,
        filename: `${repo.fullName.replace('/', '-')}-analysis.json`,
        mimeType: 'application/json',
      })
      toast.success('JSON report downloaded')
    } catch (err) {
      console.error('JSON export failed:', err)
      toast.error('Failed to export JSON')
    } finally {
      setIsExporting(false)
    }
  }, [repo, codeIndex, getAnalysisData])

  const handleExportMarkdown = useCallback(async () => {
    if (!repo) return
    setIsExporting(true)
    try {
      const { analysis, scanResults, summary } = await getAnalysisData()
      const md = exportToMarkdown(repo, codeIndex, analysis, scanResults, summary)
      downloadFile({
        content: md,
        filename: `${repo.fullName.replace('/', '-')}-report.md`,
        mimeType: 'text/markdown',
      })
      toast.success('Markdown report downloaded')
    } catch (err) {
      console.error('Markdown export failed:', err)
      toast.error('Failed to export Markdown')
    } finally {
      setIsExporting(false)
    }
  }, [repo, codeIndex, getAnalysisData])

  const handleCopySummary = useCallback(async () => {
    if (!repo) return
    try {
      const { analysis, scanResults } = await getAnalysisData()
      const text = exportSummaryClipboard(repo, codeIndex, analysis, scanResults)
      const ok = await copyToClipboard(text)
      if (ok) {
        toast.success('Summary copied to clipboard')
      } else {
        toast.error('Failed to copy — clipboard not available')
      }
    } catch (err) {
      console.error('Copy failed:', err)
      toast.error('Failed to copy summary')
    }
  }, [repo, codeIndex, getAnalysisData])

  const handleShareUrl = useCallback(async () => {
    if (!repo) return
    try {
      const url = buildShareableUrl({
        repoUrl: repo.url,
        view: (activeTab as 'repo' | 'issues' | 'docs' | 'diagram' | 'code') ?? undefined,
      })
      const ok = await copyToClipboard(url)
      if (ok) {
        toast.success('Shareable link copied to clipboard')
      } else {
        toast.error('Failed to copy link — clipboard not available')
      }
    } catch (err) {
      console.error('Share URL failed:', err)
      toast.error('Failed to generate shareable link')
    }
  }, [repo, activeTab])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
          disabled={!hasData || isExporting}
          title={hasData ? 'Export & Share' : 'Connect a repository to enable export'}
        >
          {isExporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={handleExportJson} className="gap-2 text-xs">
          <FileJson className="h-3.5 w-3.5" />
          Download JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportMarkdown} className="gap-2 text-xs">
          <FileText className="h-3.5 w-3.5" />
          Download Markdown
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopySummary} className="gap-2 text-xs">
          <Copy className="h-3.5 w-3.5" />
          Copy Summary
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareUrl} className="gap-2 text-xs">
          <Link2 className="h-3.5 w-3.5" />
          Copy Shareable Link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
