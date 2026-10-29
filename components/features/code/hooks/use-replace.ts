import { useState, useCallback, type Dispatch, type SetStateAction } from "react"
import type { SearchResult } from "@/lib/code/code-index"
import { buildSearchRegex, indexFile, batchIndexFiles } from "@/lib/code/code-index"
import type { OpenTab, SearchOptions } from "../types"
import type { CodeIndexUpdate, RepositorySession } from '@/providers/repository-provider'

interface UseReplaceOptions {
  updateCodeIndex: (next: CodeIndexUpdate) => void
  setModifiedContents: Dispatch<SetStateAction<Map<string, string>>>
  /** Pre-edit source per edited file; revert restores it. */
  originalContents: Map<string, string>
  setOriginalContents: Dispatch<SetStateAction<Map<string, string>>>
  getFileContent: (path: string, session?: RepositorySession | null) => Promise<string | null>
  debouncedSearchQuery: string
  searchOptions: SearchOptions
  replaceQuery: string
  searchResults: SearchResult[]
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>
  repositorySession: RepositorySession | null
  isRepositorySessionCurrent: (session: RepositorySession | null) => boolean
}

interface ReplaceEdit {
  path: string
  content: string
  /** Source the replacement was computed from; the revert baseline on a file's first edit. */
  previousContent: string
}

/**
 * Manages all replace/revert operations: single match, all-in-file,
 * all-in-all-files, and revert-to-original.
 */
export function useReplace({
  updateCodeIndex,
  setModifiedContents,
  originalContents,
  setOriginalContents,
  getFileContent,
  debouncedSearchQuery,
  searchOptions,
  replaceQuery,
  searchResults,
  setOpenTabs,
  repositorySession,
  isRepositorySessionCurrent,
}: UseReplaceOptions) {
  const [confirmReplaceAll, setConfirmReplaceAll] = useState(false)

  // Commit edits after an async read. Every write merges into the latest state so an
  // edit or revert committed while the read was pending is never overwritten.
  const applyEdits = useCallback((edits: ReplaceEdit[]) => {
    if (edits.length === 0) return

    setOriginalContents(prev => {
      const missing = edits.filter(edit => !prev.has(edit.path))
      if (missing.length === 0) return prev
      const next = new Map(prev)
      for (const edit of missing) next.set(edit.path, edit.previousContent)
      return next
    })
    setModifiedContents(prev => {
      const next = new Map(prev)
      for (const edit of edits) next.set(edit.path, edit.content)
      return next
    })
    updateCodeIndex(current => batchIndexFiles(current, edits.map(edit => ({
      path: edit.path,
      content: edit.content,
      language: current.files.get(edit.path)?.language,
    }))))

    const editsByPath = new Map(edits.map(edit => [edit.path, edit]))
    setOpenTabs(prev => prev.map(tab => {
      const edit = editsByPath.get(tab.path)
      if (!edit) return tab
      const baseline = originalContents.get(tab.path) ?? edit.previousContent
      return { ...tab, content: edit.content, isModified: edit.content !== baseline }
    }))
  }, [originalContents, updateCodeIndex, setModifiedContents, setOriginalContents, setOpenTabs])

  // Replace single match on a specific line
  const replaceInFile = useCallback(async (filePath: string, matchLine: number) => {
    const session = repositorySession
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    const content = await getFileContent(filePath, session)
    if (!isRepositorySessionCurrent(session)) return
    if (!content) return

    const lines = content.split('\n')
    const lineIndex = matchLine - 1
    if (lineIndex >= 0 && lineIndex < lines.length) {
      searchPattern.lastIndex = 0
      lines[lineIndex] = lines[lineIndex].replace(searchPattern, replaceQuery)
    }
    applyEdits([{ path: filePath, content: lines.join('\n'), previousContent: content }])
  }, [debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, applyEdits, repositorySession, isRepositorySessionCurrent])

  // Replace all matches in one file
  const replaceAllInFile = useCallback(async (filePath: string) => {
    const session = repositorySession
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    const content = await getFileContent(filePath, session)
    if (!isRepositorySessionCurrent(session)) return
    if (!content) return

    searchPattern.lastIndex = 0
    applyEdits([{ path: filePath, content: content.replace(searchPattern, replaceQuery), previousContent: content }])
  }, [debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, applyEdits, repositorySession, isRepositorySessionCurrent])

  // Replace all matches across ALL files
  const replaceAllInAllFiles = useCallback(async () => {
    const session = repositorySession
    setConfirmReplaceAll(false)
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    // Pre-fetch all file contents in parallel
    const uniquePaths = [...new Set(searchResults.map(r => r.file))]
    const prefetched = new Map<string, string>()
    await Promise.all(uniquePaths.map(async (p) => {
      const c = await getFileContent(p, session)
      if (c) prefetched.set(p, c)
    }))
    if (!isRepositorySessionCurrent(session)) return

    const edits: ReplaceEdit[] = []
    for (const path of uniquePaths) {
      const content = prefetched.get(path)
      if (!content) continue

      searchPattern.lastIndex = 0
      const newContent = content.replace(searchPattern, replaceQuery)
      if (newContent !== content) edits.push({ path, content: newContent, previousContent: content })
    }
    applyEdits(edits)
  }, [searchResults, debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, applyEdits, repositorySession, isRepositorySessionCurrent])

  // Revert a file to the source recorded before its first edit
  const revertFile = useCallback(async (filePath: string) => {
    if (!isRepositorySessionCurrent(repositorySession)) return
    const originalContent = originalContents.get(filePath)
    if (originalContent === undefined) {
      // No edit is tracked at this path (e.g. a tab left behind by a virtual rename):
      // there is nothing to restore, so only clear the tab's modified marker.
      setOpenTabs(prev => prev.map(tab => (
        tab.path === filePath ? { ...tab, content: tab.originalContent ?? tab.content, isModified: false } : tab
      )))
      return
    }

    setModifiedContents(prev => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })
    setOriginalContents(prev => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })
    updateCodeIndex(current => {
      const indexed = current.files.get(filePath)
      return indexed ? indexFile(current, filePath, originalContent, indexed.language) : current
    })

    setOpenTabs(prev => prev.map(tab => {
      if (tab.path !== filePath) return tab
      return { ...tab, content: originalContent, originalContent, isModified: false }
    }))
  }, [originalContents, updateCodeIndex, setModifiedContents, setOriginalContents, setOpenTabs, repositorySession, isRepositorySessionCurrent])

  return {
    confirmReplaceAll,
    setConfirmReplaceAll,
    replaceInFile,
    replaceAllInFile,
    replaceAllInAllFiles,
    revertFile,
  }
}
