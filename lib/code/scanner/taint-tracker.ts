// Taint Tracker — intraprocedural source→sanitizer→sink analysis via Babel AST
//
// Traces user-controlled data (sources) through variable assignments within a
// single function body and flags when tainted data reaches a dangerous sink
// without passing through a sanitizer.

import _traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { ParseResult } from '@babel/parser'
import type { File } from '@babel/types'
import type { IndexedFile } from '../code-index'
import type { CodeIssue, IssueSeverity } from './types'

// CJS/ESM interop (same pattern as ast-analysis.ts)
const traverse = (
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default
) as typeof _traverse

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaintSource {
  type: string
  name: string
  pattern: RegExp
  description: string
}

export interface TaintSink {
  type: string
  name: string
  pattern: RegExp
  cwe: string
  severity: IssueSeverity
  description: string
}

export interface TaintSanitizer {
  type: string
  name: string
  pattern: RegExp
}

export interface TaintFlow {
  source: TaintSource
  sink: TaintSink
  sanitized: boolean
  sanitizer?: TaintSanitizer
  path: string[]
  file: string
  startLine: number
  endLine: number
}

// ---------------------------------------------------------------------------
// Default Catalogs
// ---------------------------------------------------------------------------

export const DEFAULT_SOURCES: TaintSource[] = [
  { type: 'user-input', name: 'req.body', pattern: /\breq\.body\b/, description: 'HTTP request body' },
  { type: 'user-input', name: 'req.query', pattern: /\breq\.query\b/, description: 'HTTP query parameters' },
  { type: 'user-input', name: 'req.params', pattern: /\breq\.params\b/, description: 'HTTP route parameters' },
  { type: 'user-input', name: 'req.headers', pattern: /\breq\.headers\b/, description: 'HTTP request headers' },
  { type: 'user-input', name: 'req.cookies', pattern: /\breq\.cookies\b/, description: 'HTTP cookies' },
  { type: 'environment', name: 'process.env', pattern: /\bprocess\.env\b/, description: 'Environment variable' },
  { type: 'browser-input', name: 'window.location', pattern: /\bwindow\.location\b/, description: 'Browser location' },
  { type: 'browser-input', name: 'document.URL', pattern: /\bdocument\.URL\b/, description: 'Document URL' },
  { type: 'browser-input', name: 'document.referrer', pattern: /\bdocument\.referrer\b/, description: 'Document referrer' },
  { type: 'browser-input', name: 'document.cookie', pattern: /\bdocument\.cookie\b/, description: 'Document cookies' },
  { type: 'user-input', name: 'URLSearchParams', pattern: /\bnew\s+URLSearchParams\b/, description: 'URL search params' },
  { type: 'user-input', name: 'FormData', pattern: /\bnew\s+FormData\b/, description: 'Form data' },
  // Cross-origin messaging
  { type: 'browser-input', name: 'event.data', pattern: /\bevent\.data\b/, description: 'postMessage event data' },
  // WebSocket messages
  { type: 'user-input', name: 'ws.message', pattern: /\.on\s*\(\s*['"]message['"]/, description: 'WebSocket message data' },
  // URL fragment
  { type: 'browser-input', name: 'location.hash', pattern: /\blocation\.hash\b/, description: 'URL fragment' },
  // URL search string
  { type: 'browser-input', name: 'location.search', pattern: /\blocation\.search\b/, description: 'URL search string' },
  // Clipboard API
  { type: 'browser-input', name: 'clipboard.readText', pattern: /\bclipboard\.readText\s*\(/, description: 'Clipboard text content' },
  // Storage
  { type: 'browser-input', name: 'localStorage.getItem', pattern: /\blocalStorage\.getItem\s*\(/, description: 'localStorage stored data' },
  { type: 'browser-input', name: 'sessionStorage.getItem', pattern: /\bsessionStorage\.getItem\s*\(/, description: 'sessionStorage stored data' },
]

export const DEFAULT_SINKS: TaintSink[] = [
  { type: 'code-injection', name: 'eval()', pattern: /\beval\s*\(/, cwe: 'CWE-95', severity: 'critical', description: 'Evaluates arbitrary code' },
  { type: 'code-injection', name: 'Function()', pattern: /\bnew\s+Function\s*\(/, cwe: 'CWE-95', severity: 'critical', description: 'Creates function from string' },
  { type: 'sql-injection', name: 'db.query()', pattern: /\b(?:db|pool|connection|client|knex|sequelize)\.(?:query|raw|execute)\s*\(/, cwe: 'CWE-89', severity: 'critical', description: 'Executes SQL query' },
  { type: 'xss', name: 'innerHTML', pattern: /\.innerHTML\s*=/, cwe: 'CWE-79', severity: 'warning', description: 'Sets innerHTML directly' },
  { type: 'xss', name: 'outerHTML', pattern: /\.outerHTML\s*=/, cwe: 'CWE-79', severity: 'warning', description: 'Sets outerHTML directly' },
  { type: 'xss', name: 'document.write()', pattern: /\bdocument\.write(?:ln)?\s*\(/, cwe: 'CWE-79', severity: 'warning', description: 'Writes to document' },
  { type: 'xss', name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/, cwe: 'CWE-79', severity: 'warning', description: 'React dangerous HTML injection' },
  { type: 'command-injection', name: 'exec()', pattern: /\b(?:exec|execSync|execFile|execFileSync)\s*\(/, cwe: 'CWE-78', severity: 'critical', description: 'Executes system command' },
  { type: 'command-injection', name: 'spawn()', pattern: /\bspawn(?:Sync)?\s*\(/, cwe: 'CWE-78', severity: 'critical', description: 'Spawns system process' },
  { type: 'path-traversal', name: 'fs.readFile()', pattern: /\bfs\.(?:readFile|writeFile|readFileSync|writeFileSync|createReadStream|createWriteStream)\s*\(/, cwe: 'CWE-22', severity: 'warning', description: 'File system access' },
  { type: 'ssrf', name: 'fetch()', pattern: /\bfetch\s*\(/, cwe: 'CWE-918', severity: 'warning', description: 'HTTP request with user-controlled URL' },
  { type: 'ssrf', name: 'axios()', pattern: /\baxios(?:\.(?:get|post|put|delete|patch|request))?\s*\(/, cwe: 'CWE-918', severity: 'warning', description: 'HTTP request with user-controlled URL' },
  // DOM XSS sinks
  { type: 'xss', name: 'insertAdjacentHTML()', pattern: /\.insertAdjacentHTML\s*\(/, cwe: 'CWE-79', severity: 'critical', description: 'Inserts HTML adjacent to element' },
  { type: 'xss', name: 'element.srcdoc', pattern: /\.srcdoc\s*=/, cwe: 'CWE-79', severity: 'critical', description: 'Sets iframe srcdoc content' },
  { type: 'xss', name: 'location.assign()', pattern: /\blocation\.assign\s*\(/, cwe: 'CWE-79', severity: 'warning', description: 'Navigates to URL (javascript: URI risk)' },
  { type: 'xss', name: 'location.replace()', pattern: /\blocation\.replace\s*\(/, cwe: 'CWE-79', severity: 'warning', description: 'Replaces URL (javascript: URI risk)' },
  { type: 'xss', name: 'setAttribute(on*)', pattern: /\.setAttribute\s*\(\s*['"]on/, cwe: 'CWE-79', severity: 'critical', description: 'Sets event handler attribute' },
  { type: 'xss', name: 'document.domain', pattern: /\bdocument\.domain\s*=/, cwe: 'CWE-79', severity: 'warning', description: 'Relaxes same-origin policy' },
  // Node.js sandbox escape
  { type: 'code-injection', name: 'vm.runInNewContext()', pattern: /\bvm\.runInNewContext\s*\(/, cwe: 'CWE-94', severity: 'critical', description: 'Executes code in new V8 context' },
  { type: 'code-injection', name: 'vm.runInThisContext()', pattern: /\bvm\.runInThisContext\s*\(/, cwe: 'CWE-94', severity: 'critical', description: 'Executes code in current V8 context' },
  { type: 'code-injection', name: 'new vm.Script()', pattern: /\bnew\s+vm\.Script\s*\(/, cwe: 'CWE-94', severity: 'critical', description: 'Compiles code as V8 Script' },
  // NoSQL injection
  { type: 'nosql-injection', name: 'Model.find()', pattern: /\.(find|findOne|findById|findOneAndUpdate|aggregate|where)\s*\(/, cwe: 'CWE-943', severity: 'warning', description: 'MongoDB/Mongoose query with potential operator injection' },
  // Template injection
  { type: 'code-injection', name: 'template literal eval', pattern: /\bnew\s+Function\s*\(\s*`/, cwe: 'CWE-94', severity: 'critical', description: 'Template literal passed to Function constructor' },
]

export const DEFAULT_SANITIZERS: TaintSanitizer[] = [
  { type: 'html-escape', name: 'DOMPurify.sanitize()', pattern: /\bDOMPurify\.sanitize\b/ },
  { type: 'encoding', name: 'encodeURIComponent()', pattern: /\bencodeURIComponent\s*\(/ },
  { type: 'encoding', name: 'encodeURI()', pattern: /\bencodeURI\s*\(/ },
  { type: 'type-cast', name: 'parseInt()', pattern: /\bparseInt\s*\(/ },
  { type: 'type-cast', name: 'parseFloat()', pattern: /\bparseFloat\s*\(/ },
  { type: 'type-cast', name: 'Number()', pattern: /\bNumber\s*\(/ },
  { type: 'type-cast', name: 'Boolean()', pattern: /\bBoolean\s*\(/ },
  { type: 'validation', name: 'validator', pattern: /\bvalidator\./ },
  { type: 'sanitization', name: 'sanitize', pattern: /\bsanitize\w*\s*\(/ },
  { type: 'sanitization', name: 'escape', pattern: /\bescape(?:Html|Sql|RegExp)?\s*\(/ },
  { type: 'sanitization', name: 'xss()', pattern: /\bxss\s*\(/ },
  { type: 'path-sanitization', name: 'path.basename()', pattern: /\bpath\.basename\s*\(/ },
  { type: 'path-sanitization', name: 'path.normalize()', pattern: /\bpath\.normalize\s*\(/ },
  { type: 'parameterized', name: 'parameterized query', pattern: /\?\s*,|\$\d+/ },
  // HTML encoding
  { type: 'encoding', name: 'he.encode', pattern: /\bhe\.(encode|escape)\s*\(/ },
  // Schema validation (treats validated data as sanitized)
  { type: 'validation', name: 'zod.parse', pattern: /\.parse\s*\(|\.safeParse\s*\(/ },
  { type: 'validation', name: 'joi.validate', pattern: /\.validate\s*\(|Joi\.\w+\(\)/ },
  { type: 'validation', name: 'yup.validate', pattern: /\.validate\s*\(|\.validateSync\s*\(/ },
  // Express validation
  { type: 'validation', name: 'express-validator', pattern: /\b(check|body|param|query|validationResult)\s*\(/ },
  // SQL escaping
  { type: 'encoding', name: 'sqlstring.escape', pattern: /\bsqlstring\.escape\s*\(|\.escapeLiteral\s*\(|\.escapeIdentifier\s*\(/ },
  // XSS filters
  { type: 'encoding', name: 'xss-filters', pattern: /\bxssFilters\.\w+\s*\(/ },
  // Parameterized templates
  { type: 'parameterized', name: 'tagged-template', pattern: /\bsql`|html`|css`/ },
  // Helmet middleware
  { type: 'middleware', name: 'helmet', pattern: /\bhelmet\s*\(/ },
  // CSRF protection
  { type: 'middleware', name: 'csrf', pattern: /\bcsurf\s*\(|\bcsrf\s*\(/ },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate the source code text for a node (lightweight — uses AST positions). */
function nodeToSource(node: t.Node, lines: string[]): string {
  if (!node.loc) return ''
  const startLine = node.loc.start.line - 1
  const endLine = node.loc.end.line - 1
  if (startLine < 0 || startLine >= lines.length) return ''
  if (startLine === endLine) {
    return lines[startLine].substring(node.loc.start.column, node.loc.end.column)
  }
  const parts: string[] = []
  for (let i = startLine; i <= Math.min(endLine, lines.length - 1); i++) {
    parts.push(lines[i])
  }
  return parts.join('\n')
}

function matchesSource(text: string, sources: TaintSource[]): TaintSource | undefined {
  return sources.find(s => s.pattern.test(text))
}

function matchesSanitizer(text: string, sanitizers: TaintSanitizer[]): TaintSanitizer | undefined {
  return sanitizers.find(s => s.pattern.test(text))
}

function matchesSink(text: string, sinks: TaintSink[]): TaintSink | undefined {
  return sinks.find(s => s.pattern.test(text))
}

/** Extract identifier name from various node types. */
function getIdentifierName(node: t.LVal | t.Expression | t.Node): string | null {
  if (t.isIdentifier(node)) return node.name
  if (t.isMemberExpression(node) && !node.computed) {
    const objName = getIdentifierName(node.object)
    const propName = t.isIdentifier(node.property) ? node.property.name : null
    if (objName && propName) return `${objName}.${propName}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Taint State per Function Scope
// ---------------------------------------------------------------------------

interface TaintEntry {
  source: TaintSource
  chain: string[]
}

interface TaintState {
  tainted: Map<string, TaintEntry>
  sanitized: Map<string, TaintSanitizer>
}

function createTaintState(): TaintState {
  return { tainted: new Map(), sanitized: new Map() }
}

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

interface TaintOptions {
  sources?: TaintSource[]
  sinks?: TaintSink[]
  sanitizers?: TaintSanitizer[]
}

/**
 * Track taint flows through a Babel AST (intraprocedural).
 *
 * For each function body, identifies variables that receive data from a known
 * source, propagates taint through assignments, and checks if tainted data
 * reaches a known sink without passing through a sanitizer.
 */
/** Maximum file size for taint analysis to prevent UI freezing on adversarially large files. */
const MAX_TAINT_FILE_BYTES = 100_000 // 100 KB
const MAX_TAINT_FILE_LINES = 3_000

export function trackTaint(
  ast: ParseResult<File>,
  file: IndexedFile,
  options?: TaintOptions,
): TaintFlow[] {
  const sources = options?.sources ?? DEFAULT_SOURCES
  const sinks = options?.sinks ?? DEFAULT_SINKS
  const sanitizers = options?.sanitizers ?? DEFAULT_SANITIZERS

  const flows: TaintFlow[] = []

  // Guard: skip taint analysis on very large files to avoid UI freezing
  if (file.content.length > MAX_TAINT_FILE_BYTES || file.lines.length > MAX_TAINT_FILE_LINES) {
    return flows
  }

  // Quick check: does the file content contain any source patterns at all?
  const hasAnySources = sources.some(s => s.pattern.test(file.content))
  if (!hasAnySources) return flows

  try {
    traverse(ast, {
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod'(
        fnPath: NodePath,
      ) {
        const state = createTaintState()
        const node = fnPath.node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ClassMethod

        // Mark function params with source-like names as tainted
        for (const param of node.params) {
          markParamTaint(param, state, sources, file.lines)
        }

        // Walk the function body to track taint propagation
        fnPath.traverse({
          VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
            processDeclarator(path.node, state, sources, sanitizers, file.lines)
          },

          AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
            processAssignment(path.node, state, sources, sanitizers, file.lines)
            checkAssignmentSink(path.node, state, sinks, flows, file)
          },

          CallExpression(path: NodePath<t.CallExpression>) {
            checkCallSink(path.node, state, sinks, sanitizers, flows, file, sources)
          },
        })

        // Don't recurse into nested functions (intraprocedural)
        fnPath.skip()
      },
    })
  } catch (error) {
    // AST traversal errors should not crash the scanner
    console.warn('[taint-tracker] AST traversal failed for', file.path, error)
  }

  return flows
}

// ---------------------------------------------------------------------------
// Param Tainting
// ---------------------------------------------------------------------------

// Common Express/Fastify/Koa handler parameter names that typically carry
// user-controlled data. When these appear as function parameters (e.g. in
// `(req, res) => { ... }` patterns), we auto-taint them with a synthetic
// source so taint flows from `req.anything` are tracked even without an
// explicit `req.body` / `req.query` match.
const AUTO_TAINT_PARAM_NAMES = new Set(['req', 'request', 'ctx', 'context'])

/** Escape special regex metacharacters in a string for safe use in `new RegExp()`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function markParamTaint(
  param: t.Node,
  state: TaintState,
  sources: TaintSource[],
  lines: string[],
): void {
  if (t.isIdentifier(param)) {
    const text = nodeToSource(param, lines)
    const source = matchesSource(text, sources)
    if (source) {
      state.tainted.set(param.name, { source, chain: [param.name] })
    } else if (AUTO_TAINT_PARAM_NAMES.has(param.name)) {
      // Auto-taint common request parameter names
      const syntheticSource: TaintSource = {
        type: 'user-input',
        name: param.name,
        pattern: new RegExp(`\\b${escapeRegExp(param.name)}\\b`),
        description: `HTTP request object (${param.name})`,
      }
      state.tainted.set(param.name, { source: syntheticSource, chain: [param.name] })
    }
  }
  if (t.isObjectPattern(param)) {
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
        markParamTaint(prop.value, state, sources, lines)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Declaration / Assignment Processing
// ---------------------------------------------------------------------------

function processDeclarator(
  node: t.VariableDeclarator,
  state: TaintState,
  sources: TaintSource[],
  sanitizers: TaintSanitizer[],
  lines: string[],
): void {
  if (!node.init) return
  const varName = getIdentifierName(node.id)
  if (!varName) return
  processBinding(varName, node.init, state, sources, sanitizers, lines)
}

function processAssignment(
  node: t.AssignmentExpression,
  state: TaintState,
  sources: TaintSource[],
  sanitizers: TaintSanitizer[],
  lines: string[],
): void {
  const varName = getIdentifierName(node.left)
  if (!varName) return
  processBinding(varName, node.right, state, sources, sanitizers, lines)
}

function processBinding(
  varName: string,
  rhs: t.Expression,
  state: TaintState,
  sources: TaintSource[],
  sanitizers: TaintSanitizer[],
  lines: string[],
): void {
  const rhsText = nodeToSource(rhs, lines)

  // 1. Check if RHS passes through a sanitizer
  const sanitizer = matchesSanitizer(rhsText, sanitizers)
  if (sanitizer) {
    const innerTainted = findTaintedInExpression(rhs, state)
    if (innerTainted) {
      state.sanitized.set(varName, sanitizer)
      state.tainted.delete(varName)
      return
    }
  }

  // 2. Check if RHS is a direct source
  const source = matchesSource(rhsText, sources)
  if (source) {
    state.tainted.set(varName, { source, chain: [source.name, varName] })
    state.sanitized.delete(varName)
    return
  }

  // 3. Check if RHS references a tainted variable (propagation)
  const taintedRef = findTaintedInExpression(rhs, state)
  if (taintedRef) {
    const existing = state.tainted.get(taintedRef)!
    state.tainted.set(varName, {
      source: existing.source,
      chain: [...existing.chain, varName],
    })
    state.sanitized.delete(varName)
    return
  }

  // 4. Not tainted — remove any prior taint
  state.tainted.delete(varName)
}

/** Recursively check if an expression references a tainted variable. */
function findTaintedInExpression(
  node: t.Expression | t.Node,
  state: TaintState,
): string | null {
  if (t.isIdentifier(node)) {
    if (state.tainted.has(node.name) && !state.sanitized.has(node.name)) {
      return node.name
    }
  }

  if (t.isMemberExpression(node)) {
    const fullName = getIdentifierName(node)
    if (fullName && state.tainted.has(fullName) && !state.sanitized.has(fullName)) {
      return fullName
    }
    return findTaintedInExpression(node.object, state)
  }

  if (t.isTemplateLiteral(node)) {
    for (const expr of node.expressions) {
      const found = findTaintedInExpression(expr as t.Expression, state)
      if (found) return found
    }
  }

  if (t.isBinaryExpression(node)) {
    return (
      findTaintedInExpression(node.left, state) ??
      findTaintedInExpression(node.right, state)
    )
  }

  if (t.isCallExpression(node)) {
    for (const arg of node.arguments) {
      if (t.isExpression(arg)) {
        const found = findTaintedInExpression(arg, state)
        if (found) return found
      }
    }
  }

  if (t.isConditionalExpression(node)) {
    return findTaintedInExpression(node.consequent, state)
      ?? findTaintedInExpression(node.alternate, state)
  }

  if (t.isLogicalExpression(node)) {
    return findTaintedInExpression(node.left, state)
      ?? findTaintedInExpression(node.right, state)
  }

  if (t.isAwaitExpression(node)) {
    return findTaintedInExpression(node.argument, state)
  }

  return null
}

// ---------------------------------------------------------------------------
// Sink Checks
// ---------------------------------------------------------------------------

function checkCallSink(
  node: t.CallExpression,
  state: TaintState,
  sinks: TaintSink[],
  sanitizers: TaintSanitizer[],
  flows: TaintFlow[],
  file: IndexedFile,
  sources: TaintSource[],
): void {
  const callText = nodeToSource(node, file.lines)
  const sink = matchesSink(callText, sinks)
  if (!sink) return

  for (const arg of node.arguments) {
    if (!t.isExpression(arg)) continue

    const argText = nodeToSource(arg, file.lines)

    // Direct source in argument
    const directSource = matchesSource(argText, sources)
    if (directSource) {
      const sanitizer = matchesSanitizer(callText, sanitizers)
      flows.push({
        source: directSource,
        sink,
        sanitized: !!sanitizer,
        sanitizer: sanitizer ?? undefined,
        path: [directSource.name, sink.name],
        file: file.path,
        startLine: node.loc?.start.line ?? 0,
        endLine: node.loc?.end.line ?? 0,
      })
      continue
    }

    // Tainted variable as argument
    const taintedRef = findTaintedInExpression(arg, state)
    if (taintedRef) {
      const taint = state.tainted.get(taintedRef)!
      flows.push({
        source: taint.source,
        sink,
        sanitized: false,
        path: [...taint.chain, sink.name],
        file: file.path,
        startLine: node.loc?.start.line ?? 0,
        endLine: node.loc?.end.line ?? 0,
      })
    }
  }
}

function checkAssignmentSink(
  node: t.AssignmentExpression,
  state: TaintState,
  sinks: TaintSink[],
  flows: TaintFlow[],
  file: IndexedFile,
): void {
  const lhsText = nodeToSource(node.left, file.lines)
  const fullText = `${lhsText} = `
  const sink = matchesSink(fullText, sinks)
  if (!sink) return

  const taintedRef = findTaintedInExpression(node.right, state)
  if (taintedRef) {
    const taint = state.tainted.get(taintedRef)!
    flows.push({
      source: taint.source,
      sink,
      sanitized: false,
      path: [...taint.chain, sink.name],
      file: file.path,
      startLine: node.loc?.start.line ?? 0,
      endLine: node.loc?.end.line ?? 0,
    })
  }
}

// ---------------------------------------------------------------------------
// TaintFlow → CodeIssue conversion
// ---------------------------------------------------------------------------

const SINK_SEVERITY_MAP: Record<string, IssueSeverity> = {
  'code-injection': 'critical',
  'sql-injection': 'critical',
  'command-injection': 'critical',
  'xss': 'warning',
  'ssrf': 'warning',
  'path-traversal': 'warning',
  'nosql-injection': 'warning',
}

const SINK_SUGGESTION_MAP: Record<string, string> = {
  'sql-injection': 'Use parameterized queries (prepared statements) instead of string concatenation.',
  'xss': 'Sanitize output with DOMPurify.sanitize() or use textContent instead of innerHTML.',
  'command-injection': 'Avoid exec(). Use a safe argument list with spawn() or a whitelist of allowed commands.',
  'code-injection': 'Replace eval() with JSON.parse() or a safe expression evaluator.',
  'ssrf': 'Validate and whitelist allowed URLs. Do not pass user input directly to fetch/axios.',
  'path-traversal': 'Use path.basename() or path.normalize() and validate against a whitelist.',
  'nosql-injection': 'Sanitize query inputs to prevent MongoDB operator injection. Reject objects with $-prefixed keys.',
}

/**
 * Convert taint flows into scanner-compatible CodeIssue objects.
 * Only unsanitized flows produce issues.
 */
export function taintFlowsToIssues(flows: TaintFlow[]): CodeIssue[] {
  const issues: CodeIssue[] = []

  for (const flow of flows) {
    if (flow.sanitized) continue

    const severity = SINK_SEVERITY_MAP[flow.sink.type] ?? 'warning'
    const ruleId = `taint-${flow.sink.type}`
    const pathStr = flow.path.join(' → ')
    const id = `${ruleId}-${flow.file}-${flow.startLine}`

    issues.push({
      id,
      ruleId,
      category: 'security',
      severity,
      title: `Unsanitized user input flows to ${flow.sink.name}`,
      description: `User input from \`${flow.source.name}\` flows through ${pathStr} to ${flow.sink.type} sink \`${flow.sink.name}\` without sanitization.`,
      file: flow.file,
      line: flow.startLine,
      column: 0,
      snippet: '',
      suggestion: SINK_SUGGESTION_MAP[flow.sink.type],
      cwe: flow.sink.cwe,
      confidence: 'high',
      taintFlow: {
        source: flow.source.name,
        sink: flow.sink.name,
        path: flow.path,
        startLine: flow.startLine,
        endLine: flow.endLine,
      },
    })
  }

  return issues
}
