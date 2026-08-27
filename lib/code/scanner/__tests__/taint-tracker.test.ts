// Taint Tracker — unit tests
//
// Verifies intraprocedural taint tracking: source→sink detection,
// sanitizer suppression, variable reassignment, and scope isolation.

import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import type { ParseResult } from '@babel/parser'
import type { File } from '@babel/types'
import type { IndexedFile } from '../../code-index'
import { trackTaint, taintFlowsToIssues, DEFAULT_SOURCES, DEFAULT_SINKS, DEFAULT_SANITIZERS } from '../taint-tracker'
import type { TaintFlow } from '../taint-tracker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(code: string, path = 'test.ts'): IndexedFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    content: code,
    language: 'typescript',
    lineCount: code.split('\n').length,
  }
}

function parseCode(code: string): ParseResult<File> {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  })
}

function getFlows(code: string): TaintFlow[] {
  const file = makeFile(code)
  const ast = parseCode(code)
  return trackTaint(ast, file)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trackTaint', () => {
  it('propagates traversal failures so the scanner can report partial coverage', () => {
    const code = 'const value = 1'
    const file = makeFile(code)
    const ast = parseCode(code)
    Object.defineProperty(ast.program, 'body', {
      configurable: true,
      get: () => { throw new Error('synthetic traversal failure') },
    })

    expect(() => trackTaint(ast, file)).toThrow('synthetic traversal failure')
  })

  it('detects req.query.id flowing directly to db.query() without sanitization', () => {
    const code = `
function handler(req, res) {
  const id = req.query.id;
  db.query("SELECT * FROM users WHERE id = " + id);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('sql-injection')
    expect(unsanitized[0].source.name).toBe('req.query')
  })

  it('does NOT flag when parseInt() sanitizes user input before db.query()', () => {
    const code = `
function handler(req, res) {
  const id = req.query.id;
  const safeId = parseInt(id, 10);
  db.query("SELECT * FROM users WHERE id = " + safeId);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBe(0)
  })

  it('detects req.body.html flowing to innerHTML without DOMPurify', () => {
    const code = `
function render(req) {
  const html = req.body.html;
  document.getElementById('out').innerHTML = html;
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('xss')
  })

  it('handles variable reassignment: x = req.query.id → y = x → db.query(y)', () => {
    const code = `
function handler(req, res) {
  const x = req.query.id;
  const y = x;
  db.query(y);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].path).toContain('y')
    expect(unsanitized[0].source.name).toBe('req.query')
  })

  it('returns empty array for files with no taint sources', () => {
    const code = `
function add(a, b) {
  return a + b;
}
`
    const flows = getFlows(code)
    expect(flows).toEqual([])
  })

  it('intraprocedural scope: taint does not leak between function bodies', () => {
    const code = `
function handler1(req) {
  const id = req.query.id;
}

function handler2() {
  db.query(id);
}
`
    const flows = getFlows(code)
    // handler2 should NOT detect taint since `id` is in handler1's scope
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBe(0)
  })

  it('detects taint through template literals', () => {
    const code = `
function handler(req, res) {
  const name = req.body.name;
  const query = \`SELECT * FROM users WHERE name = '\${name}'\`;
  db.query(query);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('sql-injection')
  })

  it('detects taint through string concatenation', () => {
    const code = `
function handler(req, res) {
  const cmd = "ls " + req.query.dir;
  exec(cmd);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('command-injection')
  })

  // -------------------------------------------------------------------------
  // Expression handler tests (ConditionalExpression, LogicalExpression, Await)
  // -------------------------------------------------------------------------

  it('detects taint through ConditionalExpression (consequent branch)', () => {
    const code = `
function handler(req, res) {
  const input = req.query.search;
  const value = true ? input : "safe";
  db.query("SELECT * FROM items WHERE name = " + value);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('sql-injection')
    expect(unsanitized[0].source.name).toBe('req.query')
  })

  it('detects taint through ConditionalExpression (alternate branch)', () => {
    const code = `
function handler(req, res) {
  const input = req.query.search;
  const value = false ? "safe" : input;
  db.query("SELECT * FROM items WHERE name = " + value);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('sql-injection')
  })

  it('detects taint through LogicalExpression (left side)', () => {
    const code = `
function handler(req, res) {
  const input = req.query.id;
  const value = input || "default";
  db.query("SELECT * FROM users WHERE id = " + value);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].sink.type).toBe('sql-injection')
    expect(unsanitized[0].source.name).toBe('req.query')
  })

  it('detects taint through LogicalExpression (right side)', () => {
    const code = `
function handler(req, res) {
  const input = req.body.name;
  const value = null && input;
  eval(value);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].source.name).toBe('req.body')
  })

  it('detects taint through AwaitExpression', () => {
    const code = `
async function handler(req, res) {
  const input = req.query.url;
  const data = await fetchData(input);
  eval(data);
}
`
    const flows = getFlows(code)
    const unsanitized = flows.filter(f => !f.sanitized)
    expect(unsanitized.length).toBeGreaterThanOrEqual(1)
    expect(unsanitized[0].source.name).toBe('req.query')
  })

  it('does NOT propagate taint through ConditionalExpression when both branches are safe', () => {
    const code = `
function handler(req, res) {
  const input = req.query.id;
  const value = true ? "safe1" : "safe2";
  db.query("SELECT * FROM users WHERE id = " + value);
}
`
    const flows = getFlows(code)
    // input is tainted but value is not derived from it
    const sqlFlows = flows.filter(f => !f.sanitized && f.sink.type === 'sql-injection')
    expect(sqlFlows.length).toBe(0)
  })
})

