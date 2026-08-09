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
  { type: 'nosql-injection', name: 'Model.find()', pattern: /(?:\b(?:Model|model|collection|[A-Za-z_$][\w$]*(?:Model|Collection))|\b[A-Z][\w$]*|\b(?:db\.collection|mongoose\.model)\s*\([^)]*\))\.(?:find|findOne|findById|findOneAndUpdate|aggregate|where)\s*\(/, cwe: 'CWE-943', severity: 'warning', description: 'MongoDB/Mongoose query with potential operator injection' },
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

/** Exec a catalog pattern without letting a caller-supplied /g or /y regex carry lastIndex state. */
function execPattern(pattern: RegExp, text: string): RegExpExecArray | null {
  if (pattern.global || pattern.sticky) pattern.lastIndex = 0
  return pattern.exec(text)
}

function matchesSource(text: string, sources: readonly TaintSource[]): TaintSource | undefined {
  return sources.find(source => execPattern(source.pattern, text)?.index === 0)
}

function matchesSink(text: string, sinks: readonly TaintSink[]): TaintSink | undefined {
  return sinks.find(sink => execPattern(sink.pattern, text))
}

/** Normalize dot and string-literal member access to one catalog path. */
function getMemberPath(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name
  if (t.isThisExpression(node)) return 'this'
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const objectName = getMemberPath(node.object)
    if (!objectName) return null
    let propertyName: string | null = null
    if (!node.computed && t.isIdentifier(node.property)) propertyName = node.property.name
    if (node.computed && t.isStringLiteral(node.property)) propertyName = node.property.value
    if (node.computed && t.isNumericLiteral(node.property)) propertyName = String(node.property.value)
    if (propertyName !== null) return `${objectName}.${propertyName}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Taint State per Function Scope
// ---------------------------------------------------------------------------

interface TaintTransformationOccurrence {
  sanitizer: TaintSanitizer
  occurrence: string
}

interface TaintAlternative {
  source: TaintSource
  chain: string[]
  transformations: TaintTransformationOccurrence[]
  precision: TaintPathPrecision
}

interface TaintState {
  tainted: Map<string, TaintAlternative[]>
  aliases: Map<string, TaintSanitizer>
}

function createTaintState(): TaintState {
  return { tainted: new Map(), aliases: new Map() }
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
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod'(
        fnPath: NodePath,
      ) {
        const state = createTaintState()
        const node = fnPath.node as t.Function

        // Mark function params with source-like names as tainted
        for (const param of node.params) {
          markParamTaint(param, state)
        }

        // Walk only this function body. The outer traversal will visit each
        // nested function independently with fresh state.
        fnPath.traverse({
          'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod'(
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
              path.parentPath?.isVariableDeclaration({ kind: 'const' }) ?? false,
            )
          },

          AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
            const controlFlowApproximate = isControlFlowApproximate(path, fnPath)
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
            processAssignment(path.node, state, sources, sanitizers, lines, controlFlowApproximate)
          },

          'CallExpression|OptionalCallExpression'(path: NodePath) {
            const invocation = path.node as t.CallExpression | t.OptionalCallExpression
            checkInvocationSink(
              invocation,
              state,
              sinks,
              sanitizers,
              flows,
              file,
              sources,
              isControlFlowApproximate(path, fnPath),
            )
          },

          NewExpression(path: NodePath<t.NewExpression>) {
            checkInvocationSink(
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

// Common Express/Fastify handler parameter names that typically carry
// user-controlled data. When these appear as function parameters (e.g. in
// `(req, res) => { ... }` patterns), we auto-taint them with a synthetic
// source so taint flows from `req.anything` are tracked even without an
// explicit `req.body` / `req.query` match.
const AUTO_TAINT_PARAM_NAMES = new Set(['req', 'request'])

/** Escape special regex metacharacters in a string for safe use in `new RegExp()`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function markParamTaint(param: t.Node, state: TaintState): void {
  if (t.isIdentifier(param)) {
    if (AUTO_TAINT_PARAM_NAMES.has(param.name)) {
      // Auto-taint common request parameter names
      const syntheticSource: TaintSource = {
        type: 'user-input',
        name: param.name,
        pattern: new RegExp(`\\b${escapeRegExp(param.name)}\\b`),
        description: `HTTP request object (${param.name})`,
        origin: 'synthetic-handler-param',
        baseConfidence: 'medium',
      }
      state.tainted.set(param.name, [{
        source: syntheticSource,
        chain: [param.name],
        transformations: [],
        precision: 'direct',
      }])
    }
    return
  }
  if (t.isObjectPattern(param)) {
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop)) markParamTaint(prop.value, state)
      if (t.isRestElement(prop)) markParamTaint(prop.argument, state)
    }
    return
  }
  if (t.isArrayPattern(param)) {
    for (const element of param.elements) {
      if (element) markParamTaint(element, state)
    }
    return
  }
  if (t.isAssignmentPattern(param)) markParamTaint(param.left, state)
  if (t.isRestElement(param)) markParamTaint(param.argument, state)
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
  immutable: boolean,
): void {
  if (!node.init) return
  if (immutable && t.isIdentifier(node.id)) {
    const alias = matchSanitizerReference(node.init, sanitizers, lines)
    if (alias) {
      state.aliases.set(node.id.name, alias)
      state.tainted.delete(node.id.name)
      return
    }
  }
  const alternatives = expressionAlternatives(node.init, state, sources, sanitizers, lines)
  bindPattern(
    node.id,
    alternatives,
    state,
    controlFlowApproximate,
    sources,
    sanitizers,
    lines,
    getMemberPath(node.init),
  )
}

function processAssignment(
  node: t.AssignmentExpression,
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
  controlFlowApproximate: boolean,
): void {
  const alternatives = expressionAlternatives(node.right, state, sources, sanitizers, lines)
  bindPattern(
    node.left,
    alternatives,
    state,
    controlFlowApproximate,
    sources,
    sanitizers,
    lines,
    getMemberPath(node.right),
  )
}

function bindPattern(
  pattern: t.Node,
  alternatives: readonly TaintAlternative[],
  state: TaintState,
  controlFlowApproximate: boolean,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
  sourceBasePath: string | null = null,
): void {
  if (t.isIdentifier(pattern)) {
    state.aliases.delete(pattern.name)
    const assigned = alternatives.map(alternative => ({
      ...alternative,
      chain: [...alternative.chain, pattern.name],
      transformations: [...alternative.transformations],
      precision: controlFlowApproximate
        ? 'control-flow-approximate' as const
        : promotePrecision(alternative.precision, 'linear'),
    }))
    if (controlFlowApproximate) {
      const previous = (state.tainted.get(pattern.name) ?? []).map(markApproximate)
      const merged = dedupeAlternatives([...previous, ...assigned])
      if (merged.length > 0) state.tainted.set(pattern.name, merged)
      return
    }
    if (assigned.length > 0) state.tainted.set(pattern.name, dedupeAlternatives(assigned))
    else state.tainted.delete(pattern.name)
    return
  }
  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isObjectProperty(property)) {
        const propertyName = getObjectPropertyName(property)
        const childSourcePath = sourceBasePath && propertyName !== null
          ? `${sourceBasePath}.${propertyName}`
          : null
        const explicitSource = childSourcePath ? matchesSource(childSourcePath, sources) : undefined
        bindPattern(
          property.value,
          explicitSource ? [sourceAlternative(explicitSource)] : alternatives,
          state,
          controlFlowApproximate,
          sources,
          sanitizers,
          lines,
          childSourcePath,
        )
      }
      if (t.isRestElement(property)) {
        const explicitRestSources = sourceBasePath
          ? sources.filter(source => source.name.startsWith(`${sourceBasePath}.`)).map(sourceAlternative)
          : []
        bindPattern(
          property.argument,
          explicitRestSources.length > 0 ? explicitRestSources : alternatives,
          state,
          controlFlowApproximate,
          sources,
          sanitizers,
          lines,
          sourceBasePath,
        )
      }
    }
    return
  }
  if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element) {
        bindPattern(element, alternatives, state, controlFlowApproximate, sources, sanitizers, lines, sourceBasePath)
      }
    }
    return
  }
  if (t.isAssignmentPattern(pattern)) {
    const defaults = expressionAlternatives(pattern.right, state, sources, sanitizers, lines)
    bindPattern(
      pattern.left,
      dedupeAlternatives([...alternatives, ...defaults]),
      state,
      controlFlowApproximate,
      sources,
      sanitizers,
      lines,
      sourceBasePath,
    )
    return
  }
  if (t.isRestElement(pattern)) {
    bindPattern(
      pattern.argument,
      alternatives,
      state,
      controlFlowApproximate,
      sources,
      sanitizers,
      lines,
      sourceBasePath,
    )
    return
  }
  const memberName = getMemberPath(pattern)
  if (!memberName) return
  if (controlFlowApproximate) {
    const previous = (state.tainted.get(memberName) ?? []).map(markApproximate)
    const merged = dedupeAlternatives([...previous, ...alternatives.map(markApproximate)])
    if (merged.length > 0) state.tainted.set(memberName, merged)
  } else if (alternatives.length > 0) {
    state.tainted.set(memberName, dedupeAlternatives(alternatives))
  } else {
    state.tainted.delete(memberName)
  }
}

function getObjectPropertyName(property: t.ObjectProperty): string | null {
  if (!property.computed && t.isIdentifier(property.key)) return property.key.name
  if (t.isStringLiteral(property.key)) return property.key.value
  if (t.isNumericLiteral(property.key)) return String(property.key.value)
  return null
}

function markApproximate(alternative: TaintAlternative): TaintAlternative {
  return { ...alternative, transformations: [...alternative.transformations], precision: 'control-flow-approximate' }
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

function dedupeAlternatives(alternatives: readonly TaintAlternative[]): TaintAlternative[] {
  const seen = new Set<string>()
  return alternatives.filter(alternative => {
    const key = [
      alternative.source.name,
      alternative.chain.join('\u0000'),
      alternative.precision,
      alternative.transformations.map(item => item.occurrence).sort().join('\u0000'),
    ].join('\u0001')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceForNode(
  node: t.Node,
  sources: readonly TaintSource[],
  lines: string[],
): TaintSource | undefined {
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const memberPath = getMemberPath(node)
    return memberPath ? matchesSource(memberPath, sources) : undefined
  }
  if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
    return matchesSource(`${nodeToSource(node.callee, lines)}(`, sources)
  }
  if (t.isNewExpression(node)) {
    return matchesSource(`new ${nodeToSource(node.callee, lines)}(`, sources)
  }
  return undefined
}

function sourceAlternative(source: TaintSource): TaintAlternative {
  return { source, chain: [source.name], transformations: [], precision: 'direct' }
}

function expressionAlternatives(
  node: t.Node,
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
): TaintAlternative[] {
  const directSource = sourceForNode(node, sources, lines)
  if (directSource) return [sourceAlternative(directSource)]

  if (t.isIdentifier(node)) {
    return cloneAlternatives(state.tainted.get(node.name) ?? [])
  }
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const memberName = getMemberPath(node)
    const exact = memberName ? state.tainted.get(memberName) : undefined
    if (exact) return cloneAlternatives(exact)
    return expressionAlternatives(node.object, state, sources, sanitizers, lines)
  }
  if (t.isTemplateLiteral(node)) {
    return combineNodes(node.expressions, state, sources, sanitizers, lines)
  }
  if (t.isBinaryExpression(node)) {
    return combineNodes([node.left, node.right], state, sources, sanitizers, lines)
  }
  if (t.isLogicalExpression(node) || t.isConditionalExpression(node)) {
    const nodes = t.isLogicalExpression(node)
      ? [node.left, node.right]
      : [node.consequent, node.alternate]
    return combineNodes(nodes, state, sources, sanitizers, lines).map(markApproximate)
  }
  if (t.isCallExpression(node) || t.isOptionalCallExpression(node) || t.isNewExpression(node)) {
    const alternatives = combineArguments(node.arguments, state, sources, sanitizers, lines)
    const sanitizer = matchSanitizerInvocation(node, state, sanitizers, lines)
    return sanitizer ? applyTransformation(alternatives, sanitizer, node) : alternatives
  }
  if (t.isTaggedTemplateExpression(node)) {
    const alternatives = combineNodes(node.quasi.expressions, state, sources, sanitizers, lines)
    const sanitizer = selectSpecificSanitizer(`${nodeToSource(node.tag, lines)}\``, sanitizers)
    return sanitizer ? applyTransformation(alternatives, sanitizer, node) : alternatives
  }
  if (t.isAwaitExpression(node)) {
    return expressionAlternatives(node.argument, state, sources, sanitizers, lines)
  }
  if (t.isObjectExpression(node)) {
    const values: t.Node[] = []
    for (const property of node.properties) {
      if (t.isObjectProperty(property)) values.push(property.value)
      if (t.isSpreadElement(property)) values.push(property.argument)
    }
    return combineNodes(values, state, sources, sanitizers, lines)
  }
  if (t.isArrayExpression(node)) {
    return combineNodes(node.elements.filter((element): element is t.Expression | t.SpreadElement => element !== null), state, sources, sanitizers, lines)
  }
  if (t.isSpreadElement(node)) {
    return expressionAlternatives(node.argument, state, sources, sanitizers, lines)
  }
  if (t.isAssignmentExpression(node)) {
    return expressionAlternatives(node.right, state, sources, sanitizers, lines)
  }
  if (t.isSequenceExpression(node)) {
    const last = node.expressions.at(-1)
    return last ? expressionAlternatives(last, state, sources, sanitizers, lines) : []
  }
  if (t.isUnaryExpression(node) || t.isUpdateExpression(node)) {
    return expressionAlternatives(node.argument, state, sources, sanitizers, lines)
  }
  if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node) || t.isTSNonNullExpression(node)) {
    return expressionAlternatives(node.expression, state, sources, sanitizers, lines)
  }
  if (t.isParenthesizedExpression(node)) {
    return expressionAlternatives(node.expression, state, sources, sanitizers, lines)
  }
  return []
}

