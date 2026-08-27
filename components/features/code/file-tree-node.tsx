import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen, Download, Pin, Circle, GitFork,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getLanguageColor } from "@/lib/code/language-colors"
import type { FileNode } from "@/types/repository"
import type { CodeIndex } from "@/lib/code/code-index"
import type { ContentAvailability } from "@/lib/repository"

/** Per-file issue severity counts. */
export interface FileIssueCounts {
  critical: number
  warning: number
  info: number
}

interface FileTreeNodeProps {
  nodes: FileNode[]
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onFileSelect: (file: FileNode) => void
  onDownloadFile: (file: FileNode) => void
  onDownloadFolder: (folder: FileNode) => void
  activeFilePath: string | null
  depth: number
  /** Code index used to look up line counts. */
  codeIndex?: CodeIndex
  /** Map from file path to issue severity counts. */
  issueCountByFile?: Map<string, FileIssueCounts>
  /** Whether a path is pinned to chat context. */
  isPinned?: (path: string) => boolean
  /** Toggle pin/unpin for a file or directory. */
  onPinToggle?: (path: string, type: 'file' | 'directory') => void
  /** Whether content is fully loaded or lazy (metadata-only). */
  contentAvailability?: ContentAvailability
}

/** Format a line count for compact display (e.g. 1200 → "1.2k"). */
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** Collect all file paths under a folder node (recursive). */
function collectFilePaths(node: FileNode): string[] {
  if (node.type === 'file') return [node.path]
  return (node.children ?? []).flatMap(collectFilePaths)
}

/** Aggregate issue counts for a set of file paths. */
function aggregateIssues(
  paths: string[],
  issueMap?: Map<string, FileIssueCounts>,
): FileIssueCounts {
  const result: FileIssueCounts = { critical: 0, warning: 0, info: 0 }
  if (!issueMap) return result
  for (const p of paths) {
    const c = issueMap.get(p)
    if (c) {
      result.critical += c.critical
      result.warning += c.warning
      result.info += c.info
    }
  }
  return result
}

/** Aggregate total line count for a set of file paths. */
function aggregateLineCount(paths: string[], codeIndex?: CodeIndex): number {
  if (!codeIndex) return 0
  let total = 0
  for (const p of paths) {
    const f = codeIndex.files.get(p)
    if (f) total += f.lineCount
  }
  return total
}

// ─── Badge components ────────────────────────────────────────────────

function LanguageDot({ filename }: { filename: string }) {
  const color = getLanguageColor(filename)
  if (!color) return null
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return (
    <span
      className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
      style={{ backgroundColor: color }}
      title={ext.toUpperCase()}
    />
  )
}

function LineCountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="text-[10px] leading-none text-text-muted/70 tabular-nums shrink-0"
      title={`${count.toLocaleString()} lines`}
    >
      {formatCount(count)}
    </span>
  )
}

function IssueCountBadge({ counts }: { counts: FileIssueCounts }) {
  const total = counts.critical + counts.warning + counts.info
  if (total === 0) return null
  const hasCritical = counts.critical > 0
  return (
    <span
      className={cn(
        "text-[10px] leading-none font-medium px-1 py-px rounded shrink-0",
        hasCritical
          ? "bg-red-500/15 text-red-400"
          : "bg-amber-500/15 text-amber-400",
      )}
      title={[
        counts.critical && `${counts.critical} critical`,
        counts.warning && `${counts.warning} warning`,
        counts.info && `${counts.info} info`,
      ].filter(Boolean).join(', ')}
    >
      {total}
    </span>
  )
}

// ─── Main component ──────────────────────────────────────────────────

/** Recursive file tree node for the explorer sidebar. */
export function FileTreeNode({
  ...props
}: FileTreeNodeProps) {
  const treeRef = useRef<HTMLDivElement>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(
    props.activeFilePath ?? props.nodes[0]?.path ?? null,
  )

  useEffect(() => {
    const items = getVisibleTreeItems(treeRef)
    const requested = props.activeFilePath
    const nextPath = requested && items.some((item) => item.dataset.treePath === requested)
      ? requested
      : focusedPath && items.some((item) => item.dataset.treePath === focusedPath)
        ? focusedPath
        : items[0]?.dataset.treePath ?? null
    if (nextPath !== focusedPath) setFocusedPath(nextPath)
  }, [props.activeFilePath, props.expandedFolders, props.nodes, focusedPath])

  const focusItem = (path: string) => {
    setFocusedPath(path)
    getVisibleTreeItems(treeRef).find((item) => item.dataset.treePath === path)?.focus()
  }

  return (
    <div ref={treeRef} role="tree" aria-label="Repository files">
      <FileTreeBranch
        {...props}
        focusedPath={focusedPath}
        setFocusedPath={setFocusedPath}
        focusItem={focusItem}
        treeRef={treeRef}
      />
    </div>
  )
}

