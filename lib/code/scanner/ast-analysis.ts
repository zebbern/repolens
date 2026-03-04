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

/** Common variable names expected to be reused across scopes (loop vars, error vars, etc.) */
const COMMON_SHADOW_NAMES = new Set(['i', 'j', 'k', 'err', 'error', 'e', 'result', 'data', 'item', 'index', 'key', 'value'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a condition is a constant (boolean literal or self-comparison like x === x). */
function checkConstantCondition(
  test: t.Expression,
  stmtLoc: t.SourceLocation | null | undefined,
  file: IndexedFile,
  issues: CodeIssue[],
): void {
  if (!stmtLoc) return

  if (t.isBooleanLiteral(test)) {
    const cwe = test.value ? 'CWE-571' : 'CWE-570'
    issues.push(createASTIssue(file, {
      ruleId: 'ast-constant-condition',
      category: 'reliability',
      severity: 'warning',
      title: 'Constant condition',
      description: `Condition is always \`${test.value}\`. This makes the branch unconditional.`,
      line: stmtLoc.start.line,
      column: stmtLoc.start.column,
      suggestion: 'Remove the constant condition or replace with actual logic.',
      cwe,
    }))
    return
  }

  if (
    t.isBinaryExpression(test) &&
    ['===', '!==', '==', '!='].includes(test.operator) &&
    t.isIdentifier(test.left) &&
    t.isIdentifier(test.right) &&
    test.left.name === test.right.name
  ) {
    issues.push(createASTIssue(file, {
      ruleId: 'ast-constant-condition',
      category: 'reliability',
      severity: 'warning',
      title: 'Self-comparison',
      description: `Comparing "${test.left.name}" to itself is always constant.`,
      line: stmtLoc.start.line,
      column: stmtLoc.start.column,
      suggestion: 'Fix the comparison — did you mean to compare to a different variable?',
      cwe: 'CWE-571',
    }))
  }
}

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
    cwe?: string
    fix?: string
    fixDescription?: string
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
    cwe: opts.cwe,
    confidence: 'high',
    fix: opts.fix,
    fixDescription: opts.fixDescription,
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
              fix: 'JSON.parse(data)',
              fixDescription: 'Replace eval() with JSON.parse() for data parsing or a safe expression evaluator',
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
              fix: 'Use a static function definition instead',
              fixDescription: 'Replace Function constructor with a static function definition',
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
              fix: 'Use a static function definition instead',
              fixDescription: 'Replace Function constructor with a static function definition',
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
              cwe: 'CWE-390',
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

      // Rule: ast-constant-condition — detect if(true), while(false), x === x
      IfStatement(path: NodePath<t.IfStatement>) {
        checkConstantCondition(path.node.test, path.node.loc, file, issues)
      },
      WhileStatement(path: NodePath<t.WhileStatement>) {
        checkConstantCondition(path.node.test, path.node.loc, file, issues)
      },
      DoWhileStatement(path: NodePath<t.DoWhileStatement>) {
        checkConstantCondition(path.node.test, path.node.loc, file, issues)
      },

      // Rule: ast-shadow-variable — detect variable shadowing outer scope
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        if (!t.isIdentifier(path.node.id)) return
        const name = path.node.id.name
        if (COMMON_SHADOW_NAMES.has(name)) return
        if (path.scope.parent && path.scope.parent.hasBinding(name)) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-shadow-variable',
              category: 'bad-practice',
              severity: 'info',
              title: 'Shadowed variable',
              description: `Variable "${name}" shadows a variable declared in an outer scope.`,
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Rename the variable to avoid confusion with the outer declaration.',
            }))
          }
        }
      },

      // Rule: ast-no-return-await — detect unnecessary return await
      ReturnStatement(path: NodePath<t.ReturnStatement>) {
        if (!path.node.argument || !t.isAwaitExpression(path.node.argument)) return
        const fn = path.getFunctionParent()
        if (fn && fn.node.async) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-no-return-await',
              category: 'bad-practice',
              severity: 'info',
              title: 'Unnecessary return await',
              description: '`return await` is redundant in an async function — the return value is already wrapped in a Promise.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Remove the `await` keyword: `return expr` instead of `return await expr`.',
            }))
          }
        }
      },

      // Rule: ast-switch-no-default — detect switch without default case
      SwitchStatement(path: NodePath<t.SwitchStatement>) {
        const hasDefault = path.node.cases.some(c => c.test === null)
        if (!hasDefault) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-switch-no-default',
              category: 'reliability',
              severity: 'info',
              title: 'Switch statement without default case',
              description: 'This switch statement has no `default` case, which may leave unhandled scenarios.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Add a `default` case to handle unexpected values.',
            }))
          }
        }
      },

      // Rule: ast-dangerous-default-param — detect mutable default parameters
      'Function'(path: NodePath<t.Function>) {
        for (const param of path.node.params) {
          if (!t.isAssignmentPattern(param)) continue
          if (t.isArrayExpression(param.right) || t.isObjectExpression(param.right)) {
            const loc = param.loc
            if (loc) {
              const kind = t.isArrayExpression(param.right) ? 'array' : 'object'
              issues.push(createASTIssue(file, {
                ruleId: 'ast-dangerous-default-param',
                category: 'bad-practice',
                severity: 'info',
                title: 'Mutable default parameter',
                description: `Default parameter uses a mutable ${kind} literal. Mutable default parameters are shared across calls in some contexts and can lead to unexpected behavior.`,
                line: loc.start.line,
                column: loc.start.column,
                suggestion: 'Create the default value inside the function body instead.',
              }))
            }
          }
        }
      },

      // Rule: ast-nested-ternary — detect deeply nested ternaries
      ConditionalExpression(path: NodePath<t.ConditionalExpression>) {
        // Only flag if a child (consequent/alternate) is also a ternary
        const hasNestedTernary =
          t.isConditionalExpression(path.node.consequent) ||
          t.isConditionalExpression(path.node.alternate)
        if (!hasNestedTernary) return
        // Avoid duplicate: only flag on the outermost ternary
        if (t.isConditionalExpression(path.parent)) return
        const loc = path.node.loc
        if (loc) {
          issues.push(createASTIssue(file, {
            ruleId: 'ast-nested-ternary',
            category: 'bad-practice',
            severity: 'info',
            title: 'Nested ternary expression',
            description: 'Ternary expressions nested more than one level deep are hard to read and maintain.',
            line: loc.start.line,
            column: loc.start.column,
            suggestion: 'Refactor into if/else statements or extract into a helper function.',
          }))
        }
      },

      // Rule: ast-throw-literal — detect throw 'string' or throw 123
      ThrowStatement(path: NodePath<t.ThrowStatement>) {
        const arg = path.node.argument
        if (
          arg &&
          (t.isStringLiteral(arg) || t.isNumericLiteral(arg) || t.isTemplateLiteral(arg))
        ) {
          const loc = path.node.loc
          if (loc) {
            issues.push(createASTIssue(file, {
              ruleId: 'ast-throw-literal',
              category: 'bad-practice',
              severity: 'warning',
              title: 'Throwing a literal value',
              description: 'Throwing a literal instead of an Error object loses stack trace information and makes debugging harder.',
              line: loc.start.line,
              column: loc.start.column,
              suggestion: 'Throw an Error object instead: `throw new Error("message")`.',
              cwe: 'CWE-397',
            }))
          }
        }
      },
    })
  } catch (error) {
    console.warn('[ast-analysis] AST traversal error:', error)
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
  } catch (error) {
    console.warn('[ast-analysis] AST traversal error:', error)
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
  } catch (error) {
    console.warn('[ast-analysis] AST traversal error:', error)
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
  } catch (error) {
    console.warn('[ast-analysis] AST traversal error:', error)
  }

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
  } catch (error) {
    console.warn('[ast-analysis] AST traversal error:', error)
  }

  return found
}
