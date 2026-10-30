// Shared Tree-sitter mock for scanner tests that run scanIssuesAsync under
// jsdom, where the WASM runtime cannot load. Grammars "load", every parse
// succeeds and every query matches nothing, so the tree-sitter engine reports
// 'completed' with no findings. Same behaviour as the accuracy-sweep mock.
//
// Usage (vi.mock is hoisted above the imports):
//   vi.mock('@/lib/parsers/tree-sitter', () => import('@/lib/code/scanner/__tests__/tree-sitter-mock'))

import { vi } from 'vitest'

const LANGUAGES_BY_EXTENSION: Record<string, string> = {
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
}

export const initTreeSitter = vi.fn().mockResolvedValue(undefined)

export const getLanguageForFile = vi.fn((path: string) => {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension ? LANGUAGES_BY_EXTENSION[extension] : undefined
})

export const parseFile = vi.fn().mockResolvedValue({ delete: vi.fn() })

export const queryTree = vi.fn().mockResolvedValue([])
