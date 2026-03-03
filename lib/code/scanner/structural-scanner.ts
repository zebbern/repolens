// Structural scanner — detects architectural issues using the import graph
// (circular deps, large files, high coupling, dead modules, deep chains).

import type { CodeIndex } from '../code-index'
import type { FullAnalysis } from '../import-parser'
import type { CodeIssue } from './types'

export function scanStructuralIssues(codeIndex: CodeIndex, analysis: FullAnalysis | null): CodeIssue[] {
  const issues: CodeIssue[] = []
  if (!analysis) return issues

  // Circular dependencies
  for (const [a, b] of analysis.graph.circular) {
    issues.push({
      id: `circular-${a}-${b}`,
      ruleId: 'circular-dep',
      category: 'reliability',
      severity: 'warning',
      title: 'Circular Dependency',
      description: `${a.split('/').pop()} and ${b.split('/').pop()} import each other, creating a circular dependency. This can cause partially-initialized modules, undefined values at import time, and makes the code impossible to refactor safely.`,
      file: a,
      line: 1,
      column: 0,
      snippet: `${a} <-> ${b}`,
      suggestion: 'Extract shared logic into a third module to break the cycle',
      cwe: 'CWE-1047',
    })
  }

  // Large files (> 400 lines)
  for (const [path, file] of codeIndex.files) {
    if (file.lineCount > 400) {
      issues.push({
        id: `large-file-${path}`,
        ruleId: 'large-file',
        category: 'reliability',
        severity: file.lineCount > 800 ? 'warning' : 'info',
        title: 'Large File',
        description: `${file.lineCount} lines. Large files are harder to navigate, test, review, and maintain. They tend to accumulate unrelated concerns.`,
        file: path,
        line: 1,
        column: 0,
        snippet: `${file.lineCount} lines of code`,
        suggestion: 'Split into smaller, focused modules with clear responsibilities (aim for < 300 lines)',
        cwe: 'CWE-1080',
      })
    }
  }

  // High coupling — files imported by 15+ others
  for (const [path, importers] of analysis.graph.reverseEdges) {
    if (importers.size >= 15) {
      issues.push({
        id: `high-coupling-${path}`,
        ruleId: 'high-coupling',
        category: 'reliability',
        severity: 'warning',
        title: 'Highly Coupled Module',
        description: `Imported by ${importers.size} files. Any change to this module ripples across the codebase. High coupling slows development and increases regression risk.`,
        file: path,
        line: 1,
        column: 0,
        snippet: `Imported by ${importers.size} other files`,
        suggestion: 'Split into smaller modules with focused exports. Consider the Interface Segregation Principle.',
        cwe: 'CWE-1047',
      })
    }
  }

  // Dead modules
  for (const [path, fileAnalysis] of analysis.files) {
    const importers = analysis.graph.reverseEdges.get(path)
    if (analysis.topology.entryPoints.includes(path)) continue
    if (/config|\.d\.ts|index\.(ts|js)$|\.test\.|\.spec\.|__tests__|__init__|migrations/i.test(path)) continue
    if (fileAnalysis.exports.length === 0) continue
    if (analysis.topology.orphans.includes(path)) continue

    if (!importers || importers.size === 0) {
      issues.push({
        id: `dead-module-${path}`,
        ruleId: 'dead-module',
        category: 'reliability',
        severity: 'info',
        title: 'Dead Module',
        description: `Exports ${fileAnalysis.exports.length} symbol(s) but no internal file imports from it. This is likely dead code that increases bundle size and maintenance burden.`,
        file: path,
        line: 1,
        column: 0,
        snippet: `Exports: ${fileAnalysis.exports.map(e => e.name).slice(0, 6).join(', ')}${fileAnalysis.exports.length > 6 ? '...' : ''}`,
        suggestion: 'Remove if unused. Verify it\'s not consumed externally (CLI entry, dynamic import, tests).',
        cwe: 'CWE-561',
      })
    }
  }

  // Deep dependency chains
  if (analysis.topology.maxDepth > 10) {
    const deepestFile = Array.from(analysis.topology.depthMap.entries())
      .sort(([, a], [, b]) => b - a)[0]
    if (deepestFile) {
      issues.push({
        id: `deep-chain-${deepestFile[0]}`,
        ruleId: 'deep-chain',
        category: 'reliability',
        severity: 'warning',
        title: 'Deep Dependency Chain',
        description: `Import chain is ${deepestFile[1]} levels deep. Deep chains make initialization order fragile, increase cold start time, and make refactoring dangerous.`,
        file: deepestFile[0],
        line: 1,
        column: 0,
        snippet: `Chain depth: ${deepestFile[1]} levels`,
        suggestion: 'Flatten the dependency graph. Use dependency injection or lazy imports to reduce depth.',
        cwe: 'CWE-1047',
      })
    }
  }

  return issues
}