function cloneAlternatives(alternatives: readonly TaintAlternative[]): TaintAlternative[] {
  return alternatives.map(alternative => ({
    ...alternative,
    chain: [...alternative.chain],
    transformations: [...alternative.transformations],
  }))
}

function combineNodes(
  nodes: readonly t.Node[],
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
): TaintAlternative[] {
  return dedupeAlternatives(nodes.flatMap(node => expressionAlternatives(node, state, sources, sanitizers, lines)))
}

function combineArguments(
  args: readonly (t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder)[],
  state: TaintState,
  sources: readonly TaintSource[],
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
): TaintAlternative[] {
  const nodes = args.filter((arg): arg is t.Expression | t.SpreadElement => t.isExpression(arg) || t.isSpreadElement(arg))
  return combineNodes(nodes, state, sources, sanitizers, lines)
}

function selectSpecificSanitizer(
  text: string,
  sanitizers: readonly TaintSanitizer[],
): TaintSanitizer | undefined {
  const matches = sanitizers.flatMap((sanitizer, index) => {
    if (sanitizer.name === 'parameterized query') return []
    const match = execPattern(sanitizer.pattern, text)
    return match ? [{ sanitizer, index, length: match[0].length }] : []
  })
  matches.sort((left, right) => (
    right.length - left.length
    || right.sanitizer.pattern.source.length - left.sanitizer.pattern.source.length
    || left.index - right.index
  ))
  return matches[0]?.sanitizer
}

