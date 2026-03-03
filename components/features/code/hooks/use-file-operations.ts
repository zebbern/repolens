import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import type { FileNode } from "@/types/repository"
import type { CodeIndex } from "@/lib/code/code-index"
import { flattenFiles } from "@/lib/code/code-index"
import { fetchFileContent } from "@/lib/github/fetcher"
import type { OpenTab } from "../types"

interface UseFileOperationsOptions {
  repo: { owner: string; name: string; defaultBranch: string } | null
  files: FileNode[]
  codeIndex: CodeIndex
  modifiedContents: Map<string, string>
  navigateToFile?: string | null
  onNavigateComplete?: () => void
}

/**
 * Manages open tabs, active tab selection, folder expansion, and file
 * navigation for the code browser.
 */
export function useFileOperations({
  repo,
  files,
  codeIndex,
  modifiedContents,
  navigateToFile,
  onNavigateComplete,
}: UseFileOperationsOptions) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const activeTab = useMemo(
    () => openTabs.find(t => t.path === activeTabPath) || null,
    [openTabs, activeTabPath],
  )

  // Open a file in a new tab or switch to existing tab
  const openFile = useCallback(async (file: FileNode) => {
    let alreadyOpen = false
    setOpenTabs(prev => {
      const existing = prev.find(t => t.path === file.path)
      if (existing) {
        alreadyOpen = true
        return prev
      }
      return [...prev, {
        path: file.path,
        name: file.name,
        language: file.language,
        content: null,
        originalContent: null,
        isLoading: true,
        error: null,
        isModified: false,
      }]
    })
    setActiveTabPath(file.path)
    if (alreadyOpen) return

    if (repo) {
      try {
        const modified = modifiedContents.get(file.path)
        const indexed = codeIndex.files.get(file.path)
        const originalContent = indexed?.content ?? null

        if (modified !== undefined) {
          setOpenTabs(prev => prev.map(t =>
            t.path === file.path
              ? { ...t, content: modified, originalContent: originalContent ?? modified, isLoading: false, isModified: modified !== originalContent }
              : t
          ))
        } else if (indexed) {
          setOpenTabs(prev => prev.map(t =>
            t.path === file.path ? { ...t, content: indexed.content, originalContent: indexed.content, isLoading: false } : t
          ))
        } else {
          const content = await fetchFileContent(repo.owner, repo.name, repo.defaultBranch, file.path)
          setOpenTabs(prev => prev.map(t =>
            t.path === file.path ? { ...t, content, originalContent: content, isLoading: false } : t
          ))
        }
      } catch {
        setOpenTabs(prev => prev.map(t =>
          t.path === file.path ? { ...t, error: 'Failed to load file', isLoading: false } : t
        ))
      }
    }
  }, [repo, codeIndex, modifiedContents])

  // Navigate-to-file effect (e.g. from diagram clicks)
  const lastNavigatedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!navigateToFile || navigateToFile === lastNavigatedRef.current) return
    lastNavigatedRef.current = navigateToFile

    const allFiles = flattenFiles(files)
    const exactFile = allFiles.find(f => f.path === navigateToFile)
    if (exactFile) {
      openFile(exactFile)
      onNavigateComplete?.()
      return
    }
    const childFile = allFiles.find(f => f.path.startsWith(navigateToFile + '/'))
    if (childFile) {
      openFile(childFile)
      onNavigateComplete?.()
    }
  }, [navigateToFile, files, openFile, onNavigateComplete])

  // Close a tab
  const closeTab = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()

    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.path !== path)

      if (activeTabPath === path && newTabs.length > 0) {
        const closedIndex = prev.findIndex(t => t.path === path)
        const newActive = newTabs[Math.min(closedIndex, newTabs.length - 1)]
        setActiveTabPath(newActive?.path || null)
      } else if (newTabs.length === 0) {
        setActiveTabPath(null)
      }

      return newTabs
    })
  }, [activeTabPath])

  // Toggle folder expansion
  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  return {
    openTabs,
    setOpenTabs,
    activeTab,
    activeTabPath,
    setActiveTabPath,
    expandedFolders,
    openFile,
    closeTab,
    toggleFolder,
  }
}
