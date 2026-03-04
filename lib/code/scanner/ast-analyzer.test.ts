import { describe, it, expect, beforeEach } from 'vitest'
import { parseFileAST, getAST, clearASTCache } from './ast-parser'
import { analyzeAST, extractScopeInfo, findFunctionBodies, isRouteHandler, isExportedFunction } from './ast-analysis'
import type { IndexedFile } from '../code-index'

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

describe('parseFileAST', () => {
  it('returns AST for valid JavaScript', () => {
    const ast = parseFileAST('const x = 1;', 'javascript')
    expect(ast).not.toBeNull()
    expect(ast!.type).toBe('File')
  })

  it('returns AST for valid TypeScript', () => {
    const ast = parseFileAST('const x: number = 1;', 'typescript')
    expect(ast).not.toBeNull()
  })

  it('returns AST for JSX', () => {
    const ast = parseFileAST('const el = <div>hi</div>;', 'jsx')
    expect(ast).not.toBeNull()
  })

  it('returns AST for TSX', () => {
    const ast = parseFileAST('const el: JSX.Element = <div />;', 'tsx')
    expect(ast).not.toBeNull()
  })

  it('returns null for Python', () => {
    expect(parseFileAST('def foo(): pass', 'python')).toBeNull()
  })

  it('returns null for CSS', () => {
    expect(parseFileAST('body { color: red; }', 'css')).toBeNull()
  })

  it('returns null for empty language', () => {
    expect(parseFileAST('const x = 1;', '')).toBeNull()
  })

  it('returns null without throwing for severely invalid code', () => {
    // errorRecovery handles some errors; severely broken syntax may still return null
    expect(() => parseFileAST('const x = ; const y = 2;', 'javascript')).not.toThrow()
  })
})

describe('getAST', () => {
  beforeEach(() => {
    clearASTCache()
  })

  it('returns AST for eligible files', () => {
    const file = makeFile('const x = 1;')
    const ast = getAST(file)
    expect(ast).not.toBeNull()
  })

  it('caches AST on repeated calls with same content', () => {
    const file = makeFile('const x = 1;')
    const ast1 = getAST(file)
    const ast2 = getAST(file)
    expect(ast1).toBe(ast2)
  })

  it('returns null for non-JS files', () => {
    const file = makeFile('body { color: red; }', 'css')
    expect(getAST(file)).toBeNull()
  })

  it('skips files exceeding 5000 lines', () => {
    const bigContent = Array.from({ length: 5001 }, (_, i) => `// line ${i}`).join('\n')
    const file = makeFile(bigContent)
    expect(getAST(file)).toBeNull()
  })

  it('returns null without throwing for unparseable content', () => {
    const file = makeFile('<<<<<<< CONFLICT', 'javascript')
    expect(() => getAST(file)).not.toThrow()
  })
})

describe('analyzeAST', () => {
  beforeEach(() => {
    clearASTCache()
  })

  it('detects eval() usage', () => {
    const code = `const x = eval('1 + 2');`
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    const evalIssue = issues.find(i => i.ruleId === 'ast-eval-usage')
    expect(evalIssue).toBeDefined()
    expect(evalIssue!.severity).toBe('critical')
    expect(evalIssue!.category).toBe('security')
    expect(evalIssue!.line).toBe(1)
    expect(evalIssue!.confidence).toBe('high')
  })

  it('detects Function constructor call', () => {
    const code = `const fn = Function('return 1');`
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    const issue = issues.find(i => i.ruleId === 'ast-eval-usage')
    expect(issue).toBeDefined()
    expect(issue!.title).toContain('Function constructor')
  })

  it('detects new Function() constructor', () => {
    const code = `const fn = new Function('a', 'return a');`
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    expect(issues.find(i => i.ruleId === 'ast-eval-usage')).toBeDefined()
  })

  it('detects empty catch block', () => {
    const code = 'try {\n  doSomething();\n} catch (e) {\n}'
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    const catchIssue = issues.find(i => i.ruleId === 'ast-empty-catch')
    expect(catchIssue).toBeDefined()
    expect(catchIssue!.severity).toBe('warning')
    expect(catchIssue!.category).toBe('reliability')
  })

  it('does not flag catch blocks with content', () => {
    const code = 'try { doSomething(); }\ncatch (e) { console.error(e); }'
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    expect(issues.find(i => i.ruleId === 'ast-empty-catch')).toBeUndefined()
  })

  it('detects unreachable code after return', () => {
    const code = 'function foo() {\n  return 1;\n  const x = 2;\n}'
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    const unreachable = issues.find(i => i.ruleId === 'ast-unreachable-code')
    expect(unreachable).toBeDefined()
    expect(unreachable!.line).toBe(3)
    expect(unreachable!.description).toContain('return')
  })

  it('detects unreachable code after throw', () => {
    const code = 'function foo() {\n  throw new Error("fail");\n  const x = 2;\n}'
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    expect(issues.find(i => i.ruleId === 'ast-unreachable-code')).toBeDefined()
  })

  it('does not flag code without unreachable statements', () => {
    const code = 'function foo() {\n  const x = 1;\n  return x;\n}'
    const file = makeFile(code, 'javascript')
    const ast = parseFileAST(code, 'javascript')!
    const issues = analyzeAST(ast, file)

    expect(issues.find(i => i.ruleId === 'ast-unreachable-code')).toBeUndefined()
  })

  it('returns empty array for clean code', () => {
    const code = 'export const add = (a: number, b: number) => a + b;'
    const file = makeFile(code)
    const ast = parseFileAST(code, 'typescript')!
    const issues = analyzeAST(ast, file)

    expect(issues).toEqual([])
  })
})

