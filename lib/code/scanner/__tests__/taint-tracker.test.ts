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
    expect(flow).toMatchObject({ sanitized: false, confidence: 'medium' })
    expect(flow!.mitigationEvidence.map(item => item.name)).toEqual(['DOMPurify.sanitize()'])
  })

  it('reports when only one conditional branch is sanitized', () => {
    const flow = getFlows(`function handler(req) {
  const value = flag ? DOMPurify.sanitize(req.body.html) : req.body.html;
  element.innerHTML = value;
}`).find(candidate => candidate.sink.type === 'xss')
    expect(flow).toMatchObject({
      sanitized: false,
      precision: 'control-flow-approximate',
      confidence: 'low',
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
      confidence: 'low',
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