describe('trackTaint — sink call text must not be read as its own sanitizer', () => {
  // Regression: `db.query(` contains `query(`, which the express-validator
  // sanitizer matches. Every inline SQL-injection flow was stamped sanitized
  // and dropped, while the identical code via a local variable was reported.

  it('detects req.body inlined directly into db.query() with no intermediate variable', () => {
    const code = `
function handler(req, res) {
  db.query("SELECT * FROM users WHERE id = " + req.body.id);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(false)
    expect(sqlFlows[0].source.name).toBe('req.body')
    const sqlIssues = taintFlowsToIssues(flows).filter(i => i.ruleId === 'taint-sql-injection')
    expect(sqlIssues).toHaveLength(1)
    expect(sqlIssues[0].severity).toBe('critical')
    expect(sqlIssues[0].cwe).toBe('CWE-89')
  })

  it('detects req.params inlined directly into pool.query()', () => {
    const code = `
function handler(req, res) {
  pool.query("SELECT * FROM items WHERE id = " + req.params.x);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(false)
    expect(sqlFlows[0].source.name).toBe('req.params')
  })

  it('detects req.query inlined directly into knex.raw()', () => {
    const code = `
function handler(req, res) {
  knex.raw("SELECT " + req.query.q);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(false)
    expect(sqlFlows[0].source.name).toBe('req.query')
  })

  it('still detects an inlined source in client.execute()', () => {
    const code = `
function handler(req, res) {
  client.execute("SELECT " + req.params.x);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(false)
  })

  // --- Negative regressions: genuinely safe parameterized SQL stays green ---
  // These pin the trap. The first one PASSES today only because the
  // express-validator bug suppresses it; the `sanitizer?.name` assertion is
  // what makes it fail today and fail again if the overlap fix lands without
  // the widened parameterized pattern.

  it('treats a `?` placeholder query as sanitized BY the parameterized-query sanitizer', () => {
    const code = `
function handler(req, res) {
  db.query("SELECT * FROM users WHERE id = ?", [req.body.id]);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(true)
    expect(sqlFlows[0].sanitizer?.name).toBe('parameterized query')
    expect(taintFlowsToIssues(flows)).toHaveLength(0)
  })

  it('treats a single-quoted `?` placeholder query as sanitized by the parameterized-query sanitizer', () => {
    const code = `
function handler(req, res) {
  db.query('SELECT * FROM u WHERE id = ?', [req.params.id]);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(true)
    expect(sqlFlows[0].sanitizer?.name).toBe('parameterized query')
    expect(taintFlowsToIssues(flows)).toHaveLength(0)
  })

  it('treats a multi-`?` placeholder query as sanitized by the parameterized-query sanitizer', () => {
    const code = `
function handler(req, res) {
  connection.query("INSERT INTO t (a,b) VALUES (?, ?)", [req.body.a, req.body.b]);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(true)
    expect(sqlFlows[0].sanitizer?.name).toBe('parameterized query')
    expect(taintFlowsToIssues(flows)).toHaveLength(0)
  })

  it('treats a `$1` placeholder query as sanitized by the parameterized-query sanitizer', () => {
    const code = `
function handler(req, res) {
  pool.query("SELECT * FROM u WHERE id = $1", [req.body.id]);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(true)
    expect(sqlFlows[0].sanitizer?.name).toBe('parameterized query')
    expect(taintFlowsToIssues(flows)).toHaveLength(0)
  })

  it('does not mistake a ternary `?` for a query placeholder', () => {
    const code = `
function handler(req, res) {
  db.query(cond ? "a" : "b", [req.body.id]);
}
`
    const flows = getFlows(code)
    const sqlFlows = flows.filter(f => f.sink.type === 'sql-injection')
    expect(sqlFlows).toHaveLength(1)
    expect(sqlFlows[0].sanitized).toBe(false)
  })
})

describe('taintFlowsToIssues', () => {
  it('produces correct CodeIssue shape from unsanitized flows', () => {
    const flow: TaintFlow = {
      source: DEFAULT_SOURCES[1], // req.query
      sink: DEFAULT_SINKS[2],     // db.query() (sql-injection)
      sanitized: false,
      confidence: 'high',
      precision: 'linear',
      mitigationEvidence: [],
      path: ['req.query', 'id', 'db.query()'],
      file: 'src/handler.ts',
      startLine: 5,
      endLine: 5,
    }

    const issues = taintFlowsToIssues([flow])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'taint-sql-injection',
      category: 'security',
      severity: 'critical',
      confidence: 'high',
      cwe: 'CWE-89',
      file: 'src/handler.ts',
      line: 5,
    })
    expect(issues[0].description).toContain('req.query')
    expect(issues[0].suggestion).toBeTruthy()
  })

  it('skips sanitized flows', () => {
    const flow: TaintFlow = {
      source: DEFAULT_SOURCES[0], // req.body
      sink: DEFAULT_SINKS[0],     // eval()
      sanitized: true,
      sanitizer: DEFAULT_SANITIZERS[3], // parseInt
      confidence: 'high',
      precision: 'direct',
      mitigationEvidence: [],
      path: ['req.body', 'eval()'],
      file: 'src/handler.ts',
      startLine: 3,
      endLine: 3,
    }

    const issues = taintFlowsToIssues([flow])
    expect(issues).toHaveLength(0)
  })

  it('assigns correct severity per sink type', () => {
    const xssFlow: TaintFlow = {
      source: DEFAULT_SOURCES[0],
      sink: DEFAULT_SINKS[3], // innerHTML (xss)
      sanitized: false,
      confidence: 'high',
      precision: 'direct',
      mitigationEvidence: [],
      path: ['req.body', 'innerHTML'],
      file: 'test.ts',
      startLine: 1,
      endLine: 1,
    }
    const sqlFlow: TaintFlow = {
      source: DEFAULT_SOURCES[0],
      sink: DEFAULT_SINKS[2], // db.query()
      sanitized: false,
      confidence: 'high',
      precision: 'direct',
      mitigationEvidence: [],
      path: ['req.body', 'db.query()'],
      file: 'test.ts',
      startLine: 2,
      endLine: 2,
    }

    const issues = taintFlowsToIssues([xssFlow, sqlFlow])
    expect(issues[0].severity).toBe('warning') // XSS
    expect(issues[1].severity).toBe('critical') // SQL injection
  })
})

describe('trackTaint — trustworthy sanitizer and confidence semantics', () => {
  const compatibilityCases = [
    {
      name: 'DOMPurify does not suppress code injection',
      code: `function handler(req) {
  const safe = DOMPurify.sanitize(req.body.code);
  eval(safe);
}`,
      sinkType: 'code-injection',
      sanitized: false,
    },
    {
      name: 'SQL escaping does not suppress XSS',
      code: `function handler(req) {
  const escaped = sqlstring.escape(req.body.html);
  element.innerHTML = escaped;
}`,
      sinkType: 'xss',
      sanitized: false,
    },
    {
      name: 'path.basename only suppresses path traversal',
      code: `function handler(req) {
  const base = path.basename(req.body.code);
  eval(base);
}`,
      sinkType: 'code-injection',
      sanitized: false,
    },
    {
      name: 'numeric casts suppress SQL injection',
      code: `function handler(req) {
  const id = Number(req.body.id);
  db.query("SELECT * FROM users WHERE id = " + id);
}`,
      sinkType: 'sql-injection',
      sanitized: true,
    },
    {
      name: 'numeric casts suppress NoSQL injection',
      code: `function handler(req) {
  const id = parseInt(req.body.id, 10);
  User.find(id);
}`,
      sinkType: 'nosql-injection',
      sanitized: true,
    },
  ] as const

  it.each(compatibilityCases)('$name', ({ code, sinkType, sanitized }) => {
    const flow = getFlows(code).find(candidate => candidate.sink.type === sinkType)
    expect(flow).toBeDefined()
    expect(flow!.sanitized).toBe(sanitized)
    expect(taintFlowsToIssues([flow!])).toHaveLength(sanitized ? 0 : 1)
  })

  it('retains validation as evidence without deleting taint', () => {
    const code = `
function handler(req) {
  let input = req.body.sql;
  input = schema.parse(input);
  db.query(input);
}
`
    const flow = getFlows(code).find(candidate => candidate.sink.type === 'sql-injection')
    expect(flow).toBeDefined()
    expect(flow).toMatchObject({
      sanitized: false,
      precision: 'linear',
      confidence: 'medium',
    })
    expect(flow!.mitigationEvidence.map(evidence => evidence.name)).toEqual(['zod.parse'])
    expect(taintFlowsToIssues([flow!])).toHaveLength(1)
  })

  it('lowers confidence once for each evidence-only transformation', () => {
    const code = `
function handler(req) {
  const parsed = schema.parse(req.body.sql);
  const normalized = path.normalize(parsed);
  fs.readFile(normalized);
}
`
    const flow = getFlows(code).find(candidate => candidate.sink.type === 'path-traversal')
    expect(flow).toMatchObject({ sanitized: false, confidence: 'low' })
    expect(flow!.mitigationEvidence.map(evidence => evidence.name)).toEqual([
      'zod.parse',
      'path.normalize()',
    ])
  })
})

describe('trackTaint — source origin and precision semantics', () => {
  it.each([
    {
      name: 'explicit request catalog source',
      code: 'function handler(req) { eval(req.body.code); }',
      sourceName: 'req.body',
      origin: 'catalog-user-input',
      confidence: 'high',
    },
    {
      name: 'explicit browser catalog source',
      code: 'function handler() { eval(location.hash); }',
      sourceName: 'location.hash',
      origin: 'catalog-browser-input',
      confidence: 'high',
    },
    {
      name: 'synthetic request parameter source',
      code: 'function handler(request) { eval(request.payload); }',
      sourceName: 'request',
      origin: 'synthetic-handler-param',
      confidence: 'medium',
    },
  ] as const)('$name', ({ code, sourceName, origin, confidence }) => {
    const flow = getFlows(code).find(candidate => candidate.sink.type === 'code-injection')
    expect(flow).toBeDefined()
    expect(flow!.source).toMatchObject({ name: sourceName, origin, baseConfidence: confidence })
    expect(flow).toMatchObject({ precision: 'direct', confidence })
  })

  it('does not classify process.env as user-controlled taint', () => {
    expect(getFlows('function load() { eval(process.env.SCRIPT); }')).toHaveLength(0)
  })

  it.each(['ctx', 'context'])('does not auto-taint bare %s handler parameters', parameter => {
    expect(getFlows(`function handler(${parameter}) { eval(${parameter}.payload); }`)).toHaveLength(0)
  })

  it.each(['body', 'query', 'params', 'headers'])('recognizes explicit Koa ctx.request.%s input', member => {
    const flow = getFlows(`function handler(ctx) { eval(ctx.request.${member}.code); }`)[0]
    expect(flow?.source).toMatchObject({
      name: `ctx.request.${member}`,
      origin: 'catalog-user-input',
      baseConfidence: 'high',
    })
    expect(flow).toMatchObject({ precision: 'direct', confidence: 'high' })
  })

  it('marks linear propagation high confidence for explicit catalog sources', () => {
    const flow = getFlows(`function handler(req) {
  const input = req.query.code;
  const copy = input;
  eval(copy);
}`)[0]
    expect(flow).toMatchObject({ precision: 'linear', confidence: 'high' })
  })

  it.each([
    {
      name: 'conditional expression',
      code: `function handler(req) {
  const input = req.query.code;
  const selected = flag ? input : "safe";
  eval(selected);
}`,
    },
    {
      name: 'branch assignment',
      code: `function handler(req) {
  let selected = "safe";
  if (flag) selected = req.query.code;
  eval(selected);
}`,
    },
    {
      name: 'safe alternate branch',
      code: `function handler(req) {
  let selected = "safe";
  if (flag) selected = req.query.code;
  else selected = "safe";
  eval(selected);
}`,
    },
  ])('caps $name flows at medium confidence', ({ code }) => {
    const flow = getFlows(code)[0]
    expect(flow).toMatchObject({ precision: 'control-flow-approximate', confidence: 'medium' })
  })
})

describe('trackTaint — sink metadata and nested scope isolation', () => {
  it('uses the severity declared by the matched sink', () => {
    const flow = getFlows(`function handler(req) {
  const html = req.body.html;
  element.insertAdjacentHTML('beforeend', html);
}`).find(candidate => candidate.sink.name === 'insertAdjacentHTML()')
    expect(flow?.sink.severity).toBe('critical')
    expect(taintFlowsToIssues([flow!])[0].severity).toBe('critical')
  })

  it('analyzes every nested function with fresh state and does not leak outer taint', () => {
    const flows = getFlows(`function outer(req) {
  const outerInput = req.body.code;
  function syntheticInner(request) {
    eval(request.payload);
  }
  function isolatedInner() {
    eval(outerInput);
  }
}`)
    const codeFlows = flows.filter(flow => flow.sink.type === 'code-injection')
    expect(codeFlows).toHaveLength(1)
    expect(codeFlows[0].source).toMatchObject({
      name: 'request',
      origin: 'synthetic-handler-param',
    })
  })
})

describe('trackTaint — path-compatible alternatives', () => {
  it('reports when sanitized and raw operands are combined', () => {
    const flow = getFlows(`function handler(req) {
  const clean = DOMPurify.sanitize(req.body.clean);
  const mixed = clean + req.body.raw;
  element.innerHTML = mixed;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: false, confidence: 'high' })
    expect(flow!.mitigationEvidence).toEqual([])
  })

  it('reports when only one conditional branch is sanitized', () => {
    const flow = getFlows(`function handler(req) {
  const value = flag ? DOMPurify.sanitize(req.body.html) : req.body.html;
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({
      sanitized: false,
      precision: 'control-flow-approximate',
      confidence: 'medium',
    })
  })

  it('does not let placeholders suppress raw SQL concatenation in another argument', () => {
    const flow = getFlows(`function handler(req) {
  db.query("SELECT * FROM users WHERE name = '" + req.body.name + "' AND id = ?", [req.body.id]);
}`).find(candidate => candidate.sink.type === 'sql-injection')
    expect(flow).toMatchObject({ sanitized: false })
    expect(taintFlowsToIssues([flow!])).toHaveLength(1)
  })

  it('suppresses only when every combined alternative is XSS-sanitized', () => {
    const flow = getFlows(`function handler(req) {
  const safe = DOMPurify.sanitize(req.body.a) + he.encode(req.body.b);
  element.innerHTML = safe;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: true })
    expect(taintFlowsToIssues([flow!])).toHaveLength(0)
  })

  it('allows straight-line sanitization to replace the prior raw path', () => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.html;
  value = DOMPurify.sanitize(value);
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: true })
  })

  it('does not globally sanitize a value on only one assignment branch', () => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.html;
  if (flag) value = DOMPurify.sanitize(value);
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({
      sanitized: false,
      precision: 'control-flow-approximate',
      confidence: 'medium',
    })
  })
})

describe('trackTaint — specific sanitizer matching', () => {
  it.each([
    {
      name: 'sqlstring.escape suppresses SQL',
      code: `function handler(req) {
  const safe = sqlstring.escape(req.body.value);
  db.query("SELECT * FROM t WHERE value = " + safe);
}`,
      sinkType: 'sql-injection',
      sanitizer: 'sqlstring.escape',
    },
    {
      name: 'he.escape suppresses XSS',
      code: `function handler(req) {
  const safe = he.escape(req.body.value);
  element.innerHTML = safe;
}`,
      sinkType: 'xss',
      sanitizer: 'he.encode',
    },
  ])('$name', ({ code, sinkType, sanitizer }) => {
    const flow = getFlows(code).find(candidate => candidate.sink.type === sinkType)
    expect(flow).toMatchObject({ sanitized: true })
    expect(flow!.sanitizer?.name).toBe(sanitizer)
  })

  it('keeps he.escape sink-specific when used before eval', () => {
    const flow = getFlows(`function handler(req) {
  const encoded = he.escape(req.body.code);
  eval(encoded);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'high' })
  })

  it('treats generic escape as validation evidence only', () => {
    const flow = getFlows(`function handler(req) {
  const escaped = escape(req.body.code);
  eval(escaped);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'medium' })
    expect(flow.mitigationEvidence.map(item => item.name)).toEqual(['escape'])
  })
})

describe('trackTaint — destructuring and container propagation', () => {
  it('derives explicit Koa sources from ctx.request object destructuring', () => {
    const flows = getFlows(`function handler(ctx) {
  const { body, query, params, headers } = ctx.request;
  eval(body.code);
  eval(query.code);
  eval(params.code);
  eval(headers.code);
}`)
    expect(flows.map(flow => flow.source.name)).toEqual([
      'ctx.request.body',
      'ctx.request.query',
      'ctx.request.params',
      'ctx.request.headers',
    ])
    expect(flows.every(flow => flow.source.baseConfidence === 'high')).toBe(true)
  })

  it('recursively binds object defaults and rest from explicit Koa input', () => {
    const flows = getFlows(`function handler(ctx) {
  const { nested: { value = "safe" }, ...rest } = ctx.request.body;
  eval(value);
  eval(rest.other);
}`)
    expect(flows).toHaveLength(2)
    for (const flow of flows) {
      expect(flow.source).toMatchObject({
        name: 'ctx.request.body',
        origin: 'catalog-user-input',
        baseConfidence: 'high',
      })
    }
  })

  it('recursively binds array defaults and rest', () => {
    const flows = getFlows(`function handler(req) {
  const [first = "safe", ...rest] = req.body.items;
  eval(first);
  eval(rest[0]);
}`)
    expect(flows).toHaveLength(2)
    expect(flows.every(flow => flow.source.name === 'req.body')).toBe(true)
  })

  it('propagates a tainted destructuring default initializer', () => {
    const flow = getFlows(`function handler(req) {
  const safe = {};
  const { value = req.body.fallback } = safe;
  eval(value);
}`)[0]
    expect(flow.source).toMatchObject({ name: 'req.body', baseConfidence: 'high' })
  })

  it('recognizes computed request body access as an explicit high-confidence source', () => {
    const flow = getFlows(`function handler(req) { eval(req['body'].code); }`)[0]
    expect(flow.source).toMatchObject({
      name: 'req.body',
      origin: 'catalog-user-input',
      baseConfidence: 'high',
    })
    expect(flow.confidence).toBe('high')
  })

  it('does not match a request source name in the middle of another member path', () => {
    expect(getFlows(`function handler() {
  const shadow = { req: { body: { code: "safe" } } };
  eval(shadow.req.body.code);
}`)).toHaveLength(0)
  })

  it.each([
    {
      name: 'object member',
      code: `function handler(req) {
  const container = { value: req.body.code };
  eval(container.value);
}`,
    },
    {
      name: 'array member',
      code: `function handler(req) {
  const container = [req.body.code];
  eval(container[0]);
}`,
    },
  ])('propagates through a $name read', ({ code }) => {
    const flow = getFlows(code)[0]
    expect(flow.source.name).toBe('req.body')
    expect(flow.precision).toBe('linear')
  })
})

describe('trackTaint — complete function scope coverage', () => {
  it('analyzes async generator object methods with fresh synthetic state', () => {
    const flow = getFlows(`const handlers = {
  async *run(request) {
    eval(request.payload);
  }
};`)[0]
    expect(flow.source).toMatchObject({
      name: 'request',
      origin: 'synthetic-handler-param',
    })
  })

  it('analyzes private class methods with fresh synthetic state', () => {
    const flow = getFlows(`class Handler {
  async #run(request) {
    eval(request.payload);
  }
}`)[0]
    expect(flow.source).toMatchObject({
      name: 'request',
      origin: 'synthetic-handler-param',
    })
  })
})

describe('trackTaint — structural sink recognition', () => {
  it('reports a nested eval exactly once', () => {
    const flows = getFlows(`function handler(req) {
  wrapper(eval(req.body.code));
}`).filter(flow => flow.sink.name === 'eval()')
    expect(flows).toHaveLength(1)
  })

  it.each([
    'function log(req) { logger.info("eval(req.body.code)"); }',
    'function log(req) { console.log("db.query(req.body.value)"); }',
  ])('does not recognize sink text inside a string literal', code => {
    expect(getFlows(code)).toHaveLength(0)
  })

  it('does not classify Array.find as a NoSQL sink', () => {
    expect(getFlows(`function handler(req) {
  const values = [1, 2, 3];
  values.find(req.body.value);
}`)).toHaveLength(0)
  })

  it('retains Mongoose model find recognition', () => {
    const flow = getFlows('function handler(req) { User.find(req.body.filter); }')[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })

  it('recognizes a NewExpression sink from its actual callee', () => {
    const flows = getFlows('function handler(req) { new Function(req.body.code); }')
    expect(flows.filter(flow => flow.sink.name === 'Function()')).toHaveLength(1)
  })
})

describe('trackTaint — sanitizer aliases and evidence occurrences', () => {
  it('tracks a simple immutable sanitizer alias', () => {
    const flow = getFlows(`function handler(req) {
  const clean = DOMPurify.sanitize;
  const safe = clean(req.body.html);
  element.innerHTML = safe;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: true })
    expect(flow!.sanitizer?.name).toBe('DOMPurify.sanitize()')
  })

  it('counts sequential validation occurrences separately', () => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.code;
  value = schema.parse(value);
  value = schema.parse(value);
  eval(value);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'low' })
    expect(flow.mitigationEvidence.map(item => item.name)).toEqual(['zod.parse', 'zod.parse'])
  })

  it('deduplicates one validation occurrence copied into multiple operands', () => {
    const flow = getFlows(`function handler(req) {
  const value = schema.parse(req.body.code);
  const left = value;
  const right = value;
  eval(left + right);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'medium' })
    expect(flow.mitigationEvidence.map(item => item.name)).toEqual(['zod.parse'])
  })

  it('counts nested validation occurrences deterministically', () => {
    const flow = getFlows(`function handler(req) {
  const value = schema.parse(schema.parse(req.body.code));
  eval(value);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'low' })
    expect(flow.mitigationEvidence.map(item => item.name)).toEqual(['zod.parse', 'zod.parse'])
  })
})

