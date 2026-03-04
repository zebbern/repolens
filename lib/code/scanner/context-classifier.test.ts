import { classifyLine, computeBlockCommentLines } from '@/lib/code/scanner/context-classifier'

describe('classifyLine', () => {
  // -------------------------------------------------------------------------
  // Comment detection
  // -------------------------------------------------------------------------

  describe('isComment', () => {
    it('detects JS single-line comment: // eval(foo)', () => {
      const result = classifyLine('// eval(foo)', 'src/app.ts')
      expect(result.isComment).toBe(true)
    })

    it('detects Python comment: # password = "secret"', () => {
      const result = classifyLine('# password = "secret"', 'src/app.py')
      expect(result.isComment).toBe(true)
    })

    it('detects SQL/Lua single-line comment: -- query', () => {
      const result = classifyLine('-- SELECT * FROM users', 'src/query.sql')
      expect(result.isComment).toBe(true)
    })

    it('detects comment with leading whitespace', () => {
      const result = classifyLine('    // eval(foo)', 'src/app.ts')
      expect(result.isComment).toBe(true)
    })

    it('returns false for non-comment: const x = eval(input)', () => {
      const result = classifyLine('const x = eval(input)', 'src/app.ts')
      expect(result.isComment).toBe(false)
    })

    it('returns false for inline comment after code', () => {
      const result = classifyLine('const x = 1 // comment', 'src/app.ts')
      expect(result.isComment).toBe(false)
    })

    it('detects line inside multi-line /* */ comment block', () => {
      const allLines = [
        '/* This is a',
        '   multi-line comment',
        '   with eval(foo)',
        '*/',
        'const x = 1',
      ]
      const blockCommentLines = computeBlockCommentLines(allLines)
      const result = classifyLine(allLines[2], 'src/app.ts', blockCommentLines, 2)
      expect(result.isComment).toBe(true)
    })

    it('detects line inside Python triple-double-quote docstring', () => {
      const allLines = [
        '"""',
        'This docstring contains password = "secret"',
        '"""',
      ]
      const blockCommentLines = computeBlockCommentLines(allLines)
      const result = classifyLine(allLines[1], 'src/app.py', blockCommentLines, 1)
      expect(result.isComment).toBe(true)
    })

    it('detects line inside Python triple-single-quote docstring', () => {
      const allLines = [
        "'''",
        'Another docstring with eval()',
        "'''",
      ]
      const blockCommentLines = computeBlockCommentLines(allLines)
      const result = classifyLine(allLines[1], 'src/app.py', blockCommentLines, 1)
      expect(result.isComment).toBe(true)
    })

    it('returns false for a line after a block comment has closed', () => {
      const allLines = [
        '/* comment */',
        'const x = eval(input)',
      ]
      const blockCommentLines = computeBlockCommentLines(allLines)
      const result = classifyLine(allLines[1], 'src/app.ts', blockCommentLines, 1)
      expect(result.isComment).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // String literal detection
  // -------------------------------------------------------------------------

  describe('isStringLiteral', () => {
    it('detects double-quoted string assignment', () => {
      const result = classifyLine('const msg = "use eval() for parsing";', 'src/app.ts')
      expect(result.isStringLiteral).toBe(true)
    })

    it('detects single-quoted string assignment', () => {
      const result = classifyLine("const msg = 'use eval() for parsing';", 'src/app.ts')
      expect(result.isStringLiteral).toBe(true)
    })

    it('returns false for function call', () => {
      const result = classifyLine('eval(userInput)', 'src/app.ts')
      expect(result.isStringLiteral).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Type annotation detection
  // -------------------------------------------------------------------------

  describe('isTypeAnnotation', () => {
    it('detects type alias: type Config = { password: string }', () => {
      const result = classifyLine('type Config = { password: string }', 'src/types.ts')
      expect(result.isTypeAnnotation).toBe(true)
    })

    it('detects interface', () => {
      const result = classifyLine('interface ApiKey { value: string }', 'src/types.ts')
      expect(result.isTypeAnnotation).toBe(true)
    })

    it('returns false for variable with password value', () => {
      const result = classifyLine('const password = "hunter2"', 'src/app.ts')
      expect(result.isTypeAnnotation).toBe(false)
    })

    it('treats .d.ts files as type annotations', () => {
      const result = classifyLine('export declare const password: string', 'src/types.d.ts')
      expect(result.isTypeAnnotation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Test file detection
  // -------------------------------------------------------------------------

  describe('isTestFile', () => {
    it.each([
      { path: 'src/utils.test.ts', desc: '.test.ts extension' },
      { path: 'src/utils.spec.ts', desc: '.spec.ts extension' },
      { path: '__tests__/utils.ts', desc: '__tests__/ directory' },
      { path: 'src/test/setup.ts', desc: 'test/ directory (nested)' },
      { path: '__mocks__/api.ts', desc: '__mocks__/ directory' },
    ])('detects test file: $desc ($path)', ({ path }) => {
      const result = classifyLine('console.log("debug")', path)
      expect(result.isTestFile).toBe(true)
    })

    it('returns false for non-test source file', () => {
      const result = classifyLine('console.log("debug")', 'src/utils.ts')
      expect(result.isTestFile).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Generated file detection
  // -------------------------------------------------------------------------

  describe('isGeneratedFile', () => {
    it.each([
      { path: 'types/api.d.ts', desc: '.d.ts file' },
      { path: '__generated__/schema.ts', desc: '__generated__/ directory' },
      { path: 'codegen/types.ts', desc: 'codegen/ directory' },
      { path: 'src/api.generated.ts', desc: '.generated. in name' },
      { path: 'generated/output.ts', desc: 'generated/ directory' },
    ])('detects generated file: $desc ($path)', ({ path }) => {
      const result = classifyLine('const x = 1', path)
      expect(result.isGeneratedFile).toBe(true)
    })

    it('returns false for non-generated source file', () => {
      const result = classifyLine('const x = 1', 'src/api.ts')
      expect(result.isGeneratedFile).toBe(false)
    })
  })
})
