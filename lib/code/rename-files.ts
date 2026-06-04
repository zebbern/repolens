// File-rename utilities for the "Find Files → Replace all" feature.
//
// Renames are a session-local (virtual) operation, consistent with the
// content replace-all feature — they re-key the in-memory file tree, code
// index, content store, modified-content overlay and pins, but are never
// pushed back to GitHub. These pure helpers compute the rename set and rebuild
// the file tree; the stateful application lives in the repository provider.

import type { FileNode } from '@/types/repository'

export interface FileRename {
  from: string
  to: string
}

export interface ComputeRenamesOptions {
  /** Case-sensitive matching of the find term (default: false). */
  caseSensitive?: boolean
  /** Treat the find term as a regular expression (default: false — literal). */
  regex?: boolean
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function buildPattern(find: string, options: ComputeRenamesOptions): RegExp | null {
  const flags = `g${options.caseSensitive ? '' : 'i'}`
  try {
    return new RegExp(options.regex ? find : escapeRegExp(find), flags)
  } catch {
    return null // invalid user-supplied regex
  }
}

/** A target path is malformed if it has empty segments or leading/trailing slashes. */
function isMalformedPath(path: string): boolean {
  return path.trim() === '' || path.startsWith('/') || path.endsWith('/') || path.includes('//')
}

/**
 * Compute path renames by replacing every occurrence of `find` with `replace`
 * in each path. Returns only paths that actually change, split into:
 * - `renames`: safe to apply
 * - `conflicts`: skipped because the target is malformed, collides with an
 *   existing file that is not itself being renamed, or two sources map to the
 *   same target.
 */
export function computeFileRenames(
  paths: string[],
  find: string,
  replace: string,
  options: ComputeRenamesOptions = {},
): { renames: FileRename[]; conflicts: FileRename[] } {
  if (!find) return { renames: [], conflicts: [] }
  const pattern = buildPattern(find, options)
  if (!pattern) return { renames: [], conflicts: [] }

  // 1. Candidate renames — path actually changes.
  const candidates: FileRename[] = []
  for (const from of paths) {
    pattern.lastIndex = 0
    const to = from.replace(pattern, replace)
    if (to === from) continue
    candidates.push({ from, to })
  }
  if (candidates.length === 0) return { renames: [], conflicts: [] }

  const sources = new Set(candidates.map(c => c.from))
  const existing = new Set(paths)
  const targetCounts = new Map<string, number>()
  for (const c of candidates) {
    targetCounts.set(c.to, (targetCounts.get(c.to) ?? 0) + 1)
  }

  const renames: FileRename[] = []
  const conflicts: FileRename[] = []
  for (const c of candidates) {
    const duplicateTarget = (targetCounts.get(c.to) ?? 0) > 1
    // Target taken by a file that stays put (is not itself being renamed away).
    const occupied = existing.has(c.to) && !sources.has(c.to)
    if (isMalformedPath(c.to) || duplicateTarget || occupied) {
      conflicts.push(c)
    } else {
      renames.push(c)
    }
  }
  return { renames, conflicts }
}

/**
 * Rebuild a nested FileNode tree from a flat list of file nodes, synthesizing
 * the directory nodes implied by each path. Preserves `size`/`language` from
 * the input file nodes. Used to regenerate the tree after a rename moves files
 * (possibly across directories).
 */
export function buildTreeFromFiles(files: FileNode[]): FileNode[] {
  const root: FileNode[] = []
  const dirMap = new Map<string, FileNode>()

  const ensureDir = (dirPath: string): FileNode | null => {
    if (dirPath === '') return null
    const cached = dirMap.get(dirPath)
    if (cached) return cached
    const parts = dirPath.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const node: FileNode = { name, path: dirPath, type: 'directory', children: [] }
    dirMap.set(dirPath, node)
    const parent = ensureDir(parentPath)
    if (parent) parent.children!.push(node)
    else root.push(node)
    return node
  }

  for (const file of files) {
    const parts = file.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const fileNode: FileNode = {
      name,
      path: file.path,
      type: 'file',
      size: file.size,
      language: file.language,
    }
    const parent = ensureDir(parentPath)
    if (parent) parent.children!.push(fileNode)
    else root.push(fileNode)
  }

  // Directories first, then alphabetical — matches the explorer's ordering.
  const sortLevel = (nodes: FileNode[]): void => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.children) sortLevel(n.children)
  }
  sortLevel(root)
  return root
}
