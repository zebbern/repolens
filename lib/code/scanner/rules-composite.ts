// Composite scan rules — file-level rules that detect co-occurring dangerous
// patterns. The danger comes from the combination, not a single line.

import type { CodeIndex } from '../code-index'
import type { CompositeRule, CodeIssue } from './types'
import { SKIP_VENDORED } from './constants'

// ---------------------------------------------------------------------------
// Composite file-level rules
// ---------------------------------------------------------------------------

export const COMPOSITE_RULES: CompositeRule[] = [
  // child_process imported + command string built from variables/format
  {
    id: 'composite-cmd-injection-exec-var',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection: exec() with Constructed String',
    description: 'This file imports child_process and calls exec()/execSync() with a string variable rather than a literal. When the command string is built from user input, file paths, or util.format(), this enables OS command injection (CWE-78). The exec() function always invokes a shell which interprets metacharacters like ;, |, &&, and $().',
    suggestion: 'Replace exec(cmd) with execFile("program", [arg1, arg2]) which bypasses the shell. If exec() is required, use the shell-quote or shell-escape library to sanitize all interpolated values.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/78.html',
    fileFilter: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    requiredPatterns: [
      /(?:require\s*\(\s*['"]child_process['"]\)|from\s+['"]child_process['"]|from\s+['"]node:child_process['"])/,
      /\bexec(?:Sync)?\s*\(\s*[a-zA-Z_$]/,  // exec called with a variable, not a string literal
    ],
    sinkPattern: /\bexec(?:Sync)?\s*\(\s*[a-zA-Z_$]/,
    mitigations: [/execFile|shell-quote|shell-escape|shellescape/],
    confidence: 'medium',
  },
  // child_process + util.format (the exact node-pdf-image pattern)
  {
    id: 'composite-cmd-injection-format',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection: Shell Command Built with util.format()',
    description: 'This file uses child_process for execution AND util.format() to build strings. This is a classic command injection pattern: format strings construct shell commands with interpolated values. If any interpolated value comes from user input (filenames, URLs, request parameters), an attacker can inject shell metacharacters to execute arbitrary commands. This exact pattern (CVE-2024-56334) has caused critical RCE vulnerabilities in popular npm packages.',
    suggestion: 'Use execFile() with an array of arguments instead of exec() with a formatted string. Example: execFile("identify", [pdfPath]) instead of exec(util.format(\'identify "%s"\', pdfPath))',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/78.html',
    fileFilter: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    requiredPatterns: [
      /(?:require\s*\(\s*['"]child_process['"]\)|from\s+['"]child_process['"]|from\s+['"]node:child_process['"])/,
      /util\.format\s*\(/,
    ],
    sinkPattern: /util\.format\s*\(/,
    mitigations: [/execFile|shell-quote|shell-escape|shellescape/],
    confidence: 'medium',
  },
  // child_process + string concatenation for command building
  {
    id: 'composite-cmd-injection-concat',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection: Shell Command Built with String Concatenation',
    description: 'This file uses child_process for execution AND builds strings with concatenation (+) that appear to be command strings. String concatenation for shell commands is inherently dangerous because the concatenated values may contain shell metacharacters.',
    suggestion: 'Use execFile() or spawn() with an array of arguments. Never concatenate user input into command strings.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/78.html',
    fileFilter: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    requiredPatterns: [
      /(?:require\s*\(\s*['"]child_process['"]\)|from\s+['"]child_process['"]|from\s+['"]node:child_process['"])/,
      /(?:command|cmd)\s*(?:=|\+=)\s*.*\+/,
    ],
    sinkPattern: /(?:command|cmd)\s*(?:=|\+=)\s*.*\+/,
    mitigations: [/execFile|shell-quote|shell-escape|shellescape/],
    confidence: 'medium',
  },
  // Python: os.system/os.popen with string formatting
  {
    id: 'composite-python-os-cmd',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection: os.system/popen with Formatted String',
    description: 'This file uses os.system() or os.popen() with string formatting (f-strings, .format(), or %). If any formatted value comes from user input, this enables command injection.',
    suggestion: 'Use subprocess.run(["cmd", "arg1"], shell=False) with a list of arguments instead',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    fileFilter: ['.py', '.pyw'],
    requiredPatterns: [
      /\bos\.(?:system|popen)\s*\(/,
      /(?:f['"]|\.format\s*\(|%\s*[(\w])/,
    ],
    sinkPattern: /\bos\.(?:system|popen)\s*\(/,
    mitigations: [/shlex\.quote|pipes\.quote/],
    confidence: 'medium',
  },
  // Node.js: request parameter passed directly to file system operation
  {
    id: 'composite-path-traversal-req',
    category: 'security',
    severity: 'critical',
    title: 'Path Traversal: User Input in File Operation',
    description: 'This file reads request parameters (req.params, req.query, req.body) AND performs file system operations. If the request parameter flows into the file path without validation, attackers can read arbitrary files (../../etc/passwd).',
    suggestion: 'Validate the path with path.resolve() and verify it starts with your intended base directory using startsWith()',
    cwe: 'CWE-22',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/22.html',
    fileFilter: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    requiredPatterns: [
      /(?:req\.params|req\.query|req\.body|request\.params|searchParams\.get)/,
      /(?:readFile|writeFile|createReadStream|readdir|unlink|stat|access)(?:Sync)?\s*\(/,
    ],
    sinkPattern: /(?:readFile|writeFile|createReadStream|readdir|unlink|stat|access)(?:Sync)?\s*\(/,
    mitigations: [/path\.resolve.*startsWith|sanitize.*path|whitelist|allowedPaths/],
    confidence: 'medium',
  },
  // SSRF: user input flows into HTTP request
  {
    id: 'composite-ssrf',
    category: 'security',
    severity: 'critical',
    title: 'Potential SSRF: User Input in HTTP Request URL',
    description: 'This file reads user input (request params, query, body) AND makes outbound HTTP requests. If the URL is constructed from user input, attackers can make your server request internal resources (metadata APIs, internal services, cloud credentials).',
    suggestion: 'Validate URLs against an allowlist of trusted hosts. Block private/internal IP ranges. Use a URL parser to verify the host before making requests.',
    cwe: 'CWE-918',
    owasp: 'A10:2021 Server-Side Request Forgery',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/918.html',
    fileFilter: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    requiredPatterns: [
      /(?:req\.params|req\.query|req\.body|request\.params|searchParams\.get)/,
      /(?:fetch\s*\(|axios\.|got\(|http\.request|https\.request|urllib)/,
    ],
    sinkPattern: /(?:fetch\s*\(|axios\.|got\(|http\.request|https\.request)/,
    mitigations: [/allowlist|whitelist|allowedHosts|validUrl|isValidUrl|URL_ALLOWLIST/i],
    confidence: 'medium',
  },
]

// ---------------------------------------------------------------------------
// Composite rule scanner
// ---------------------------------------------------------------------------

export function scanCompositeRules(codeIndex: CodeIndex): CodeIssue[] {
  const issues: CodeIssue[] = []

  for (const [path, file] of codeIndex.files) {
    // Check file extension
    const ext = '.' + (path.split('.').pop() || '').toLowerCase()
    
    for (const rule of COMPOSITE_RULES) {
      if (!rule.fileFilter.includes(ext)) continue
      if (SKIP_VENDORED.test(path)) continue

      // Build full file content from lines
      const content = file.lines.join('\n')

      // Check ALL required patterns are present
      const allPresent = rule.requiredPatterns.every(p => p.test(content))
      if (!allPresent) continue

      // Check mitigations — if ANY mitigation is present, skip
      // Track partial mitigation for credit
      let hasPartialMitigation = false
      if (rule.mitigations && rule.mitigations.length > 0) {
        const mitigationMatches = rule.mitigations.filter(m => m.test(content))
        if (mitigationMatches.length === rule.mitigations.length) continue // all mitigations present → skip
        if (mitigationMatches.length > 0) hasPartialMitigation = true
      }

      // Find the sink line (where the dangerous operation happens)
      let sinkLine = 1
      let sinkSnippet = ''
      for (let i = 0; i < file.lines.length; i++) {
        if (rule.sinkPattern.test(file.lines[i])) {
          sinkLine = i + 1
          sinkSnippet = file.lines[i].trim()
          break
        }
      }

      const description = hasPartialMitigation
        ? rule.description + ' (partial mitigation detected — some safeguards present but incomplete)'
        : rule.description

      issues.push({
        id: `${rule.id}-${path}`,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        description,
        file: path,
        line: sinkLine,
        column: 0,
        snippet: sinkSnippet || 'Multiple dangerous patterns detected in this file',
        suggestion: rule.suggestion,
        cwe: rule.cwe,
        owasp: rule.owasp,
        learnMoreUrl: rule.learnMoreUrl,
        confidence: rule.confidence,
        fix: rule.fix,
        fixDescription: rule.fixDescription,
      })
    }
  }

  return issues
}
