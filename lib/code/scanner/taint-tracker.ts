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
import { getFileLines } from '../code-index'
import type { CodeIssue, IssueConfidence, IssueSeverity } from './types'

// CJS/ESM interop (same pattern as ast-analysis.ts)
const traverse = (
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default
) as typeof _traverse

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaintSinkType =
  | 'code-injection'
  | 'sql-injection'
  | 'xss'
  | 'command-injection'
  | 'path-traversal'
  | 'ssrf'
  | 'nosql-injection'

export type TaintSourceOrigin =
  | 'catalog-user-input'
  | 'catalog-browser-input'
  | 'synthetic-handler-param'

export type TaintPathPrecision = 'direct' | 'linear' | 'control-flow-approximate'

export interface TaintSource {
  type: string
  name: string
  pattern: RegExp
  description: string
  origin: TaintSourceOrigin
  baseConfidence: IssueConfidence
}

export interface TaintSink {
  type: TaintSinkType
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
  effect: 'sanitizes' | 'validates'
  appliesTo: readonly TaintSinkType[]
}

export interface TaintFlow {
  source: TaintSource
  sink: TaintSink
  sanitized: boolean
  sanitizer?: TaintSanitizer
  confidence: IssueConfidence
  precision: TaintPathPrecision
  mitigationEvidence: readonly TaintSanitizer[]
  path: string[]
  file: string
  startLine: number
  endLine: number
}

// ---------------------------------------------------------------------------
// Default Catalogs
// ---------------------------------------------------------------------------

const ALL_TAINT_SINK_TYPES: readonly TaintSinkType[] = [
  'code-injection',
  'sql-injection',
  'xss',
  'command-injection',
  'path-traversal',
  'ssrf',
  'nosql-injection',
]

function catalogSource(
  type: 'user-input' | 'browser-input',
  name: string,
  pattern: RegExp,
  description: string,
): TaintSource {
  return {
    type,
    name,
    pattern,
    description,
    origin: type === 'browser-input' ? 'catalog-browser-input' : 'catalog-user-input',
    baseConfidence: 'high',
  }
}