type InvocationNode = t.CallExpression | t.OptionalCallExpression | t.NewExpression

function matchSanitizerInvocation(
  node: InvocationNode,
  state: TaintState,
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
): TaintSanitizer | undefined {
  if (t.isIdentifier(node.callee)) {
    const alias = state.aliases.get(node.callee.name)
    if (alias) return alias
  }
  const prefix = t.isNewExpression(node) ? 'new ' : ''
  return selectSpecificSanitizer(`${prefix}${nodeToSource(node.callee, lines)}(`, sanitizers)
}

function matchSanitizerReference(
  node: t.Expression,
  sanitizers: readonly TaintSanitizer[],
  lines: string[],
): TaintSanitizer | undefined {
  if (!t.isIdentifier(node) && !t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return undefined
  const sanitizer = selectSpecificSanitizer(`${nodeToSource(node, lines)}(`, sanitizers)
  return sanitizer?.effect === 'sanitizes' ? sanitizer : undefined
}

function transformationOccurrence(sanitizer: TaintSanitizer, node: t.Node): TaintTransformationOccurrence {
  const start = node.start ?? node.loc?.start.line ?? 0
  const end = node.end ?? node.loc?.end.line ?? 0
  return { sanitizer, occurrence: `${sanitizer.name}:${start}:${end}` }
}

function applyTransformation(
  alternatives: readonly TaintAlternative[],
  sanitizer: TaintSanitizer,
  node: t.Node,
): TaintAlternative[] {
  const occurrence = transformationOccurrence(sanitizer, node)
  return alternatives.map(alternative => ({
    ...alternative,
    transformations: alternative.transformations.some(item => item.occurrence === occurrence.occurrence)
      ? [...alternative.transformations]
      : [...alternative.transformations, occurrence],
  }))
}

// ---------------------------------------------------------------------------
// Sink Checks
// ---------------------------------------------------------------------------

function checkInvocationSink(
  node: InvocationNode,
  state: TaintState,
  sinks: readonly TaintSink[],
  sanitizers: readonly TaintSanitizer[],
  flows: TaintFlow[],
  file: IndexedFile,
  sources: readonly TaintSource[],
  controlFlowApproximate: boolean,
): void {
  const lines = getFileLines(file)
  const sink = matchInvocationSink(node, sinks, lines)
  if (!sink) return

  const argumentNodes = node.arguments.filter((arg): arg is t.Expression | t.SpreadElement => (
    t.isExpression(arg) || t.isSpreadElement(arg)
  ))
  let alternatives: TaintAlternative[]
  if (sink.type === 'sql-injection' && argumentNodes.length > 1) {
    const queryAlternatives = expressionAlternatives(argumentNodes[0], state, sources, sanitizers, lines)
    let parameterAlternatives = combineNodes(argumentNodes.slice(1), state, sources, sanitizers, lines)
    const parameterized = sanitizers.find(item => item.name === 'parameterized query')
    if (parameterized && hasSqlPlaceholder(argumentNodes[0])) {
      parameterAlternatives = applyTransformation(parameterAlternatives, parameterized, node)
    }
    alternatives = dedupeAlternatives([...queryAlternatives, ...parameterAlternatives])
  } else {
    alternatives = combineNodes(argumentNodes, state, sources, sanitizers, lines)
  }
  if (controlFlowApproximate) alternatives = alternatives.map(markApproximate)
  if (alternatives.length > 0) flows.push(createFlow(alternatives, sink, file, node))
}

function matchInvocationSink(
  node: InvocationNode,
  sinks: readonly TaintSink[],
  lines: string[],
): TaintSink | undefined {
  const callee = nodeToSource(node.callee, lines)
  const setAttributeSink = sinks.find(sink => sink.name === 'setAttribute(on*)')
  if (setAttributeSink && /\.setAttribute$/.test(callee)) {
    const firstArgument = node.arguments[0]
    if (t.isStringLiteral(firstArgument) && /^on/i.test(firstArgument.value)) return setAttributeSink
  }
  const prefix = t.isNewExpression(node) ? 'new ' : ''
  return sinks
    .filter(sink => sink.name !== 'setAttribute(on*)')
    .find(sink => execPattern(sink.pattern, `${prefix}${callee}(`))
}

function hasSqlPlaceholder(node: t.Node): boolean {
  if (t.isStringLiteral(node)) return /\?|\$\d+/.test(node.value)
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.some(quasi => /\?|\$\d+/.test(quasi.value.cooked ?? quasi.value.raw))
  }
  return false
}