interface FileTreeBranchProps extends FileTreeNodeProps {
  focusedPath: string | null
  setFocusedPath: (path: string) => void
  focusItem: (path: string) => void
  treeRef: RefObject<HTMLDivElement | null>
}

function getVisibleTreeItems(treeRef: RefObject<HTMLDivElement | null>): HTMLDivElement[] {
  return Array.from(treeRef.current?.querySelectorAll<HTMLDivElement>('[role="treeitem"]') ?? [])
}

function FileTreeBranch({
  nodes,
  expandedFolders,
  onToggleFolder,
  onFileSelect,
  onDownloadFile,
  onDownloadFolder,
  activeFilePath,
  depth,
  codeIndex,
  issueCountByFile,
  isPinned,
  onPinToggle,
  contentAvailability,
  focusedPath,
  setFocusedPath,
  focusItem,
  treeRef,
}: FileTreeBranchProps) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.path)
        const isActive = node.path === activeFilePath
        const isFocused = node.path === focusedPath

        // Compute badges data
        const isFile = node.type === 'file'
        const indexed = isFile ? codeIndex?.files.get(node.path) : undefined
        const lineCount = isFile
          ? (indexed?.lineCount ?? 0)
          : 0
        // In lazy repos, files without loaded content are dimmed
        const isContentPending = isFile && contentAvailability !== 'full' && indexed && !codeIndex?.contentStore.has(indexed.path)

        return (
          <div key={node.path}>
            <div
              role="treeitem"
              data-tree-path={node.path}
              tabIndex={isFocused ? 0 : -1}
              aria-level={depth + 1}
              aria-expanded={node.type === 'directory' ? isExpanded : undefined}
              aria-selected={isActive}
              className={cn(
                "flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer group/tree-item",
                isActive ? "bg-code-selection" : "hover:bg-foreground/5"
              )}
              style={{ paddingLeft: `${depth * 12 + 4}px` }}
              onClick={() => node.type === 'directory' ? onToggleFolder(node.path) : node.type === 'file' ? onFileSelect(node) : undefined}
              onFocus={(event) => {
                if (event.target === event.currentTarget) setFocusedPath(node.path)
              }}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.target !== event.currentTarget) return
                if (event.altKey || event.ctrlKey || event.metaKey) return
                const items = getVisibleTreeItems(treeRef)
                const currentIndex = items.indexOf(event.currentTarget)
                let destination: HTMLDivElement | undefined

                if (event.key === 'ArrowDown') destination = items[currentIndex + 1]
                if (event.key === 'ArrowUp') destination = items[currentIndex - 1]
                if (event.key === 'Home') destination = items[0]
                if (event.key === 'End') destination = items.at(-1)

                if (event.key === 'ArrowRight' && node.type === 'directory') {
                  event.preventDefault()
                  if (!isExpanded) {
                    onToggleFolder(node.path)
                    return
                  }
                  const next = items[currentIndex + 1]
                  if (next && Number(next.getAttribute('aria-level')) > depth + 1) destination = next
                }

                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  if (node.type === 'directory' && isExpanded) {
                    onToggleFolder(node.path)
                    return
                  }
                  const parentPath = node.path.split('/').slice(0, -1).join('/')
                  destination = items.find((item) => item.dataset.treePath === parentPath)
                }

                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (node.type === 'directory') onToggleFolder(node.path)
                  else if (node.type === 'file') onFileSelect(node)
                  return
                }

                if (event.key.toLowerCase() === 'p' && onPinToggle && node.type !== 'submodule') {
                  event.preventDefault()
                  onPinToggle(node.path, node.type === 'directory' ? 'directory' : 'file')
                  return
                }

                if (event.key.toLowerCase() === 'd' && node.type !== 'submodule') {
                  event.preventDefault()
                  if (node.type === 'directory') onDownloadFolder(node)
                  else onDownloadFile(node)
                  return
                }

                const destinationPath = destination?.dataset.treePath
                if (destinationPath) {
                  event.preventDefault()
                  focusItem(destinationPath)
                }
              }}
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
                  {node.type === 'submodule'
                    ? <GitFork className="h-4 w-4 shrink-0 text-text-muted" aria-label="Git submodule" />
                    : <File className="h-4 w-4 shrink-0 text-text-muted" />}
                </>
              )}

              {/* Filename — truncated to leave room for badges */}
              <span className={cn("text-sm truncate min-w-0 flex-1", isContentPending ? "text-text-muted/60" : "text-text-primary")}>{node.name}</span>

              {/* Unloaded content indicator for lazy repos */}
              {isContentPending && (
                <Circle
                  className="h-[6px] w-[6px] text-text-muted/40 shrink-0"
                  aria-label="Content not yet loaded"
                />
              )}

              {/* Metadata badges — compact, right-aligned */}
              <span className="flex items-center gap-1.5 shrink-0 opacity-60 group-hover/tree-item:opacity-100 group-focus-within/tree-item:opacity-100 transition-opacity">
                {isFile ? (
                  <>
                    <LanguageDot filename={node.name} />
                    <LineCountBadge count={lineCount} />
                    {issueCountByFile?.has(node.path) && (
                      <IssueCountBadge counts={issueCountByFile.get(node.path)!} />
                    )}
                  </>
                ) : node.type === 'directory' ? (
                  <FolderBadges
                    node={node}
                    codeIndex={codeIndex}
                    issueCountByFile={issueCountByFile}
                  />
                ) : null}
              </span>

              {onPinToggle && node.type !== 'submodule' && (
                <button
                  tabIndex={-1}
                  className={cn(
                    "p-0.5 rounded hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-opacity shrink-0",
                    isPinned?.(node.path)
                      ? "opacity-100 text-accent-primary"
                      : "opacity-0 group-hover/tree-item:opacity-100 group-focus-within/tree-item:opacity-100 focus-visible:opacity-100 text-text-muted hover:text-text-primary",
                  )}
                  aria-label={isPinned?.(node.path) ? `Unpin ${node.name}` : `Pin ${node.name}`}
                  aria-pressed={isPinned?.(node.path) ?? false}
                  aria-keyshortcuts="P"
                  title={isPinned?.(node.path) ? `Unpin ${node.name}` : `Pin ${node.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPinToggle(node.path, node.type === 'directory' ? 'directory' : 'file')
                  }}
                >
                  <Pin
                    className={cn(
                      "h-3.5 w-3.5",
                      isPinned?.(node.path) && "fill-current",
                    )}
                  />
                </button>
              )}

              {node.type !== 'submodule' && <button
                tabIndex={-1}
                className="p-0.5 rounded opacity-0 group-hover/tree-item:opacity-100 group-focus-within/tree-item:opacity-100 focus-visible:opacity-100 text-text-muted hover:text-text-primary hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-opacity shrink-0"
                title={node.type === 'directory' ? `Download ${node.name} as ZIP` : `Download ${node.name}`}
                aria-label={node.type === 'directory' ? `Download ${node.name} as ZIP` : `Download ${node.name}`}
                aria-keyshortcuts="D"
                onClick={(e) => {
                  e.stopPropagation()
                  if (node.type === 'directory') onDownloadFolder(node)
                  else onDownloadFile(node)
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>}
            </div>

            {node.type === 'directory' && isExpanded && node.children && (
              <FileTreeBranch
                nodes={node.children}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onFileSelect={onFileSelect}
                onDownloadFile={onDownloadFile}
                onDownloadFolder={onDownloadFolder}
                activeFilePath={activeFilePath}
                depth={depth + 1}
                codeIndex={codeIndex}
                issueCountByFile={issueCountByFile}
                isPinned={isPinned}
                onPinToggle={onPinToggle}
                contentAvailability={contentAvailability}
                focusedPath={focusedPath}
                setFocusedPath={setFocusedPath}
                focusItem={focusItem}
                treeRef={treeRef}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

/** Aggregated badges for a folder node. */
function FolderBadges({
  node,
  codeIndex,
  issueCountByFile,
}: {
  node: FileNode
  codeIndex?: CodeIndex
  issueCountByFile?: Map<string, FileIssueCounts>
}) {
  const { fileCount, totalLines, issues } = useMemo(() => {
    const paths = collectFilePaths(node)
    return {
      fileCount: paths.length,
      totalLines: aggregateLineCount(paths, codeIndex),
      issues: aggregateIssues(paths, issueCountByFile),
    }
  }, [node, codeIndex, issueCountByFile])

  return (
    <>
      {fileCount > 0 && (
        <span
          className="text-[10px] leading-none text-text-muted/60 tabular-nums"
          title={`${fileCount} files, ${totalLines.toLocaleString()} lines`}
        >
          {formatCount(fileCount)}
        </span>
      )}
      <IssueCountBadge counts={issues} />
    </>
  )
}