describe('extractScopeInfo', () => {
  it('extracts imports', () => {
    const code = `import { foo, bar } from './utils';`
    const ast = parseFileAST(code, 'typescript')!
    const scope = extractScopeInfo(ast)

    expect(scope.imports).toHaveLength(1)
    expect(scope.imports[0].source).toBe('./utils')
    expect(scope.imports[0].specifiers).toEqual(['foo', 'bar'])
  })

  it('extracts default imports', () => {
    const code = `import React from 'react';`
    const ast = parseFileAST(code, 'typescript')!
    const scope = extractScopeInfo(ast)

    expect(scope.imports[0].specifiers).toContain('default')
  })

  it('extracts exported functions', () => {
    const code = `export function greet(name: string) { return 'hi ' + name; }`
    const ast = parseFileAST(code, 'typescript')!
    const scope = extractScopeInfo(ast)

    expect(scope.exports).toHaveLength(1)
    expect(scope.exports[0].name).toBe('greet')
    expect(scope.functions).toHaveLength(1)
    expect(scope.functions[0].isExported).toBe(true)
  })

  it('extracts variables', () => {
    const code = `const x = 1;\nlet y = 2;\nvar z = 3;`
    const ast = parseFileAST(code, 'javascript')!
    const scope = extractScopeInfo(ast)

    expect(scope.variables).toHaveLength(3)
    expect(scope.variables.map(v => v.kind)).toEqual(['const', 'let', 'var'])
  })
})

describe('findFunctionBodies', () => {
  it('finds function declarations', () => {
    const code = 'function foo() {\n  return 1;\n}'
    const ast = parseFileAST(code, 'javascript')!
    const bodies = findFunctionBodies(ast)

    expect(bodies).toHaveLength(1)
    expect(bodies[0].name).toBe('foo')
    expect(bodies[0].startLine).toBe(1)
    expect(bodies[0].endLine).toBe(3)
  })

  it('finds arrow functions assigned to variables', () => {
    const code = `const greet = (name) => 'hi ' + name;`
    const ast = parseFileAST(code, 'javascript')!
    const bodies = findFunctionBodies(ast)

    expect(bodies).toHaveLength(1)
    expect(bodies[0].name).toBe('greet')
  })

  it('identifies async functions', () => {
    const code = `async function fetchData() { return await fetch('/api'); }`
    const ast = parseFileAST(code, 'javascript')!
    const bodies = findFunctionBodies(ast)

    expect(bodies[0].isAsync).toBe(true)
  })
})

describe('isRouteHandler', () => {
  it('detects Express-style routes', () => {
    const code = `app.get('/api/users', (req, res) => res.json([]));`
    const ast = parseFileAST(code, 'javascript')!
    expect(isRouteHandler(ast)).toBe(true)
  })

  it('detects Next.js API routes', () => {
    const code = `export async function GET(request) { return Response.json({}); }`
    const ast = parseFileAST(code, 'javascript')!
    expect(isRouteHandler(ast)).toBe(true)
  })

  it('returns false for non-route code', () => {
    const code = `export function add(a, b) { return a + b; }`
    const ast = parseFileAST(code, 'javascript')!
    expect(isRouteHandler(ast)).toBe(false)
  })
})

describe('isExportedFunction', () => {
  it('finds named exported function', () => {
    const code = `export function calculate() { return 42; }`
    const ast = parseFileAST(code, 'javascript')!
    expect(isExportedFunction(ast, 'calculate')).toBe(true)
  })

  it('returns false for non-exported function', () => {
    const code = `function calculate() { return 42; }`
    const ast = parseFileAST(code, 'javascript')!
    expect(isExportedFunction(ast, 'calculate')).toBe(false)
  })

  it('finds re-exported function', () => {
    const code = `function calc() {}\nexport { calc };`
    const ast = parseFileAST(code, 'javascript')!
    expect(isExportedFunction(ast, 'calc')).toBe(true)
  })
})
