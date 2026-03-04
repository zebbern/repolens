"use client"

import { File, Download, Undo2, FolderDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { FileTreeNode, type FileIssueCounts } from './file-tree-node'
import type { FileNode } from '@/types/repository'
import type { CodeIndex } from '@/lib/code/code-index'
import type { OpenTab } from './types'

interface CodeExplorerSidebarProps {
  files: FileNode[]
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onFileSelect: (file: FileNode) => void
  onDownloadFile: (file: FileNode) => void
  onDownloadFolder: (folder: FileNode) => void
  onDownloadFullProject: () => void
  activeFilePath: string | null
  codeIndex: CodeIndex
  issueCountByFile: Map<string, FileIssueCounts>
  modifiedTabs: OpenTab[]
  onDownloadAllModified: () => void
  onRevertFile: (path: string) => void
  onDownloadFile2: (tab: OpenTab) => void
}

export function CodeExplorerSidebar({
  files,
  expandedFolders,
  onToggleFolder,
  onFileSelect,
  onDownloadFile,
  onDownloadFolder,
  onDownloadFullProject,
  activeFilePath,
  codeIndex,
  issueCountByFile,
  modifiedTabs,
  onDownloadAllModified,
  onRevertFile,
  onDownloadFile2,
}: CodeExplorerSidebarProps) {
  return (
    <>
      {/* Explorer Header */}
      <div className="h-9 flex items-center justify-between px-4 text-xs font-medium text-text-muted uppercase tracking-wide">
        <span>Explorer</span>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDownloadFullProject}
                disabled={files.length === 0}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-foreground/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <FolderDown className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Download full project as ZIP</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1">
          <FileTreeNode
            nodes={files}
            expandedFolders={expandedFolders}
            onToggleFolder={onToggleFolder}
            onFileSelect={onFileSelect}
            onDownloadFile={onDownloadFile}
            onDownloadFolder={onDownloadFolder}
            activeFilePath={activeFilePath}
            depth={0}
            codeIndex={codeIndex}
            issueCountByFile={issueCountByFile}
          />
        </div>
      </div>

      {/* Modified Files Section */}
      {modifiedTabs.length > 0 && (
        <div className="border-t border-foreground/[0.06] p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-muted uppercase">
              Modified ({modifiedTabs.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 text-text-muted hover:text-text-primary"
              onClick={onDownloadAllModified}
              title="Download all modified files as ZIP"
            >
              <Download className="h-3 w-3" />
              Download All
            </Button>
          </div>
          <div className="space-y-0.5">
            {modifiedTabs.map((tab) => (
              <div
                key={tab.path}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-foreground/5 group"
              >
                <File className="h-3.5 w-3.5 text-text-muted shrink-0" />
                <span className="text-xs text-text-secondary truncate flex-1">{tab.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                  onClick={() => onRevertFile(tab.path)}
                  title="Revert to original"
                >
                  <Undo2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                  onClick={() => onDownloadFile2(tab)}
                  title="Download file"
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
