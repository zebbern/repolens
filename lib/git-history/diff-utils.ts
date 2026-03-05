import type { DiffHunk, ParsedPatch } from './types'

const EMPTY_PATCH: ParsedPatch = { hunks: [], isBinary: false, isTruncated: false }
const BINARY_PATCH: ParsedPatch = { hunks: [], isBinary: true, isTruncated: false }
const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/

/**
 * Parse a unified diff patch string into structured hunks.
 * Handles empty/undefined patches, binary file markers, and the
 * standard `@@ -old,count +new,count @@` format.
 */
export function parsePatch(patch: string | undefined): ParsedPatch {
  if (!patch || patch.length === 0) return EMPTY_PATCH

  if (patch.includes('Binary file') || patch.includes('GIT binary patch')) {
    return BINARY_PATCH
  }

  const lines = patch.split('\n')
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let currentOld = 0
  let currentNew = 0

  for (const line of lines) {
    const headerMatch = line.match(HUNK_HEADER_RE)

    if (headerMatch) {
      currentHunk = {
        oldStart: parseInt(headerMatch[1], 10),
        oldLines: headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1,
        newStart: parseInt(headerMatch[3], 10),
        newLines: headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1,
        header: line,
        lines: [],
      }
      hunks.push(currentHunk)
      currentOld = currentHunk.oldStart
      currentNew = currentHunk.newStart
      continue
    }

    if (!currentHunk) continue

    // Skip "\ No newline at end of file" markers
    if (line.startsWith('\\')) continue

    const prefix = line[0]
    const content = line.slice(1)

    if (prefix === '+') {
      currentHunk.lines.push({ type: 'add', content, oldLineNumber: null, newLineNumber: currentNew++ })
    } else if (prefix === '-') {
      currentHunk.lines.push({ type: 'remove', content, oldLineNumber: currentOld++, newLineNumber: null })
    } else if (prefix === ' ' || prefix === undefined) {
      currentHunk.lines.push({ type: 'context', content: prefix === ' ' ? content : line, oldLineNumber: currentOld++, newLineNumber: currentNew++ })
    } else {
      // Unrecognized prefix — treat as context
      currentHunk.lines.push({ type: 'context', content: line, oldLineNumber: currentOld++, newLineNumber: currentNew++ })
    }
  }

  return { hunks, isBinary: false, isTruncated: false }
}
