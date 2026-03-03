import { useMemo, useCallback } from "react"
import type { GitHubRepo, FileNode } from "@/types/repository"
import type { CodeIndex } from "@/lib/code/code-index"
import { flattenFiles } from "@/lib/code/code-index"
import { fetchFileContent } from "@/lib/github/fetcher"
import type { OpenTab } from "../types"

interface UseDownloadsOptions {
  modifiedContents: Map<string, string>
  openTabs: OpenTab[]
  codeIndex: CodeIndex
  files: FileNode[]
  getFileContent: (path: string) => string | null
  repo: GitHubRepo | null
}

/**
 * Manages file downloads: single file, all modified, explorer file/folder,
 * and full project as ZIP.
 */
export function useDownloads({
  modifiedContents,
  openTabs,
  codeIndex,
  files,
  getFileContent,
  repo,
}: UseDownloadsOptions) {
  // Modified files: derived from modifiedContents (not just open tabs)
  const modifiedTabs = useMemo(() => {
    const tabs: OpenTab[] = []
    for (const [path, content] of modifiedContents) {
      const existingTab = openTabs.find(t => t.path === path)
      if (existingTab) {
        tabs.push({ ...existingTab, content, isModified: true })
      } else {
        const name = path.split('/').pop() || path
        const lang = codeIndex.files.get(path)?.language
        const original = codeIndex.files.get(path)?.content ?? null
        tabs.push({ path, name, language: lang, content, originalContent: original, isLoading: false, error: null, isModified: true })
      }
    }
    return tabs
  }, [modifiedContents, openTabs, codeIndex])

  // Download a single modified file
  const downloadFile = useCallback((tab: OpenTab) => {
    if (!tab.content) return
    const blob = new Blob([tab.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = tab.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  // Download all modified files as a zip
  const downloadAllModified = useCallback(async () => {
    if (modifiedTabs.length === 0) return

    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    for (const tab of modifiedTabs) {
      if (tab.content) {
        zip.file(tab.path, tab.content)
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${repo?.name || 'modified'}-changes.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [modifiedTabs, repo])

  // Download a single file from the explorer
  const downloadExplorerFile = useCallback(async (node: FileNode) => {
    let content = getFileContent(node.path)
    if (content === null && repo) {
      try {
        content = await fetchFileContent(repo.owner, repo.name, repo.defaultBranch, node.path)
      } catch {
        return
      }
    }
    if (!content) return
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = node.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [getFileContent, repo])

  // Download a folder from the explorer as a zip
  const downloadExplorerFolder = useCallback(async (node: FileNode) => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const fileNodes: FileNode[] = []
    const collectNodes = (n: FileNode) => {
      if (n.type === 'file') fileNodes.push(n)
      else if (n.children) for (const child of n.children) collectNodes(child)
    }
    collectNodes(node)

    const results = await Promise.allSettled(
      fileNodes.map(async (f) => {
        let content = getFileContent(f.path)
        if (content === null && repo) {
          content = await fetchFileContent(repo.owner, repo.name, repo.defaultBranch, f.path)
        }
        return { path: f.path, content }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.content !== null) {
        const relativePath = result.value.path.startsWith(node.path + '/')
          ? result.value.path.slice(node.path.length + 1)
          : result.value.path.split('/').pop() || result.value.path
        zip.file(relativePath, result.value.content!)
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${node.name}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [getFileContent, repo])

  // Download full project (all files, with modifications baked in)
  const downloadFullProject = useCallback(async () => {
    if (files.length === 0) return

    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const allFiles = flattenFiles(files)

    const results = await Promise.allSettled(
      allFiles.map(async (f) => {
        let content = getFileContent(f.path)
        if (content === null && repo) {
          content = await fetchFileContent(repo.owner, repo.name, repo.defaultBranch, f.path)
        }
        return { path: f.path, content }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.content !== null) {
        zip.file(result.value.path, result.value.content!)
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${repo?.name || 'project'}-full.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [files, getFileContent, repo])

  return {
    modifiedTabs,
    downloadFile,
    downloadAllModified,
    downloadExplorerFile,
    downloadExplorerFolder,
    downloadFullProject,
  }
}
