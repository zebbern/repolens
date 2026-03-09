// Tree-sitter scanner — async multi-language security and quality analysis.
//
// This module runs Tree-sitter S-expression queries against non-JS/TS files
// (Python, Java, Go, Rust, C, C++, Ruby, PHP, Swift, Kotlin) to detect
// security vulnerabilities and code quality issues that regex cannot reliably catch.
//
// Must be called from an async context (scanIssuesAsync or the scanner worker).

import type { IndexedFile } from '../code-index'
import { getFileLines } from '../code-index'
import type { CodeIssue } from './types'
import {
  initTreeSitter,
  parseFile,
  queryTree,
  getLanguageForFile,
} from '@/lib/parsers/tree-sitter'
import { TREE_SITTER_RULES, getRulesForLanguage, getLanguagesWithRules } from './rules-tree-sitter'
import type { TreeSitterRule } from './rules-tree-sitter'
import { SKIP_VENDORED } from './constants'

const MAX_PER_RULE = 15

/** Maximum file size (bytes) to parse with Tree-sitter. */
const MAX_FILE_SIZE = 512_000 // 512 KB

/**
 * Run Tree-sitter-based analysis on a set of files.
 *
 * Groups files by language, loads grammars on demand, runs applicable rules,
 * and returns CodeIssue results. Handles grammar/parse failures gracefully.
 */
export async function scanWithTreeSitter(
  files: Map<string, IndexedFile>,
): Promise<CodeIssue[]> {
  if (TREE_SITTER_RULES.length === 0) return []

  const languagesWithRules = getLanguagesWithRules()

  // Group files by Tree-sitter language, filtering vendored/oversized files
  const filesByLanguage = new Map<string, Map<string, IndexedFile>>()
  for (const [path, file] of files) {
    if (SKIP_VENDORED.test(path)) continue
    if (!file.content) continue
    if (file.content.length > MAX_FILE_SIZE) continue

    const lang = getLanguageForFile(path)
    if (!lang || !languagesWithRules.has(lang)) continue

    let group = filesByLanguage.get(lang)
    if (!group) {
      group = new Map()
      filesByLanguage.set(lang, group)
    }
    group.set(path, file)
  }

  if (filesByLanguage.size === 0) return []

  // Initialize Tree-sitter WASM runtime
  try {
    await initTreeSitter()
  } catch (err) {
    console.warn('[tree-sitter-scanner] Failed to initialize Tree-sitter:', err)
    return []
  }

  const issues: CodeIssue[] = []
  const seenIds = new Set<string>()

  // Process each language group
  for (const [language, langFiles] of filesByLanguage) {
    const rules = getRulesForLanguage(language)
    if (rules.length === 0) continue

    for (const [path, file] of langFiles) {
      const content = file.content
      if (!content) continue

      let tree
      try {
        tree = await parseFile(content, language)
      } catch (err) {
        console.warn(`[tree-sitter-scanner] Parse failed for ${path}:`, err)
        continue
      }
      if (!tree) continue

      try {
        for (const rule of rules) {
          if (rule.excludeFiles && rule.excludeFiles.test(path)) continue
          const ruleIssues = await runRuleOnFileAsync(rule, tree, language, path, file)
          for (const issue of ruleIssues) {
            if (!seenIds.has(issue.id)) {
              seenIds.add(issue.id)
              issues.push(issue)
            }
          }
        }
      } finally {
        tree.delete()
      }
    }
  }

  return issues
}

/**
 * Run a single Tree-sitter rule against a parsed syntax tree (async).
 * Returns up to MAX_PER_RULE issues.
 */
async function runRuleOnFileAsync(
  rule: TreeSitterRule,
  tree: import('web-tree-sitter').Tree,
  language: string,
  filePath: string,
  file: IndexedFile,
): Promise<CodeIssue[]> {
  const issues: CodeIssue[] = []

  let matches
  try {
    matches = await queryTree(tree, language, rule.query)
  } catch (err) {
    // Query syntax may not be supported by this grammar version — skip silently
    console.warn(`[tree-sitter-scanner] Query failed for rule ${rule.id} on ${filePath}:`, err)
    return issues
  }

  const captureName = rule.captureName
  let count = 0

  for (const match of matches) {
    if (count >= MAX_PER_RULE) break

    // Find the capture node to report on
    let reportNode
    if (captureName && match.captures[captureName]) {
      reportNode = match.captures[captureName][0]
    } else {
      // Use first capture
      const firstKey = Object.keys(match.captures).find(k => !k.startsWith('_'))
      if (firstKey) {
        reportNode = match.captures[firstKey]?.[0]
      } else {
        // All captures start with _ (predicate-only), use any
        const anyKey = Object.keys(match.captures)[0]
        if (anyKey) reportNode = match.captures[anyKey]?.[0]
      }
    }

    if (!reportNode) continue

    // Special: TODO/FIXME rule — only report if comment text contains the marker
    if (rule.id === 'ts-todo-comment') {
      const text = reportNode.text
      if (!/\b(TODO|FIXME|HACK|XXX)\b/i.test(text)) continue
    }

    // Special: bare except rule — only fire when there is no exception type specified
    if (rule.id === 'ts-bare-except-py') {
      // An except_clause with no type child is a bare except
      const children = reportNode.namedChildren
      const hasType = children.some(
        c => c.type === 'identifier' || c.type === 'as_pattern' || c.type === 'tuple'
      )
      if (hasType) continue
    }

    // Special: empty catch (Java) — only fire when the block body is actually empty
    if (rule.id === 'ts-empty-catch-java') {
      const namedChildren = reportNode.namedChildren
      if (namedChildren.length > 0) continue
    }

    const line = reportNode.startPosition.row + 1 // Tree-sitter is 0-indexed
    const column = reportNode.startPosition.column
    const snippet = getSnippetAtLine(file, line)

    const issueId = `${rule.id}-${filePath}-${line}`

    count++
    issues.push({
      id: issueId,
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      title: rule.title,
      description: rule.description,
      file: filePath,
      line,
      column,
      snippet,
      suggestion: rule.suggestion,
      cwe: rule.cwe,
      owasp: rule.owasp,
      confidence: rule.confidence ?? 'medium',
    })
  }

  return issues
}

/** Extract a trimmed snippet from the file at the given 1-based line number. */
function getSnippetAtLine(file: IndexedFile, line: number): string {
  const fileLines = getFileLines(file)
  if (line < 1 || line > fileLines.length) return ''
  return fileLines[line - 1].trim()
}
