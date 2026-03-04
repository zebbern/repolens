/**
 * Tests for 7 newly added AST analysis rules.
 *
 * Pattern: parseFileAST(code) → analyzeAST(ast, file) → assert ruleId.
 */

import { describe, it, expect } from 'vitest'
import { parseFileAST } from './ast-parser'
import { analyzeAST } from './ast-analysis'
import type { IndexedFile } from '../code-index'

// ============================================================================
// Helpers
// ============================================================================

function makeFile(content: string, language = 'typescript'): IndexedFile {
  const lines = content.split('\n')
  return {
    path: 'test.ts',
    name: 'test.ts',
    content,
    language,
    lines,
    lineCount: lines.length,
  }
}

function analyzeCode(code: string) {
  const ast = parseFileAST(code, 'typescript')
  if (!ast) throw new Error('Failed to parse code')
  const file = makeFile(code)
  return analyzeAST(ast, file)
}

// ============================================================================
// ast-constant-condition
// ============================================================================

describe('ast-constant-condition', () => {
  it('detects if(true)', () => {
    const code = `if (true) { doSomething(); }`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-constant-condition')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects while(false)', () => {
    const code = `while (false) { loop(); }`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-constant-condition')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects x === x', () => {
    const code = `if (x === x) { handle(); }`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-constant-condition')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag if(variable)', () => {
    const code = `if (isReady) { doSomething(); }`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-constant-condition')
    expect(hits).toHaveLength(0)
  })

  it('does not flag numeric literal 0 in condition (only boolean literals detected)', () => {
    const code = `if (0) { doSomething(); }`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-constant-condition')
    // Rule only detects BooleanLiteral (true/false) and self-comparisons, not NumericLiteral
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// ast-shadow-variable
// ============================================================================

describe('ast-shadow-variable', () => {
  it('detects inner variable shadowing outer', () => {
    const code = `
function outer() {
  const name = 'outer';
  function inner() {
    const name = 'inner';
    return name;
  }
  return inner();
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-shadow-variable')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects let shadowing outer let', () => {
    const code = `
function outer() {
  let result = 1;
  if (true) {
    let result = 2;
    console.log(result);
  }
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-shadow-variable')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag variables in independent scopes', () => {
    const code = `
function a() { const x = 1; return x; }
function b() { const x = 2; return x; }
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-shadow-variable')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// ast-no-return-await
// ============================================================================

describe('ast-no-return-await', () => {
  it('detects return await in async function', () => {
    const code = `
async function fetchData() {
  return await fetch('/api/data');
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-no-return-await')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects return await in async arrow function', () => {
    const code = `
const getData = async () => {
  return await api.get('/data');
};
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-no-return-await')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag await in non-return position', () => {
    const code = `
async function fetchData() {
  const response = await fetch('/api/data');
  return response.json();
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-no-return-await')
    expect(hits).toHaveLength(0)
  })

  it('detects return await even inside try-catch (rule does not distinguish)', () => {
    const code = `
async function fetchData() {
  try {
    return await fetch('/api/data');
  } catch (e) {
    return null;
  }
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-no-return-await')
    // The AST rule does not special-case try-catch (where return await IS useful)
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// ast-switch-no-default
// ============================================================================

describe('ast-switch-no-default', () => {
  it('detects switch without default case', () => {
    const code = `
switch (action) {
  case 'start':
    proceed();
    break;
  case 'stop':
    halt();
    break;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-switch-no-default')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('does not flag switch with default case', () => {
    const code = `
switch (action) {
  case 'start':
    proceed();
    break;
  default:
    noop();
    break;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-switch-no-default')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// ast-dangerous-default-param
// ============================================================================

describe('ast-dangerous-default-param', () => {
  it('detects mutable array default parameter', () => {
    const code = `
function addItem(items = []) {
  items.push('new');
  return items;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-dangerous-default-param')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects mutable object default parameter', () => {
    const code = `
function setConfig(config = {}) {
  config.debug = true;
  return config;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-dangerous-default-param')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag primitive default parameters', () => {
    const code = `
function greet(name = 'world', count = 1) {
  return name.repeat(count);
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-dangerous-default-param')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// ast-nested-ternary
// ============================================================================

describe('ast-nested-ternary', () => {
  it('detects nested ternary expression', () => {
    const code = `
const result = a ? b ? 'x' : 'y' : 'z';
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-nested-ternary')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects deeply nested ternary', () => {
    const code = `
const val = x ? (y ? (z ? 1 : 2) : 3) : 4;
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-nested-ternary')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag single ternary', () => {
    const code = `
const val = isActive ? 'yes' : 'no';
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-nested-ternary')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// ast-throw-literal
// ============================================================================

describe('ast-throw-literal', () => {
  it('detects throw with string literal', () => {
    const code = `
function validate() {
  throw 'something went wrong';
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-throw-literal')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('warning')
  })

  it('detects throw with number literal', () => {
    const code = `
function validate() {
  throw 404;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-throw-literal')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag throw new Error(...)', () => {
    const code = `
function validate() {
  throw new Error('something went wrong');
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-throw-literal')
    expect(hits).toHaveLength(0)
  })

  it('does not flag throw with variable', () => {
    const code = `
function validate() {
  const err = new Error('bad input');
  throw err;
}
`
    const issues = analyzeCode(code)
    const hits = issues.filter(i => i.ruleId === 'ast-throw-literal')
    expect(hits).toHaveLength(0)
  })
})
