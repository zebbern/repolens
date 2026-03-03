import { useState, useCallback, type Dispatch, type SetStateAction } from "react"
import type { CodeIndex, SearchResult } from "@/lib/code/code-index"
import { buildSearchRegex, indexFile, batchIndexFiles } from "@/lib/code/code-index"
import type { OpenTab, SearchOptions } from "../types"

interface UseReplaceOptions {
  codeIndex: CodeIndex
  updateCodeIndex: (index: CodeIndex) => void
  setModifiedContents: Dispatch<SetStateAction<Map<string, string>>>
  getFileContent: (path: string) => string | null
  debouncedSearchQuery: string
  searchOptions: SearchOptions
  replaceQuery: string
  searchResults: SearchResult[]
  modifiedContents: Map<string, string>
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>
}

/**
 * Manages all replace/revert operations: single match, all-in-file,
 * all-in-all-files, and revert-to-original.
 */
export function useReplace({
  codeIndex,
  updateCodeIndex,
  setModifiedContents,
  getFileContent,
  debouncedSearchQuery,
  searchOptions,
  replaceQuery,
  searchResults,
  modifiedContents,
  setOpenTabs,
}: UseReplaceOptions) {
  const [confirmReplaceAll, setConfirmReplaceAll] = useState(false)

  // Helper: apply replacement and sync state
  const applyReplace = useCallback((filePath: string, newContent: string) => {
    const indexed = codeIndex.files.get(filePath)
    const originalContent = indexed?.content ?? null

    setModifiedContents(prev => {
      const next = new Map(prev)
      next.set(filePath, newContent)
      return next
    })

    const lang = indexed?.language
    updateCodeIndex(indexFile(codeIndex, filePath, newContent, lang))

    setOpenTabs(prev => prev.map(tab => {
      if (tab.path !== filePath) return tab
      return { ...tab, content: newContent, isModified: newContent !== (originalContent ?? tab.originalContent) }
    }))
  }, [codeIndex, updateCodeIndex, setModifiedContents, setOpenTabs])

  // Replace single match on a specific line
  const replaceInFile = useCallback((filePath: string, matchLine: number) => {
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    const content = getFileContent(filePath)
    if (!content) return

    const lines = content.split('\n')
    const lineIndex = matchLine - 1
    if (lineIndex >= 0 && lineIndex < lines.length) {
      searchPattern.lastIndex = 0
      lines[lineIndex] = lines[lineIndex].replace(searchPattern, replaceQuery)
    }
    applyReplace(filePath, lines.join('\n'))
  }, [debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, applyReplace])

  // Replace all matches in one file
  const replaceAllInFile = useCallback((filePath: string) => {
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    const content = getFileContent(filePath)
    if (!content) return

    searchPattern.lastIndex = 0
    applyReplace(filePath, content.replace(searchPattern, replaceQuery))
  }, [debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, applyReplace])

  // Replace all matches across ALL files
  const replaceAllInAllFiles = useCallback(() => {
    setConfirmReplaceAll(false)
    const searchPattern = buildSearchRegex(debouncedSearchQuery, searchOptions)
    if (!searchPattern) return

    const updates: Array<{ path: string; content: string; language?: string }> = []
    const newModified = new Map(modifiedContents)

    for (const result of searchResults) {
      const content = getFileContent(result.file)
      if (!content) continue

      searchPattern.lastIndex = 0
      const newContent = content.replace(searchPattern, replaceQuery)
      if (newContent !== content) {
        newModified.set(result.file, newContent)
        const lang = codeIndex.files.get(result.file)?.language
        updates.push({ path: result.file, content: newContent, language: lang })
      }
    }

    setModifiedContents(newModified)

    if (updates.length > 0) {
      updateCodeIndex(batchIndexFiles(codeIndex, updates))
    }

    const affectedPaths = new Set(updates.map(u => u.path))
    setOpenTabs(prev => prev.map(tab => {
      if (!affectedPaths.has(tab.path)) return tab
      const newContent = newModified.get(tab.path) ?? tab.content
      return { ...tab, content: newContent, isModified: newContent !== tab.originalContent }
    }))
  }, [searchResults, debouncedSearchQuery, searchOptions, replaceQuery, getFileContent, modifiedContents, codeIndex, updateCodeIndex, setModifiedContents, setOpenTabs])

  // Revert a file to its original content
  const revertFile = useCallback((filePath: string) => {
    const indexed = codeIndex.files.get(filePath)

    setModifiedContents(prev => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })

    if (indexed) {
      updateCodeIndex(indexFile(codeIndex, filePath, indexed.content, indexed.language))
    }

    setOpenTabs(prev => prev.map(tab => {
      if (tab.path !== filePath) return tab
      const original = indexed?.content ?? tab.originalContent
      return { ...tab, content: original, isModified: false }
    }))
  }, [codeIndex, updateCodeIndex, setModifiedContents, setOpenTabs])

  return {
    confirmReplaceAll,
    setConfirmReplaceAll,
    replaceInFile,
    replaceAllInFile,
    replaceAllInAllFiles,
    revertFile,
  }
}
