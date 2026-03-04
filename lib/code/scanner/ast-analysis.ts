// AST Analysis — issue detection and scope extraction via Babel traversal
//
// Uses the parsed AST from ast-parser.ts to detect issues that regex-based
// rules cannot reliably catch (eval usage, unreachable code, empty catches).

import _traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

// CJS/ESM interop: @babel/traverse exports { default: traverseFn } in CJS
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as unknown as { default: typeof _traverse }).default) as typeof _traverse
import type { ParseResult } from '@babel/parser'
import type { File } from '@babel/types'
import type { IndexedFile } from '../code-index'
import type { CodeIssue, IssueCategory, IssueSeverity } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createASTIssue(
  file: IndexedFile,
  opts: {
    ruleId: string
    category: IssueCategory
    severity: IssueSeverity
    title: string
    description: string
    line: number
    column: number
    suggestion?: string
  },
): CodeIssue {
  const lineIdx = opts.line - 1
  const snippet = (lineIdx >= 0 && lineIdx < file.lines.length)
    ? file.lines[lineIdx].trim()
    : ''

  return {
    id: `${opts.ruleId}-${file.path}-${opts.line}`,
    ruleId: opts.ruleId,
    category: opts.category,
    severity: opts.severity,
    title: opts.title,
    description: opts.description,
    file: file.path,
    line: opts.line,
    column: opts.column,
    snippet,
    suggestion: opts.suggestion,
    confidence: 'high',
  }
}

// ---------------------------------------------------------------------------
// Issue detection
// ---------------------------------------------------------------------------

/**
 * Traverse a Babel AST and detect structural issues:
 * - eval() / Function constructor usage
 * - Empty catch blocks
 * - Unreachable code after return/throw/break/continue
 */
export function analyzeAST(ast: ParseResult<File>, file: IndexedFile): CodeIssue[] {
  const issues: CodeIssue[] = []

  try {
    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        const { callee } = path.node
        if (t.isIdentifier(callee) && callee.name === 'eval') {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-eval-usage',
              category: 'security',
              severity: 'critical',
              title: 'Use of eval()',
              description: 'eval() executes arbitrary code and is a major security risk.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Replace eval() with JSON.parse() or a safe expression parser.',
            }))
          }
        }

        if (
          t.isIdentifier(callee) && callee.name === 'Function' &&
          path.node.arguments.length > 0
        ) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-eval-usage',
              category: 'security',
              severity: 'critical',
              title: 'Use of Function constructor',
              description: 'The Function constructor can execute arbitrary code.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Replace with a static function or safe expression evaluator.',
            }))
          }
        }
      },

      NewExpression(path: NodePath<t.NewExpression>) {
        const { callee } = path.node
        if (
          t.isIdentifier(callee) && callee.name === 'Function' &&
          path.node.arguments.length > 0
        ) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-eval-usage',
              category: 'security',
              severity: 'critical',
              title: 'Use of Function constructor',
              description: 'The Function constructor can execute arbitrary code.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Replace with a static function or safe expression evaluator.',
            }))
          }
        }
      },

      CatchClause(path: NodePath<t.CatchClause>) {
        if (path.node.body.body.length === 0) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-empty-catch',
              category: 'reliability',
              severity: 'warning',
              title: 'Empty catch block',
              description: 'Catch block is empty — errors are silently swallowed.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Add error logging or re-throw the error.',
            }))
          }
        }
      },

      BlockStatement(path: NodePath<t.BlockStatement>) {
        const stmts = path.node.body
        for (let i = 0; i < stmts.length - 1; i++) {
          const stmt = stmts[i]
          const isTerminator =
            t.isReturnStatement(stmt) ||
            t.isThrowStatement(stmt) ||
            t.isBreakStatement(stmt) ||
            t.isContinueStatement(stmt)

          if (isTerminator) {
            const nextStmt = stmts[i + 1]
            const loc = nextStmt.loc
            if (loc) {
              const kind = stmt.type.replace('Statement', '').toLowerCase()
              issues.push(createASTIssue(file, {
                ruleId: 'ast-unreachable-code',
                category: 'reliability',
                severity: 'warning',
                title: 'Unreachable code',
                description: `Code after ${kind} statement will never execute.`,
                line: loc.start.line,
                column: loc.start.column,
                suggestion: 'Remove unreachable code or move the terminating statement.',
              }))
            }
            break
          }
        }
      },
    })
  } catch {
    // Traversal failure — return whatever issues were collected
  }

  return issues
}

// ---------------------------------------------------------------------------
// Scope information extraction
// ---------------------------------------------------------------------------

export interface ScopeInfo {
  imports: Array<{ source: string; specifiers: string[]; line: number }>
  exports: Array<{ name: string; line: number; isDefault: boolean }>
  functions: Array<{
    name: string; line: number; endLine: number
    isAsync: boolean; isExported: boolean
  }>
  variables: Array<{ name: string; line: number; kind: 'var' | 'let' | 'const' }>
}

