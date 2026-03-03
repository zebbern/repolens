import { useMemo } from "react"

export interface ExtractedSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'method' | 'property'
  line: number
  isExported: boolean
  children?: ExtractedSymbol[]
}

const TS_PATTERNS: Array<{
  regex: RegExp
  kind: ExtractedSymbol['kind']
  nameGroup: number
  exportGroup: number
}> = [
  // Classes
  { regex: /^(\s*)(export\s+)?class\s+(\w+)/, kind: 'class', nameGroup: 3, exportGroup: 2 },
  // Interfaces
  { regex: /^(\s*)(export\s+)?interface\s+(\w+)/, kind: 'interface', nameGroup: 3, exportGroup: 2 },
  // Type aliases
  { regex: /^(\s*)(export\s+)?type\s+(\w+)\s*=/, kind: 'type', nameGroup: 3, exportGroup: 2 },
  // Enums
  { regex: /^(\s*)(export\s+)?enum\s+(\w+)/, kind: 'enum', nameGroup: 3, exportGroup: 2 },
  // Regular functions
  { regex: /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/, kind: 'function', nameGroup: 4, exportGroup: 2 },
  // Arrow functions / const assignments with function value
  { regex: /^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s+)?\(/, kind: 'function', nameGroup: 4, exportGroup: 2 },
  // Exported constants (non-function)
  { regex: /^(\s*)export\s+(const|let|var)\s+(\w+)/, kind: 'variable', nameGroup: 3, exportGroup: 0 },
]

const PY_PATTERNS: Array<{
  regex: RegExp
  kind: ExtractedSymbol['kind']
  nameGroup: number
  indentGroup: number
}> = [
  { regex: /^(\s*)class\s+(\w+)/, kind: 'class', nameGroup: 2, indentGroup: 1 },
  { regex: /^(\s*)def\s+(\w+)/, kind: 'function', nameGroup: 2, indentGroup: 1 },
]

function isPythonFile(language: string | undefined): boolean {
  return language === 'python' || language === 'py'
}

function isTsJsFile(language: string | undefined): boolean {
  if (!language) return false
  return ['typescript', 'javascript', 'ts', 'tsx', 'js', 'jsx', 'typescriptreact', 'javascriptreact'].includes(language.toLowerCase())
}

function extractTsSymbols(content: string): ExtractedSymbol[] {
  const lines = content.split('\n')
  const symbols: ExtractedSymbol[] = []
  let currentClass: ExtractedSymbol | null = null
  let classIndent = -1
  const seenFunctionNames = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    const leadingSpaces = line.search(/\S/)
    if (leadingSpaces === -1) continue // blank line

    // If we're inside a class and indentation drops back, end the class scope
    if (currentClass && leadingSpaces <= classIndent && line.trim().length > 0) {
      currentClass = null
      classIndent = -1
    }

    let matched = false
    for (const pattern of TS_PATTERNS) {
      const match = line.match(pattern.regex)
      if (!match) continue

      const name = match[pattern.nameGroup]
      const isExported = pattern.exportGroup === 0 ? true : !!match[pattern.exportGroup]

      // Skip if this is a variable pattern but we already matched it as a function (arrow function)
      if (pattern.kind === 'variable' && seenFunctionNames.has(name)) {
        matched = true
        break
      }

      if (pattern.kind === 'function') {
        seenFunctionNames.add(name)
      }

      // If inside a class scope, treat functions as methods
      if (currentClass && leadingSpaces > classIndent) {
        if (pattern.kind === 'function') {
          const method: ExtractedSymbol = {
            name,
            kind: 'method',
            line: lineNumber,
            isExported: false,
          }
          if (!currentClass.children) currentClass.children = []
          currentClass.children.push(method)
          matched = true
          break
        }
      }

      const symbol: ExtractedSymbol = {
        name,
        kind: pattern.kind,
        line: lineNumber,
        isExported,
      }

      if (pattern.kind === 'class') {
        currentClass = symbol
        classIndent = leadingSpaces
      }

      symbols.push(symbol)
      matched = true
      break
    }

    // Check for class method shorthand that doesn't match the TS_PATTERNS
    if (!matched && currentClass && leadingSpaces > classIndent) {
      const methodMatch = line.match(/^\s+(?:(?:private|protected|public|static|readonly|abstract|override|async)\s+)*(\w+)\s*\(/)
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'await', 'const', 'let', 'var', 'private', 'protected', 'public', 'static', 'readonly', 'abstract', 'override'].includes(methodMatch[1])) {
        const method: ExtractedSymbol = {
          name: methodMatch[1],
          kind: 'method',
          line: lineNumber,
          isExported: false,
        }
        if (!currentClass.children) currentClass.children = []
        currentClass.children.push(method)
      }
    }
  }

  return symbols
}

function extractPySymbols(content: string): ExtractedSymbol[] {
  const lines = content.split('\n')
  const symbols: ExtractedSymbol[] = []
  let currentClass: ExtractedSymbol | null = null
  let classIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    const leadingSpaces = line.search(/\S/)
    if (leadingSpaces === -1) continue

    // If inside class and indentation drops back, leave class scope
    if (currentClass && leadingSpaces <= classIndent && line.trim().length > 0) {
      currentClass = null
      classIndent = -1
    }

    for (const pattern of PY_PATTERNS) {
      const match = line.match(pattern.regex)
      if (!match) continue

      const name = match[pattern.nameGroup]
      const indent = match[pattern.indentGroup].length

      // Methods inside classes
      if (currentClass && indent > classIndent && pattern.kind === 'function') {
        const method: ExtractedSymbol = {
          name,
          kind: 'method',
          line: lineNumber,
          isExported: false,
        }
        if (!currentClass.children) currentClass.children = []
        currentClass.children.push(method)
        break
      }

      const symbol: ExtractedSymbol = {
        name,
        kind: pattern.kind,
        line: lineNumber,
        isExported: !name.startsWith('_'),
      }

      if (pattern.kind === 'class') {
        currentClass = symbol
        classIndent = indent
      }

      symbols.push(symbol)
      break
    }
  }

  return symbols
}

export function useSymbolExtraction(content: string | null | undefined, language: string | undefined): ExtractedSymbol[] {
  return useMemo(() => {
    if (!content) return []

    if (isPythonFile(language)) {
      return extractPySymbols(content)
    }

    if (isTsJsFile(language)) {
      return extractTsSymbols(content)
    }

    // Fallback: try TS patterns for unknown languages
    return extractTsSymbols(content)
  }, [content, language])
}
