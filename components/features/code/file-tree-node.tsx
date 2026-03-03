import { useState } from "react"
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { FileNode } from "@/types/repository"

interface FileTreeNodeProps {
  nodes: FileNode[]
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onFileSelect: (file: FileNode) => void
  onDownloadFile: (file: FileNode) => void
  onDownloadFolder: (folder: FileNode) => void
  activeFilePath: string | null
  depth: number
}

/** Recursive file tree node for the explorer sidebar. */
export function FileTreeNode({
  nodes,
  expandedFolders,
  onToggleFolder,
  onFileSelect,
  onDownloadFile,
  onDownloadFolder,
  activeFilePath,
  depth,
}: FileTreeNodeProps) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.path)
        const isActive = node.path === activeFilePath

        return (
          <div key={node.path}>
            <div
              className={cn(
                "flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer group/tree-item",
                isActive ? "bg-[#264f78]" : "hover:bg-white/5"
              )}
              style={{ paddingLeft: `${depth * 12 + 4}px` }}
              onClick={() => node.type === 'directory' ? onToggleFolder(node.path) : onFileSelect(node)}
            >
              {node.type === 'directory' ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-text-muted shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 text-text-muted shrink-0" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-4" />
                  <File className="h-4 w-4 shrink-0 text-text-muted" />
                </>
              )}
              <span className="text-sm text-text-primary truncate flex-1">{node.name}</span>
              <button
                className="p-0.5 rounded opacity-0 group-hover/tree-item:opacity-100 text-text-muted hover:text-text-primary hover:bg-white/10 transition-opacity shrink-0"
                title={node.type === 'directory' ? `Download ${node.name} as ZIP` : `Download ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  node.type === 'directory' ? onDownloadFolder(node) : onDownloadFile(node)
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>

            {node.type === 'directory' && isExpanded && node.children && (
              <FileTreeNode
                nodes={node.children}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onFileSelect={onFileSelect}
                onDownloadFile={onDownloadFile}
                onDownloadFolder={onDownloadFolder}
                activeFilePath={activeFilePath}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