/** Extract scope information from an AST. */
export function extractScopeInfo(ast: ParseResult<File>): ScopeInfo {
  const info: ScopeInfo = {
    imports: [],
    exports: [],
    functions: [],
    variables: [],
  }

  try {
    traverse(ast, {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        const loc = path.node.loc
        info.imports.push({
          source: path.node.source.value,
          specifiers: path.node.specifiers.map(s => {
            if (t.isImportDefaultSpecifier(s)) return 'default'
            if (t.isImportNamespaceSpecifier(s)) return '*'
            return s.local.name
          }),
          line: loc?.start.line ?? 0,
        })
      },

      ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
        const loc = path.node.loc
        const decl = path.node.declaration
        if (decl && t.isFunctionDeclaration(decl) && decl.id) {
          info.exports.push({ name: decl.id.name, line: loc?.start.line ?? 0, isDefault: false })
        } else if (decl && t.isVariableDeclaration(decl)) {
          for (const d of decl.declarations) {
            if (t.isIdentifier(d.id)) {
              info.exports.push({ name: d.id.name, line: loc?.start.line ?? 0, isDefault: false })
            }
          }
        } else {
          for (const spec of path.node.specifiers) {
            if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
              info.exports.push({ name: spec.exported.name, line: loc?.start.line ?? 0, isDefault: false })
            }
          }
        }
      },

      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        const loc = path.node.loc
        const decl = path.node.declaration
        const name = t.isFunctionDeclaration(decl) && decl.id ? decl.id.name : 'default'
        info.exports.push({ name, line: loc?.start.line ?? 0, isDefault: true })
      },

      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const loc = path.node.loc
        if (loc && path.node.id) {
          const isExported =
            t.isExportNamedDeclaration(path.parent) ||
            t.isExportDefaultDeclaration(path.parent)
          info.functions.push({
            name: path.node.id.name,
            line: loc.start.line,
            endLine: loc.end.line,
            isAsync: path.node.async,
            isExported,
          })
        }
      },

      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (!t.isIdentifier(path.node.id)) return
        const init = path.node.init
        if (init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))) {
          const loc = path.node.loc
          const parentDecl = path.parent
          const isExported =
            t.isVariableDeclaration(parentDecl) &&
            (t.isExportNamedDeclaration(path.parentPath?.parent ?? null) || false)
          if (loc) {
            info.functions.push({
              name: path.node.id.name,
              line: loc.start.line,
              endLine: init.loc?.end.line ?? loc.start.line,
              isAsync: init.async,
              isExported,
            })
          }
        } else {
          const loc = path.node.loc
          const parentNode = path.parent
          const kind = t.isVariableDeclaration(parentNode) ? parentNode.kind : 'const'
          if (loc) {
            info.variables.push({
              name: path.node.id.name,
              line: loc.start.line,
              kind: kind as 'var' | 'let' | 'const',
            })
          }
        }
      },
    })
  } catch {
    // return what was collected
  }

  return info
}

// ---------------------------------------------------------------------------
// Function body extraction
// ---------------------------------------------------------------------------

export interface FunctionBody {
  name: string
  startLine: number
  endLine: number
  isAsync: boolean
}

/** Find all function-like bodies in an AST with their line ranges. */
export function findFunctionBodies(ast: ParseResult<File>): FunctionBody[] {
  const bodies: FunctionBody[] = []

  const visitor = (path: NodePath) => {
    const node = path.node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression
    const loc = node.loc
    if (!loc) return
    let name = '<anonymous>'
    if (t.isFunctionDeclaration(node) && node.id) {
      name = node.id.name
    } else if (t.isFunctionExpression(node) && node.id) {
      name = node.id.name
    } else if (t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)) {
      name = path.parent.id.name
    }
    bodies.push({ name, startLine: loc.start.line, endLine: loc.end.line, isAsync: node.async })
  }

  try {
    traverse(ast, {
      FunctionDeclaration: visitor,
      FunctionExpression: visitor,
      ArrowFunctionExpression: visitor,
    })
  } catch {
    // return what was collected
  }

  return bodies
}

// ---------------------------------------------------------------------------
// Route handler detection
// ---------------------------------------------------------------------------

/** Detect whether an AST represents a route handler. */
export function isRouteHandler(ast: ParseResult<File>): boolean {
  let detected = false

  try {
    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        if (detected) { path.stop(); return }
        const { callee } = path.node
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.property) &&
          ['get', 'post', 'put', 'delete', 'patch', 'use', 'all'].includes(callee.property.name)
        ) {
          const args = path.node.arguments
          if (args.length >= 2 && t.isStringLiteral(args[0]) && args[0].value.startsWith('/')) {
            detected = true
            path.stop()
          }
        }
      },
      ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
        if (detected) { path.stop(); return }
        const decl = path.node.declaration
        if (
          t.isFunctionDeclaration(decl) && decl.id &&
          ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(decl.id.name)
        ) {
          detected = true
          path.stop()
        }
      },
    })
  } catch { /* return false */ }

  return detected
}

// ---------------------------------------------------------------------------
// Exported function check
// ---------------------------------------------------------------------------

/** Check whether a specific function name is exported from the AST. */
export function isExportedFunction(ast: ParseResult<File>, functionName: string): boolean {
  let found = false

  try {
    traverse(ast, {
      ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
        if (found) { path.stop(); return }
        const decl = path.node.declaration
        if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
          found = true; path.stop(); return
        }
        if (t.isVariableDeclaration(decl)) {
          for (const d of decl.declarations) {
            if (t.isIdentifier(d.id) && d.id.name === functionName) {
              found = true; path.stop(); return
            }
          }
        }
        for (const spec of path.node.specifiers) {
          if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported) && spec.exported.name === functionName) {
            found = true; path.stop(); return
          }
        }
      },
      ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
        if (found) { path.stop(); return }
        const decl = path.node.declaration
        if (t.isFunctionDeclaration(decl) && decl.id?.name === functionName) {
          found = true; path.stop()
        }
      },
    })
  } catch { /* return false */ }

  return found
}