interface FlowLocation {
  loc?: t.SourceLocation | null
}

function createFlow(
  alternatives: readonly TaintAlternative[],
  sink: TaintSink,
  file: IndexedFile,
  location: FlowLocation,
): TaintFlow {
  const applicableByAlternative = alternatives.map(alternative => alternative.transformations.filter(item => (
    item.sanitizer.appliesTo.includes(sink.type)
  )))
  const sanitizersByAlternative = applicableByAlternative.map(items => items.filter(item => (
    item.sanitizer.effect === 'sanitizes'
  )))
  const sanitized = alternatives.length > 0 && sanitizersByAlternative.every(items => items.length > 0)
  const occurrences = new Map<string, TaintTransformationOccurrence>()
  for (const items of applicableByAlternative) {
    for (const item of items) occurrences.set(item.occurrence, item)
  }
  const mitigationOccurrences = [...occurrences.values()].filter(item => (
    item.sanitizer.effect === 'validates' || !sanitized
  ))
  const mitigationEvidence = mitigationOccurrences.map(item => item.sanitizer)
  const source = alternatives[0].source
  const precision = alternatives.reduce<TaintPathPrecision>(
    (current, alternative) => promotePrecision(current, alternative.precision),
    'direct',
  )
  const baseConfidence = alternatives.reduce<IssueConfidence>(
    (current, alternative) => lowerConfidence(current, alternative.source.baseConfidence),
    'high',
  )
  return {
    source,
    sink,
    sanitized,
    sanitizer: sanitized ? sanitizersByAlternative[0][0]?.sanitizer : undefined,
    confidence: flowConfidence(baseConfidence, precision, mitigationEvidence.length),
    precision,
    mitigationEvidence,
    path: [...alternatives[0].chain, sink.name],
    file: file.path,
    startLine: location.loc?.start.line ?? 0,
    endLine: location.loc?.end.line ?? 0,
  }
}

function lowerConfidence(left: IssueConfidence, right: IssueConfidence): IssueConfidence {
  const order: Record<IssueConfidence, number> = { high: 2, medium: 1, low: 0 }
  return order[left] <= order[right] ? left : right
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
  let alternatives = expressionAlternatives(node.right, state, sources, sanitizers, lines)
  if (controlFlowApproximate) alternatives = alternatives.map(markApproximate)
  if (alternatives.length > 0) flows.push(createFlow(alternatives, sink, file, node))
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
