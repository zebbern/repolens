"use client"

import { useState } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, GitFork } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/types/repository'

interface FileExplorerProps {
  files: FileNode[]
  className?: string
  onFileSelect?: (file: FileNode) => void
}

interface FileTreeNodeProps {
  node: FileNode
  depth: number
  onFileSelect?: (file: FileNode) => void
}

function FileTreeNode({ node, depth, onFileSelect }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2)
  
  const isDirectory = node.type === 'directory'
  const hasChildren = isDirectory && node.children && node.children.length > 0
  
  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    // Could add more specific icons based on file type
    return <File className="h-4 w-4 text-text-muted" />
  }

  return (
    <div>
      <button
        className={cn(
          "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm hover:bg-foreground/5",
          "text-text-secondary hover:text-text-primary transition-colors"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isDirectory) {
            setIsExpanded(!isExpanded)
          } else if (node.type === 'file') {
            onFileSelect?.(node)
          }
        }}
      >
        {isDirectory ? (
          <>
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-4 w-4 text-text-muted" />
              ) : (
                <ChevronRight className="h-4 w-4 text-text-muted" />
              )
            ) : (
              <span className="w-4" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-yellow-500" />
            ) : (
              <Folder className="h-4 w-4 text-yellow-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-4" />
            {node.type === 'submodule'
              ? <GitFork className="h-4 w-4 text-text-muted" aria-label="Git submodule" />
              : getFileIcon(node.name)}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileExplorer({ files, className, onFileSelect }: FileExplorerProps) {
  if (!files || files.length === 0) {
    return (
      <div className={cn('text-sm text-text-muted p-4 text-center', className)}>
        No files found
      </div>
    )
  }

  return (
    <div className={cn('font-mono text-sm', className)}>
      {files.map((file) => (
        <FileTreeNode
          key={file.path}
          node={file}
          depth={0}
          onFileSelect={onFileSelect}
        />
      ))}
    </div>
  )
}