export const DEFAULT_SOURCES: readonly TaintSource[] = [
  catalogSource('user-input', 'req.body', /\breq\.body\b/, 'HTTP request body'),
  catalogSource('user-input', 'req.query', /\breq\.query\b/, 'HTTP query parameters'),
  catalogSource('user-input', 'req.params', /\breq\.params\b/, 'HTTP route parameters'),
  catalogSource('user-input', 'req.headers', /\breq\.headers\b/, 'HTTP request headers'),
  catalogSource('user-input', 'req.cookies', /\breq\.cookies\b/, 'HTTP cookies'),
  catalogSource('user-input', 'ctx.request.body', /\bctx\.request\.body\b/, 'Koa HTTP request body'),
  catalogSource('user-input', 'ctx.request.query', /\bctx\.request\.query\b/, 'Koa HTTP query parameters'),
  catalogSource('user-input', 'ctx.request.params', /\bctx\.request\.params\b/, 'Koa HTTP route parameters'),
  catalogSource('user-input', 'ctx.request.headers', /\bctx\.request\.headers\b/, 'Koa HTTP request headers'),
  catalogSource('browser-input', 'window.location', /\bwindow\.location\b/, 'Browser location'),
  catalogSource('browser-input', 'document.URL', /\bdocument\.URL\b/, 'Document URL'),
  catalogSource('browser-input', 'document.referrer', /\bdocument\.referrer\b/, 'Document referrer'),
  catalogSource('browser-input', 'document.cookie', /\bdocument\.cookie\b/, 'Document cookies'),
  catalogSource('user-input', 'URLSearchParams', /\bnew\s+URLSearchParams\b/, 'URL search params'),
  catalogSource('user-input', 'FormData', /\bnew\s+FormData\b/, 'Form data'),
  // Cross-origin messaging
  catalogSource('browser-input', 'event.data', /\bevent\.data\b/, 'postMessage event data'),
  // WebSocket messages
  catalogSource('user-input', 'ws.message', /\.on\s*\(\s*['"]message['"]/, 'WebSocket message data'),
  // URL fragment
  catalogSource('browser-input', 'location.hash', /\blocation\.hash\b/, 'URL fragment'),
  // URL search string
  catalogSource('browser-input', 'location.search', /\blocation\.search\b/, 'URL search string'),
  // Clipboard API
  catalogSource('browser-input', 'clipboard.readText', /\bclipboard\.readText\s*\(/, 'Clipboard text content'),
  // Storage
  catalogSource('browser-input', 'localStorage.getItem', /\blocalStorage\.getItem\s*\(/, 'localStorage stored data'),
  catalogSource('browser-input', 'sessionStorage.getItem', /\bsessionStorage\.getItem\s*\(/, 'sessionStorage stored data'),
]

export const DEFAULT_SINKS: readonly TaintSink[] = [
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

export const DEFAULT_SANITIZERS: readonly TaintSanitizer[] = [
  { type: 'html-escape', name: 'DOMPurify.sanitize()', pattern: /\bDOMPurify\.sanitize\b/, effect: 'sanitizes', appliesTo: ['xss'] },
  { type: 'encoding', name: 'encodeURIComponent()', pattern: /\bencodeURIComponent\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'encoding', name: 'encodeURI()', pattern: /\bencodeURI\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'type-cast', name: 'parseInt()', pattern: /\bparseInt\s*\(/, effect: 'sanitizes', appliesTo: ['sql-injection', 'nosql-injection'] },
  { type: 'type-cast', name: 'parseFloat()', pattern: /\bparseFloat\s*\(/, effect: 'sanitizes', appliesTo: ['sql-injection', 'nosql-injection'] },
  { type: 'type-cast', name: 'Number()', pattern: /\bNumber\s*\(/, effect: 'sanitizes', appliesTo: ['sql-injection', 'nosql-injection'] },
  { type: 'type-cast', name: 'Boolean()', pattern: /\bBoolean\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'validation', name: 'validator', pattern: /\bvalidator\./, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'sanitization', name: 'sanitize', pattern: /\bsanitize\w*\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'html-escape', name: 'escapeHtml', pattern: /\bescapeHtml\s*\(/, effect: 'sanitizes', appliesTo: ['xss'] },
  { type: 'sql-escape', name: 'escapeSql', pattern: /\bescapeSql\s*\(/, effect: 'sanitizes', appliesTo: ['sql-injection'] },
  { type: 'validation', name: 'escape', pattern: /\bescape(?:RegExp)?\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'sanitization', name: 'xss()', pattern: /\bxss\s*\(/, effect: 'sanitizes', appliesTo: ['xss'] },
  { type: 'path-sanitization', name: 'path.basename()', pattern: /\bpath\.basename\s*\(/, effect: 'sanitizes', appliesTo: ['path-traversal'] },
  { type: 'path-sanitization', name: 'path.normalize()', pattern: /\bpath\.normalize\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  // The `?` placeholder is the last char INSIDE the SQL string literal, so the
  // next char is the closing quote, not the comma: `db.query("... = ?", [id])`.
  // Allow one optional quote/backtick between the placeholder and the comma.
  { type: 'parameterized', name: 'parameterized query', pattern: /\?\s*['"`]?\s*,|\$\d+/, effect: 'sanitizes', appliesTo: ['sql-injection'] },
  // HTML encoding
  { type: 'encoding', name: 'he.encode', pattern: /\bhe\.(encode|escape)\s*\(/, effect: 'sanitizes', appliesTo: ['xss'] },
  // Schema validation is mitigation evidence, not proof of sanitization.
  { type: 'validation', name: 'zod.parse', pattern: /\.parse\s*\(|\.safeParse\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'validation', name: 'joi.validate', pattern: /\.validate\s*\(|Joi\.\w+\(\)/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  { type: 'validation', name: 'yup.validate', pattern: /\.validate\s*\(|\.validateSync\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  // Express validation
  { type: 'validation', name: 'express-validator', pattern: /\b(check|body|param|query|validationResult)\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  // SQL escaping
  { type: 'encoding', name: 'sqlstring.escape', pattern: /\bsqlstring\.escape\s*\(|\.escapeLiteral\s*\(|\.escapeIdentifier\s*\(/, effect: 'sanitizes', appliesTo: ['sql-injection'] },
  // XSS filters
  { type: 'encoding', name: 'xss-filters', pattern: /\bxssFilters\.\w+\s*\(/, effect: 'sanitizes', appliesTo: ['xss'] },
  // Parameterized templates
  { type: 'parameterized', name: 'sql-tagged-template', pattern: /\bsql`/, effect: 'sanitizes', appliesTo: ['sql-injection'] },
  // Helmet middleware
  { type: 'middleware', name: 'helmet', pattern: /\bhelmet\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
  // CSRF protection
  { type: 'middleware', name: 'csrf', pattern: /\bcsurf\s*\(|\bcsrf\s*\(/, effect: 'validates', appliesTo: ALL_TAINT_SINK_TYPES },
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

function matchesSource(text: string, sources: readonly TaintSource[]): TaintSource | undefined {
  return sources.find(source => execPattern(source.pattern, text))
}

function matchesSink(text: string, sinks: readonly TaintSink[]): TaintSink | undefined {
  return sinks.find(sink => execPattern(sink.pattern, text))
}

interface MatchRange {
  start: number
  end: number
}

/** Exec a catalog pattern without letting a caller-supplied /g or /y regex carry lastIndex state. */
function execPattern(pattern: RegExp, text: string): RegExpExecArray | null {
  if (pattern.global || pattern.sticky) pattern.lastIndex = 0
  return pattern.exec(text)
}

/** Like matchesSink, but also reports where in `text` the sink pattern matched. */
function matchSinkRange(
  text: string,
  sinks: readonly TaintSink[],
): { sink: TaintSink; range: MatchRange } | undefined {
  for (const s of sinks) {
    const m = execPattern(s.pattern, text)
    if (m) return { sink: s, range: { start: m.index, end: m.index + m[0].length } }
  }
  return undefined
}

/**
 * Find sanitizer matches that do not overlap the sink or a more specific
 * sanitizer already matched at the same source range.
 *
 * A sink's own call text must never be read as its own sanitizer: `db.query(`
 * contains `query(`, which the express-validator sanitizer pattern matches, so
 * every inline SQL-injection flow was silently stamped as sanitized.
 */
function matchesSanitizersOutside(
  text: string,
  sanitizers: readonly TaintSanitizer[],
  exclude?: MatchRange,
): TaintSanitizer[] {
  const matches: Array<{ sanitizer: TaintSanitizer; range: MatchRange }> = []
  for (const sanitizer of sanitizers) {
    const flags = sanitizer.pattern.flags.includes('g') ? sanitizer.pattern.flags : `${sanitizer.pattern.flags}g`
    const scan = new RegExp(sanitizer.pattern.source, flags)
    let m: RegExpExecArray | null
    while ((m = scan.exec(text)) !== null) {
      if (m[0].length === 0) {
        scan.lastIndex++
        continue
      }
      const start = m.index
      const end = start + m[0].length
      const range = { start, end }
      const overlapsSink = exclude && start < exclude.end && end > exclude.start
      const overlapsCatalogMatch = matches.some(existing => (
        start < existing.range.end && end > existing.range.start
      ))
      if (!overlapsSink && !overlapsCatalogMatch) {
        matches.push({ sanitizer, range })
      }
    }
  }
  return matches.map(match => match.sanitizer)
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
  transformations: TaintSanitizer[]
  precision: TaintPathPrecision
}

interface TaintState {
  tainted: Map<string, TaintEntry>
}

function createTaintState(): TaintState {
  return { tainted: new Map() }
}

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

interface TaintOptions {
  sources?: readonly TaintSource[]
  sinks?: readonly TaintSink[]
  sanitizers?: readonly TaintSanitizer[]
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

  if (!file.content) return flows
  const content = file.content
  const lines = getFileLines(file)

  // Guard: skip taint analysis on very large files to avoid UI freezing
  if (content.length > MAX_TAINT_FILE_BYTES || lines.length > MAX_TAINT_FILE_LINES) {
    return flows
  }

  try {
    traverse(ast, {
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod'(
        fnPath: NodePath,
      ) {
        const state = createTaintState()
        const node = fnPath.node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ClassMethod

        // Mark function params with source-like names as tainted
        for (const param of node.params) {
          markParamTaint(param, state, sources, lines)
        }

        // Walk only this function body. The outer traversal will visit each
        // nested function independently with fresh state.
        fnPath.traverse({
          'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod'(
            nestedPath: NodePath,
          ) {
            nestedPath.skip()
          },

          VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
            processDeclarator(
              path.node,
              state,
              sources,
              sanitizers,
              lines,
              isControlFlowApproximate(path, fnPath),
            )
          },

          AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
            const controlFlowApproximate = isControlFlowApproximate(path, fnPath)
            processAssignment(path.node, state, sources, sanitizers, lines, controlFlowApproximate)
            checkAssignmentSink(
              path.node,
              state,
              sources,
              sinks,
              sanitizers,
              flows,
              file,
              controlFlowApproximate,
            )
          },

          CallExpression(path: NodePath<t.CallExpression>) {
            checkCallSink(
              path.node,
              state,
              sinks,
              sanitizers,
              flows,
              file,
              sources,
              isControlFlowApproximate(path, fnPath),
            )
          },
        })
      },
    })
  } catch (error) {
    // AST traversal errors should not crash the scanner
    console.warn('[taint-tracker] AST traversal failed for', file.path, error)
  }

  return flows
}

function isControlFlowApproximate(path: NodePath, functionPath: NodePath): boolean {
  let parent = path.parentPath
  while (parent && parent !== functionPath) {
    if (
      parent.isIfStatement()
      || parent.isConditionalExpression()
      || parent.isLogicalExpression()
      || parent.isSwitchCase()
      || parent.isLoop()
      || parent.isTryStatement()
      || parent.isCatchClause()
    ) {
      return true
    }
    parent = parent.parentPath
  }
  return false
}

// ---------------------------------------------------------------------------
// Param Tainting
// ---------------------------------------------------------------------------

// Common Express/Fastify/Koa handler parameter names that typically carry
// user-controlled data. When these appear as function parameters (e.g. in
// `(req, res) => { ... }` patterns), we auto-taint them with a synthetic
// source so taint flows from `req.anything` are tracked even without an
// explicit `req.body` / `req.query` match.
const AUTO_TAINT_PARAM_NAMES = new Set(['req', 'request'])

/** Escape special regex metacharacters in a string for safe use in `new RegExp()`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function markParamTaint(
  param: t.Node,
  state: TaintState,
  sources: readonly TaintSource[],
  lines: string[],
): void {
  if (t.isIdentifier(param)) {
    const text = nodeToSource(param, lines)
    const source = matchesSource(text, sources)
    if (source) {
      state.tainted.set(param.name, {
        source,
        chain: [param.name],
        transformations: [],
        precision: 'direct',
      })
    } else if (AUTO_TAINT_PARAM_NAMES.has(param.name)) {
      // Auto-taint common request parameter names
      const syntheticSource: TaintSource = {
        type: 'user-input',
        name: param.name,
        pattern: new RegExp(`\\b${escapeRegExp(param.name)}\\b`),
        description: `HTTP request object (${param.name})`,
        origin: 'synthetic-handler-param',
        baseConfidence: 'medium',
      }
      state.tainted.set(param.name, {
        source: syntheticSource,
        chain: [param.name],
        transformations: [],
        precision: 'direct',
      })
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
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
  controlFlowApproximate: boolean,
): void {
  if (!node.init) return
  const varName = getIdentifierName(node.id)
  if (!varName) return
  processBinding(varName, node.init, state, sources, sanitizers, lines, controlFlowApproximate)
}

function processAssignment(
  node: t.AssignmentExpression,
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
  controlFlowApproximate: boolean,
): void {
  const varName = getIdentifierName(node.left)
  if (!varName) return
  processBinding(varName, node.right, state, sources, sanitizers, lines, controlFlowApproximate)
}

function processBinding(
  varName: string,
  rhs: t.Expression,
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
  controlFlowApproximate: boolean,
): void {
  const rhsText = nodeToSource(rhs, lines)
  const transformations = matchesSanitizersOutside(rhsText, sanitizers)
  const expressionIsApproximate = controlFlowApproximate
    || t.isConditionalExpression(rhs)
    || t.isLogicalExpression(rhs)

  // 1. Check if RHS is a direct source. Transformations stay attached to the
  // taint entry until a concrete sink can decide whether they are compatible.
  const source = matchesSource(rhsText, sources)
  if (source) {
    state.tainted.set(varName, {
      source,
      chain: [source.name, varName],
      transformations,
      precision: expressionIsApproximate ? 'control-flow-approximate' : 'linear',
    })
    return
  }

  // 2. Check if RHS references a tainted variable (propagation).
  const taintedRef = findTaintedInExpression(rhs, state)
  if (taintedRef) {
    const existing = state.tainted.get(taintedRef)!
    state.tainted.set(varName, {
      source: existing.source,
      chain: [...existing.chain, varName],
      transformations: mergeTransformations(existing.transformations, transformations),
      precision: expressionIsApproximate
        ? 'control-flow-approximate'
        : promotePrecision(existing.precision, 'linear'),
    })
    return
  }

  // 3. A safe assignment in only one branch cannot clear taint from the
  // merged approximation; an unconditional safe reassignment still can.
  if (controlFlowApproximate) {
    const existing = state.tainted.get(varName)
    if (existing) existing.precision = 'control-flow-approximate'
    return
  }
  state.tainted.delete(varName)
}

function mergeTransformations(
  existing: readonly TaintSanitizer[],
  added: readonly TaintSanitizer[],
): TaintSanitizer[] {
  const merged = [...existing]
  for (const sanitizer of added) {
    if (!merged.includes(sanitizer)) merged.push(sanitizer)
  }
  return merged
}

function promotePrecision(
  current: TaintPathPrecision,
  next: TaintPathPrecision,
): TaintPathPrecision {
  if (current === 'control-flow-approximate' || next === 'control-flow-approximate') {
    return 'control-flow-approximate'
  }
  if (current === 'linear' || next === 'linear') return 'linear'
  return 'direct'
}

/** Recursively check if an expression references a tainted variable. */
function findTaintedInExpression(
  node: t.Expression | t.Node,
  state: TaintState,
): string | null {
  if (t.isIdentifier(node)) {
    if (state.tainted.has(node.name)) return node.name
  }

  if (t.isMemberExpression(node)) {
    const fullName = getIdentifierName(node)
    if (fullName && state.tainted.has(fullName)) {
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
  sinks: readonly TaintSink[],
  sanitizers: readonly TaintSanitizer[],
  flows: TaintFlow[],
  file: IndexedFile,
  sources: readonly TaintSource[],
  controlFlowApproximate: boolean,
): void {
  const callText = nodeToSource(node, getFileLines(file))
  const sinkMatch = matchSinkRange(callText, sinks)
  if (!sinkMatch) return
  const { sink, range: sinkRange } = sinkMatch

  for (const arg of node.arguments) {
    if (!t.isExpression(arg)) continue

    const argText = nodeToSource(arg, getFileLines(file))

    // Direct source in argument
    const directSource = matchesSource(argText, sources)
    if (directSource) {
      const transformations = matchesSanitizersOutside(callText, sanitizers, sinkRange)
      flows.push(createFlow({
        source: directSource,
        chain: [directSource.name],
        transformations,
        precision: controlFlowApproximate || t.isConditionalExpression(arg) || t.isLogicalExpression(arg)
          ? 'control-flow-approximate'
          : 'direct',
      }, sink, file, node))
      continue
    }

    // Tainted variable as argument
    const taintedRef = findTaintedInExpression(arg, state)
    if (taintedRef) {
      const taint = state.tainted.get(taintedRef)!
      const callTransformations = matchesSanitizersOutside(callText, sanitizers, sinkRange)
      flows.push(createFlow({
        ...taint,
        transformations: mergeTransformations(taint.transformations, callTransformations),
        precision: controlFlowApproximate || t.isConditionalExpression(arg) || t.isLogicalExpression(arg)
          ? 'control-flow-approximate'
          : taint.precision,
      }, sink, file, node))
    }
  }
}

interface FlowLocation {
  loc?: t.SourceLocation | null
}

function createFlow(
  taint: TaintEntry,
  sink: TaintSink,
  file: IndexedFile,
  location: FlowLocation,
): TaintFlow {
  const applicableTransformations = taint.transformations.filter(transformation => (
    transformation.appliesTo.includes(sink.type)
  ))
  const sanitizer = applicableTransformations.find(transformation => transformation.effect === 'sanitizes')
  const mitigationEvidence = applicableTransformations.filter(transformation => transformation.effect === 'validates')
  return {
    source: taint.source,
    sink,
    sanitized: sanitizer !== undefined,
    sanitizer,
    confidence: flowConfidence(taint.source.baseConfidence, taint.precision, mitigationEvidence.length),
    precision: taint.precision,
    mitigationEvidence,
    path: [...taint.chain, sink.name],
    file: file.path,
    startLine: location.loc?.start.line ?? 0,
    endLine: location.loc?.end.line ?? 0,
  }
}

function flowConfidence(
  baseConfidence: IssueConfidence,
  precision: TaintPathPrecision,
  mitigationCount: number,
): IssueConfidence {
  let confidence: IssueConfidence = precision === 'control-flow-approximate' && baseConfidence === 'high'
    ? 'medium'
    : baseConfidence
  for (let index = 0; index < mitigationCount; index++) {
    confidence = confidence === 'high' ? 'medium' : 'low'
  }
  return confidence
}

function checkAssignmentSink(
  node: t.AssignmentExpression,
  state: TaintState,
  sources: readonly TaintSource[],
  sinks: readonly TaintSink[],
  sanitizers: readonly TaintSanitizer[],
  flows: TaintFlow[],
  file: IndexedFile,
  controlFlowApproximate: boolean,
): void {
  const lines = getFileLines(file)
  const lhsText = nodeToSource(node.left, lines)
  const fullText = `${lhsText} = `
  const sink = matchesSink(fullText, sinks)
  if (!sink) return

  const rhsText = nodeToSource(node.right, lines)
  const transformations = matchesSanitizersOutside(rhsText, sanitizers)
  const directSource = matchesSource(rhsText, sources)
  if (directSource) {
    flows.push(createFlow({
      source: directSource,
      chain: [directSource.name],
      transformations,
      precision: controlFlowApproximate
        || t.isConditionalExpression(node.right)
        || t.isLogicalExpression(node.right)
        ? 'control-flow-approximate'
        : 'direct',
    }, sink, file, node))
    return
  }

  const taintedRef = findTaintedInExpression(node.right, state)
  if (taintedRef) {
    const taint = state.tainted.get(taintedRef)!
    flows.push(createFlow({
      ...taint,
      transformations: mergeTransformations(taint.transformations, transformations),
      precision: controlFlowApproximate
        || t.isConditionalExpression(node.right)
        || t.isLogicalExpression(node.right)
        ? 'control-flow-approximate'
        : taint.precision,
    }, sink, file, node))
  }
}

// ---------------------------------------------------------------------------
// TaintFlow → CodeIssue conversion
// ---------------------------------------------------------------------------

const SINK_SUGGESTION_MAP: Record<TaintSinkType, string> = {
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

    const ruleId = `taint-${flow.sink.type}`
    const pathStr = flow.path.join(' → ')
    const id = `${ruleId}-${flow.file}-${flow.startLine}`

    issues.push({
      id,
      ruleId,
      category: 'security',
      severity: flow.sink.severity,
      title: `Unsanitized user input flows to ${flow.sink.name}`,
      description: `User input from \`${flow.source.name}\` flows through ${pathStr} to ${flow.sink.type} sink \`${flow.sink.name}\` without sanitization.`,
      file: flow.file,
      line: flow.startLine,
      column: 0,
      snippet: '',
      suggestion: SINK_SUGGESTION_MAP[flow.sink.type],
      cwe: flow.sink.cwe,
      confidence: flow.confidence,
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
