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
      path: ['req.body', 'innerHTML'],
      file: 'test.ts',
      startLine: 1,
      endLine: 1,
    }
    const sqlFlow: TaintFlow = {
      source: DEFAULT_SOURCES[0],
      sink: DEFAULT_SINKS[2], // db.query()
      sanitized: false,
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
