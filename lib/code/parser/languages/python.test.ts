import { extractPythonImports } from '@/lib/code/parser/languages/python'

describe('extractPythonImports', () => {
  const filePath = 'src/app.py'
  const indexedPaths = new Set([
    'src/utils.py',
    'src/models/user.py',
    'src/models/__init__.py',
  ])

  describe('from ... import statements', () => {
    it.each([
      {
        desc: 'from module import name',
        code: `from pathlib import Path`,
        expected: { source: 'pathlib', specifiers: ['Path'], isDefault: false },
      },
      {
        desc: 'from module import multiple names',
        code: `from os.path import join, exists, dirname`,
        expected: { source: 'os.path', specifiers: ['join', 'exists', 'dirname'], isDefault: false },
      },
      {
        desc: 'from module import with alias strips alias',
        code: `from datetime import datetime as dt`,
        expected: { source: 'datetime', specifiers: ['datetime'], isDefault: false },
      },
    ])('$desc', ({ code, expected }) => {
      const result = extractPythonImports(code, filePath, indexedPaths)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject(expected)
    })
  })

  describe('import statements', () => {
    it.each([
      {
        desc: 'simple import',
        code: `import os`,
        expected: { source: 'os', specifiers: ['os'], isDefault: false },
      },
      {
        desc: 'dotted import',
        code: `import os.path`,
        expected: { source: 'os.path', specifiers: ['path'], isDefault: false },
      },
      {
        desc: 'multiple comma-separated imports',
        code: `import os, sys, json`,
        expectedCount: 3,
      },
    ])('$desc', ({ code, expected, expectedCount }) => {
      const result = extractPythonImports(code, filePath, indexedPaths)
      if (expectedCount) {
        expect(result).toHaveLength(expectedCount)
      } else {
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject(expected!)
      }
    })
  })

  describe('relative imports', () => {
    it('handles relative from import', () => {
      const code = `from .utils import helper`
      const result = extractPythonImports(code, filePath, indexedPaths)
      expect(result).toHaveLength(1)
      expect(result[0].specifiers).toEqual(['helper'])
    })
  })

  describe('module resolution', () => {
    const tree = new Set([
      'server/app.py',
      'server/models.py',
      'server/services/__init__.py',
      'server/services/user_service.py',
      'server/api/__init__.py',
      'server/api/routes.py',
    ])
    const resolve = (code: string, from: string) => extractPythonImports(code, from, tree)[0]

    it.each([
      ['a sibling package', 'from .services import UserService', 'server/app.py', 'server/services/__init__.py'],
      ['a sibling module', 'from .models import User', 'server/app.py', 'server/models.py'],
      ['a parent-package module', 'from ..models import User', 'server/api/routes.py', 'server/models.py'],
      ['a module inside a parent-package package', 'from ..services.user_service import create', 'server/api/routes.py', 'server/services/user_service.py'],
      ['a submodule named after a bare dot', 'from . import user_service', 'server/services/__init__.py', 'server/services/user_service.py'],
      ['the current package for a bare dot', 'from . import helpers', 'server/services/__init__.py', 'server/services/__init__.py'],
      ['an absolute module from a nested file', 'from server.models import User', 'server/api/routes.py', 'server/models.py'],
      ['an absolute package import', 'import server.services', 'server/api/routes.py', 'server/services/__init__.py'],
    ])('resolves %s', (_name, code, from, expected) => {
      expect(resolve(code, from)).toMatchObject({ resolvedPath: expected, isExternal: false })
    })

    it('leaves an unknown relative module unresolved but not external', () => {
      expect(resolve('from .missing import x', 'server/app.py')).toMatchObject({ resolvedPath: null, isExternal: false })
    })

    it('treats a third-party module as external', () => {
      expect(resolve('from os.path import join', 'server/api/routes.py')).toMatchObject({ resolvedPath: null, isExternal: true })
    })

    it('does not climb above the repository root', () => {
      expect(resolve('from ...models import User', 'server/app.py')).toMatchObject({ resolvedPath: null, isExternal: false })
    })
  })

  describe('deduplication', () => {
    it('deduplicates repeated from-imports of the same module', () => {
      const code = [
        `from os import path`,
        `from os import getcwd`,
      ].join('\n')
      const result = extractPythonImports(code, filePath, indexedPaths)
      expect(result).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('returns empty for code without imports', () => {
      const code = `def add(a, b):\n    return a + b`
      const result = extractPythonImports(code, filePath, indexedPaths)
      expect(result).toHaveLength(0)
    })

    it('handles multiple import types together', () => {
      const code = [
        `import os`,
        `from pathlib import Path`,
        `import sys`,
      ].join('\n')
      const result = extractPythonImports(code, filePath, indexedPaths)
      expect(result).toHaveLength(3)
    })
  })
})