describe('trackTaint — value-location identity', () => {
  it('keeps sibling object properties independent', () => {
    const flows = getFlows(`function handler(req) {
  const values = { safe: "literal", raw: req.body.code };
  eval(values.safe);
  eval(values.raw);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('values.raw')
  })

  it('keeps array slots independent', () => {
    const flows = getFlows(`function handler(req) {
  const values = ["literal", req.body.code];
  eval(values[0]);
  eval(values[1]);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('values.1')
  })

  it('selects only the matching property during destructuring', () => {
    const flows = getFlows(`function handler(req) {
  const values = { safe: "literal", raw: req.body.code };
  const { safe, raw } = values;
  eval(safe);
  eval(raw);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('raw')
  })

  it('preserves nested, shorthand, and spread member identity', () => {
    const flows = getFlows(`function handler(req) {
  const raw = req.body.code;
  const source = { nested: { safe: "literal", raw } };
  const copy = { ...source };
  eval(copy.nested.safe);
  eval(copy.nested.raw);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('copy.nested.raw')
  })

  it('conservatively merges a dynamic computed member read', () => {
    const flows = getFlows(`function handler(req) {
  const values = { safe: "literal", raw: req.body.code };
  eval(values[key]);
}`)
    expect(flows).toHaveLength(1)
  })

  it('conservatively merges a dynamic computed member write', () => {
    const flows = getFlows(`function handler(req) {
  const values = { safe: "literal" };
  values[key] = req.body.code;
  eval(values.safe);
}`)
    expect(flows).toHaveLength(1)
  })

  it('preserves exact remainder fields through object rest destructuring', () => {
    const flows = getFlows(`function handler(req) {
  const values = { safe: "literal", raw: req.body.code };
  const { safe, ...rest } = values;
  eval(rest.safe);
  eval(rest.raw);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('rest.raw')
  })

  it('remaps exact array slots through rest destructuring', () => {
    const flows = getFlows(`function handler(req) {
  const values = ["head", "safe", req.body.code];
  const [head, ...rest] = values;
  eval(head);
  eval(rest[0]);
  eval(rest[1]);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('rest.1')
  })

  it.each([
    'values = { safe: "literal", raw: req.body.code }; eval(values.safe); eval(values.raw);',
    'values = ["literal", req.body.code]; eval(values[0]); eval(values[1]);',
  ])('keeps locations independent when assigning a container: %s', assignment => {
    const flows = getFlows(`function handler(req) {
  let values;
  ${assignment}
}`)
    expect(flows).toHaveLength(1)
  })

  it('preserves field-specific transformations', () => {
    const flows = getFlows(`function handler(req) {
  const values = {
    safe: DOMPurify.sanitize(req.body.safe),
    raw: req.body.raw,
  };
  element.innerHTML = values.safe;
  element.innerHTML = values.raw;
}`).filter(flow => flow.sink.type === 'xss')
    expect(flows).toHaveLength(2)
    expect(flows.map(flow => flow.sanitized)).toEqual([true, false])
  })
})

describe('trackTaint — alternative-specific flow attribution', () => {
  it('attributes a mixed sanitized and raw browser flow only to the raw alternative', () => {
    const flow = getFlows(`function render(req) {
  element.innerHTML = DOMPurify.sanitize(req.body.html) + location.hash;
}`)[0]
    expect(flow).toMatchObject({
      sanitized: false,
      confidence: 'high',
      mitigationEvidence: [],
    })
    expect(flow.source.name).toBe('location.hash')
    expect(flow.path).toContain('location.hash')
  })

  it('does not attribute another alternative schema evidence to the raw path', () => {
    const flow = getFlows(`function handler(req) {
  const mixed = schema.parse(schema.parse(req.body.checked)) + req.body.raw;
  eval(mixed);
}`)[0]
    expect(flow).toMatchObject({ sanitized: false, confidence: 'high', mitigationEvidence: [] })
  })

  it('selects the same raw conditional alternative regardless of branch ordering', () => {
    const leftRaw = getFlows(`function render(req) {
  element.innerHTML = flag ? req.body.raw : DOMPurify.sanitize(req.body.safe);
}`)[0]
    const rightRaw = getFlows(`function render(req) {
  element.innerHTML = flag ? DOMPurify.sanitize(req.body.safe) : req.body.raw;
}`)[0]
    for (const flow of [leftRaw, rightRaw]) {
      expect(flow).toMatchObject({
        sanitized: false,
        precision: 'control-flow-approximate',
        confidence: 'medium',
        mitigationEvidence: [],
      })
      expect(flow.source.name).toBe('req.body')
    }
  })
})

describe('trackTaint — assignment and transparent-call propagation', () => {
  it.each(['+=', '||=', '&&=', '??='])('preserves lhs taint for %s assignment', operator => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.raw;
  value ${operator} DOMPurify.sanitize(location.hash);
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: false, mitigationEvidence: [] })
    expect(flow!.source.name).toBe('req.body')
  })

  it('propagates receiver taint through transparent member calls', () => {
    const flow = getFlows(`function handler(req) {
  eval(req.body.code.trim().slice(0).toString());
}`)[0]
    expect(flow.source).toMatchObject({ name: 'req.body', baseConfidence: 'high' })
  })

  it('resolves immutable Koa request-prefix alias chains', () => {
    const flow = getFlows(`function handler(ctx) {
  const request = ctx.request;
  const alias = request;
  eval(alias.body.code);
}`)[0]
    expect(flow.source).toMatchObject({
      name: 'ctx.request.body',
      origin: 'catalog-user-input',
      baseConfidence: 'high',
    })
  })

  it('retains explicit and synthetic semantics through request aliases', () => {
    const flows = getFlows(`function handler(req) {
  const first = req;
  const second = first;
  eval(second.body.code);
  eval(second.other);
}`)
    expect(flows.map(flow => [flow.source.name, flow.confidence])).toEqual([
      ['req.body', 'high'],
      ['req', 'medium'],
    ])
  })

  it('does not taint a Koa request container before selecting a source member', () => {
    expect(getFlows(`function handler(ctx) {
  const request = ctx.request;
  eval(request);
}`)).toHaveLength(0)
  })
})

describe('trackTaint — static SQL query aliases', () => {
  it.each([
    'const query = "SELECT * FROM users WHERE id = ?";',
    'const base = `SELECT * FROM users WHERE id = ?`; const query = base;',
  ])('recognizes an immutable placeholder query alias: %s', declaration => {
    const flow = getFlows(`function handler(req) {
  ${declaration}
  db.query(query, req.body.id);
}`).find(candidate => candidate.sink.type === 'sql-injection')
    expect(flow).toMatchObject({ sanitized: true })
  })

  it('does not treat a raw concatenated query alias as parameterized', () => {
    const flow = getFlows(`function handler(req) {
  const query = "SELECT * FROM users WHERE name = '" + req.body.name + "' AND id = ?";
  db.query(query, req.body.id);
}`).find(candidate => candidate.sink.type === 'sql-injection')
    expect(flow).toMatchObject({ sanitized: false })
  })
})

describe('trackTaint — NoSQL receiver evidence', () => {
  it.each([
    'const User = [];',
    'const User = {};',
    'const User = "plain";',
    'const UserModel = []; const User = UserModel;',
    'const collection = {}; const User = collection;',
  ])('rejects a capitalized local non-model receiver: %s', declaration => {
    expect(getFlows(`function handler(req) {
  ${declaration}
  User.find(req.body.filter);
}`)).toHaveLength(0)
  })

  it.each(['UserModel', 'collection'])('rejects a model-like local %s binding without model evidence', receiver => {
    expect(getFlows(`function handler(req) {
  const ${receiver} = [];
  ${receiver}.find(req.body.filter);
}`)).toHaveLength(0)
  })

  it('accepts an imported model receiver', () => {
    const flow = getFlows(`import User from './user-model';
function handler(req) { User.find(req.body.filter); }`)[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })

  it.each([
    "const User = mongoose.model('User');",
    "const User = db.collection('users');",
  ])('accepts a receiver initialized from model evidence: %s', declaration => {
    const flow = getFlows(`function handler(req) {
  ${declaration}
  User.find(req.body.filter);
}`)[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })
})

describe('trackTaint — exhaustive branch merging', () => {
  it('suppresses when both explicit branches compatibly sanitize', () => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.html;
  if (flag) value = DOMPurify.sanitize(value);
  else value = he.encode(value);
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({
      sanitized: true,
      precision: 'control-flow-approximate',
    })
  })

  it('retains the baseline when an else branch is absent', () => {
    const flow = getFlows(`function handler(req) {
  let value = req.body.html;
  if (flag) value = DOMPurify.sanitize(value);
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: false, precision: 'control-flow-approximate' })
  })
})

describe('trackTaint — recursive immutable sanitizer aliases', () => {
  it('resolves a multi-hop immutable sanitizer alias', () => {
    const flow = getFlows(`function handler(req) {
  const clean = DOMPurify.sanitize;
  const alsoClean = clean;
  const safe = alsoClean(req.body.html);
  element.innerHTML = safe;
}`)[0]
    expect(flow).toMatchObject({ sanitized: true })
  })

  it('does not trust a reassigned sanitizer alias', () => {
    const flow = getFlows(`function handler(req) {
  let clean = DOMPurify.sanitize;
  clean = passthrough;
  const value = clean(req.body.html);
  element.innerHTML = value;
}`)[0]
    expect(flow).toMatchObject({ sanitized: false })
  })
})

describe('trackTaint — branch-local statement analysis', () => {
  it('uses each explicit branch state for sinks inside that branch', () => {
    const flows = getFlows(`function render(req) {
  let value = req.body.html;
  if (flag) {
    value = DOMPurify.sanitize(value);
    element.innerHTML = value;
  } else {
    value = he.encode(value);
    element.innerHTML = value;
  }
}`).filter(flow => flow.sink.type === 'xss')
    expect(flows).toHaveLength(2)
    expect(flows.every(flow => flow.sanitized)).toBe(true)
  })

  it('does not leak a raw baseline into a sink after a definite safe assignment', () => {
    const flows = getFlows(`function handler(req) {
  let value = req.body.code;
  if (flag) {
    value = "literal";
    eval(value);
  } else {
    eval(value);
  }
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].precision).toBe('control-flow-approximate')
  })

  it.each([
    `if (outer) {
      if (inner) value = DOMPurify.sanitize(value);
      else value = he.encode(value);
    } else value = req.body.raw;`,
    `if (outer) value = req.body.raw;
    else if (inner) value = DOMPurify.sanitize(value);
    else value = he.encode(value);`,
  ])('retains the downstream raw nested path regardless of textual branch order', branches => {
    const flow = getFlows(`function render(req) {
  let value = req.body.html;
  ${branches}
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: false, precision: 'control-flow-approximate' })
  })

  it('joins recursively sanitized nested branches without the entry baseline', () => {
    const flow = getFlows(`function render(req) {
  let value = req.body.html;
  if (outer) {
    if (inner) value = DOMPurify.sanitize(value);
    else value = he.encode(value);
  } else {
    value = xss(value);
  }
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({ sanitized: true, precision: 'control-flow-approximate' })
  })
})

describe('trackTaint — ordered array spread locations', () => {
  it('offsets a known spread after a head element', () => {
    const flows = getFlows(`function handler(req) {
  const source = ["safe", req.body.code];
  const copy = ["head", ...source];
  eval(copy[0]);
  eval(copy[1]);
  eval(copy[2]);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('copy.2')
  })

  it('advances offsets across multiple known spreads', () => {
    const flows = getFlows(`function handler(req) {
  const first = ["a", req.body.first];
  const second = ["b", req.body.second];
  const copy = ["head", ...first, "middle", ...second];
  eval(copy[1]);
  eval(copy[2]);
  eval(copy[3]);
  eval(copy[4]);
  eval(copy[5]);
}`)
    expect(flows).toHaveLength(2)
    expect(flows.map(flow => flow.path.find(item => /^copy\./.test(item)))).toEqual(['copy.2', 'copy.5'])
  })

  it('remaps a known nested array spread', () => {
    const flows = getFlows(`function handler(req) {
  const nested = [["safe", req.body.code]];
  const copy = ["head", ...nested[0]];
  eval(copy[1]);
  eval(copy[2]);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].path).toContain('copy.2')
  })

  it('uses a wildcard after an unknown-length spread instead of a wrong exact slot', () => {
    const flows = getFlows(`function handler(req, unknown) {
  const copy = ["head", ...unknown, req.body.code];
  eval(copy[2]);
  eval(copy[index]);
}`)
    expect(flows).toHaveLength(2)
    expect(flows.every(flow => flow.path.includes('copy.*'))).toBe(true)
    expect(flows.every(flow => !flow.path.includes('copy.2'))).toBe(true)
  })
})

describe('trackTaint — dynamic construction and catalog members', () => {
  it('stores a computed object property as a wildcard location', () => {
    const flow = getFlows(`function handler(req) {
  const values = { [key]: req.body.code };
  eval(values[otherKey]);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })

  it('lets a later exact property override a construction wildcard', () => {
    expect(getFlows(`function handler(req) {
  const values = { [key]: req.body.code, safe: "literal" };
  eval(values.safe);
}`)).toHaveLength(0)
  })

  it('materializes explicit Koa catalog alternatives for a dynamic member', () => {
    const flow = getFlows(`function handler(ctx) {
  eval(ctx.request[key].nested.code);
}`)[0]
    expect(flow.source).toMatchObject({
      origin: 'catalog-user-input',
      baseConfidence: 'high',
    })
    expect([
      'ctx.request.body',
      'ctx.request.query',
      'ctx.request.params',
      'ctx.request.headers',
    ]).toContain(flow.source.name)
    expect(flow.path).toContain('ctx.request[key].nested.code')
    expect(flow.path.at(-1)).toBe('eval()')
  })

  it('does not taint the Koa request parent while materializing dynamic children', () => {
    expect(getFlows(`function handler(ctx) { eval(ctx.request); }`)).toHaveLength(0)
  })
})

describe('trackTaint — Koa object-rest prefixes', () => {
  it('excludes explicitly bound Koa keys and remaps each remainder source', () => {
    const flows = getFlows(`function handler(ctx) {
  const { body, ...rest } = ctx.request;
  eval(rest.query.code);
  eval(rest.params.code);
  eval(rest.headers.code);
}`)
    expect(flows.map(flow => flow.source.name)).toEqual([
      'ctx.request.query',
      'ctx.request.params',
      'ctx.request.headers',
    ])
  })

  it('keeps nested body rest/default values on the body prefix', () => {
    const flows = getFlows(`function handler(ctx) {
  const { body: { known = "literal", ...rest } } = ctx.request;
  eval(known);
  eval(rest.other);
}`)
    expect(flows).toHaveLength(2)
    expect(flows.every(flow => flow.source.name === 'ctx.request.body')).toBe(true)
  })
})

describe('trackTaint — recursive NoSQL receiver bindings', () => {
  it('accepts an immutable alias of an imported model', () => {
    const flow = getFlows(`import Imported from './user-model';
const User = Imported;
function handler(req) { User.find(req.body.filter); }`)[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })

  it.each([
    `const Imported = require('./user-model'); const User = Imported;`,
    `const Imported = require('./user-model'); const Alias = Imported; const User = Alias;`,
    `const Base = mongoose.model('User'); const User = Base;`,
    `const Base = db.collection('users'); const User = Base;`,
  ])('accepts immutable CommonJS/model receiver aliases: %s', declaration => {
    const flow = getFlows(`function handler(req) {
  ${declaration}
  User.find(req.body.filter);
}`)[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })

  it.each([
    `class User extends mongoose.Model {}`,
    `const Base = mongoose.Model; class User extends Base {}`,
  ])('accepts classes extending a Mongoose model base: %s', declaration => {
    const flow = getFlows(`function handler(req) {
  ${declaration}
  User.find(req.body.filter);
}`)[0]
    expect(flow.sink.type).toBe('nosql-injection')
  })

  it.each([
    `const Plain = []; const User = Plain;`,
    `const Plain = {}; const Alias = Plain; const User = Alias;`,
    `const Plain = "value"; const User = Plain;`,
    `let User = mongoose.model('User'); User = [];`,
    `const Imported = require('./user-model'); let User = Imported;`,
  ])('rejects local values or mutable model aliases: %s', declaration => {
    expect(getFlows(`function handler(req) {
  ${declaration}
  User.find(req.body.filter);
}`)).toHaveLength(0)
  })

  it('terminates a cyclic immutable alias graph without trusting it', () => {
    expect(getFlows(`function handler(req) {
  const First = Second;
  const Second = First;
  First.find(req.body.filter);
}`)).toHaveLength(0)
  })
})

describe('trackTaint — binding-qualified local state', () => {
  it('keeps an outer tainted binding after a safe block shadow', () => {
    const flows = getFlows(`function handler(req) {
  let value = req.body.code;
  { let value = "literal"; eval(value); }
  eval(value);
}`)
    expect(flows).toHaveLength(1)
  })

  it('does not leak a tainted branch shadow into the safe outer binding', () => {
    const flows = getFlows(`function handler(req) {
  let value = "literal";
  if (flag) {
    let value = req.body.code;
    eval(value);
  }
  eval(value);
}`)
    expect(flows).toHaveLength(1)
  })

  it('does not catalog-taint a catch parameter shadowing req', () => {
    const flows = getFlows(`function handler(req) {
  try { throw new Error("x"); }
  catch (req) { eval(req.body.code); }
  eval(req.body.code);
}`)
    expect(flows).toHaveLength(1)
    expect(flows[0].source.name).toBe('req.body')
  })

  it('keeps same-name bindings isolated across nested functions', () => {
    const flows = getFlows(`function outer(req) {
  const value = req.body.outer;
  function inner(req) {
    const value = "literal";
    eval(value);
  }
  eval(value);
}`)
    expect(flows).toHaveLength(1)
  })
})

describe('trackTaint — centralized exact and wildcard writes', () => {
  it('invalidates stale descendants on an exact safe parent write', () => {
    expect(getFlows(`function handler(req) {
  let value = { nested: { raw: req.body.code } };
  value.nested = "literal";
  eval(value.nested.raw);
}`)).toHaveLength(0)
  })

  it('uses a newly tainted parent for descendant reads after stale child removal', () => {
    const flow = getFlows(`function handler(req) {
  let value = { child: "literal" };
  value = req.body;
  eval(value.child);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })

  it('clears tainted descendants when a container parent is replaced safely', () => {
    expect(getFlows(`function handler(req) {
  let value = { child: req.body.code };
  value = {};
  eval(value.child);
}`)).toHaveLength(0)
  })

  it('keeps an exact safe override isolated from a wildcard fallback', () => {
    const flows = getFlows(`function handler(req) {
  const value = { [key]: req.body.code };
  value.safe = "literal";
  eval(value.safe);
  eval(value.other);
}`)
    expect(flows).toHaveLength(1)
  })

  it.each([
    `value[key] = req.body.raw; value[other] = DOMPurify.sanitize(req.body.safe);`,
    `value[key] = DOMPurify.sanitize(req.body.safe); value[other] = req.body.raw;`,
  ])('unions multiple dynamic writes regardless of order: %s', writes => {
    const flow = getFlows(`function render(req) {
  const value = {};
  ${writes}
  element.innerHTML = value[lookup];
}`)[0]
    expect(flow).toMatchObject({ sanitized: false })
  })

  it('does not let a safe unknown write clear prior wildcard taint', () => {
    const flow = getFlows(`function handler(req) {
  const value = {};
  value[key] = req.body.code;
  value[other] = "literal";
  eval(value[lookup]);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })

  it('does not remove an exact safe override on a later safe unknown write', () => {
    expect(getFlows(`function handler(req) {
  const value = { [key]: req.body.code };
  value.safe = "literal";
  value[other] = "literal";
  eval(value.safe);
}`)).toHaveLength(0)
  })

  it('does not let an unknown spread clear feasible wildcard taint', () => {
    const flow = getFlows(`function handler(req, unknown) {
  const value = { [key]: req.body.code, ...unknown };
  eval(value[lookup]);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })

  it('uses the longest exact tainted ancestor for a descendant read', () => {
    const flow = getFlows(`function handler(req) {
  const value = { nested: req.body };
  eval(value.nested.deep.code);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })
})

describe('trackTaint — computed destructuring locations', () => {
  it('selects exact static computed object properties independently', () => {
    const flows = getFlows(`function handler(req) {
  const value = { safe: "literal", raw: req.body.code };
  const { ["safe"]: safe, ["raw"]: raw } = value;
  eval(safe);
  eval(raw);
}`)
    expect(flows).toHaveLength(1)
  })

  it('conservatively merges descendants for a dynamic object pattern', () => {
    const flow = getFlows(`function handler(req) {
  const value = { safe: "literal", raw: req.body.code };
  const { [key]: selected } = value;
  eval(selected);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })

  it('materializes dynamic Koa children through a computed object pattern', () => {
    const flow = getFlows(`function handler(ctx) {
  const { [key]: selected } = ctx.request;
  eval(selected.nested);
}`)[0]
    expect(flow.source).toMatchObject({ origin: 'catalog-user-input', baseConfidence: 'high' })
  })

  it('writes an array destructuring element to a dynamic member wildcard', () => {
    const flow = getFlows(`function handler(req) {
  const source = [req.body.code];
  const target = {};
  [target[key]] = source;
  eval(target[lookup]);
}`)[0]
    expect(flow.source.name).toBe('req.body')
  })
})

describe('trackTaint — canonical source-prefix rest aliases', () => {
  it('maps Koa rest children through an immutable alias chain', () => {
    const flows = getFlows(`function handler(ctx) {
  const request = ctx.request;
  const alias = request;
  const { body, ...rest } = alias;
  eval(rest.query.code);
  eval(rest.params.code);
  eval(rest.headers.code);
}`)
    expect(flows.map(flow => flow.source.name)).toEqual([
      'ctx.request.query',
      'ctx.request.params',
      'ctx.request.headers',
    ])
  })

  it('does not trust a mutable Koa source-prefix alias for rest mapping', () => {
    expect(getFlows(`function handler(ctx) {
  let request = ctx.request;
  request = safeObject;
  const { body, ...rest } = request;
  eval(rest.query.code);
}`)).toHaveLength(0)
  })
})

describe('trackTaint — terminating statement reachability', () => {
  it('does not process a sink after return', () => {
    expect(getFlows(`function handler(req) {
  return;
  eval(req.body.code);
}`)).toHaveLength(0)
  })

  it('keeps a sink before return and skips a later duplicate', () => {
    const flows = getFlows(`function handler(req) {
  eval(req.body.first);
  return;
  eval(req.body.second);
}`)
    expect(flows).toHaveLength(1)
  })

  it('does not merge a terminating raw branch into downstream state', () => {
    expect(getFlows(`function handler(req) {
  let value = "literal";
  if (flag) {
    value = req.body.code;
    return;
  } else {
    value = "literal";
  }
  eval(value);
}`)).toHaveLength(0)
  })

  it('does not process downstream statements when both branches terminate', () => {
    expect(getFlows(`function handler(req) {
  if (flag) return;
  else throw new Error("stop");
  eval(req.body.code);
}`)).toHaveLength(0)
  })

  it('stops loop-body processing after break but retains earlier sinks', () => {
    const flows = getFlows(`function handler(req) {
  while (flag) {
    eval(req.body.before);
    break;
    eval(req.body.after);
  }
}`)
    expect(flows).toHaveLength(1)
  })

  it('stops loop-body processing after continue', () => {
    expect(getFlows(`function handler(req) {
  while (flag) {
    continue;
    eval(req.body.after);
  }
}`)).toHaveLength(0)
  })
})
