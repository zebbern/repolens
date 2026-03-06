// Tree-sitter S-expression query rules for multi-language security and quality scanning.
//
// These rules target languages NOT covered by the Babel AST analyzer (Python, Java, Go,
// Rust, C, C++, Ruby, PHP, Swift, Kotlin). JS/TS are excluded to avoid overlap.

import type { IssueCategory, IssueSeverity } from './types'

export interface TreeSitterRule {
  id: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  description: string
  suggestion?: string
  cwe?: string
  owasp?: string
  /** Tree-sitter S-expression query */
  query: string
  /** Languages this rule applies to */
  languages: string[]
  /** Name of the capture to report (default: first capture) */
  captureName?: string
  /** Regex to exclude files by path */
  excludeFiles?: RegExp
  confidence?: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------------------
// Security Rules
// ---------------------------------------------------------------------------

const SECURITY_RULES: TreeSitterRule[] = [
  // --- SQL Injection ---
  {
    id: 'ts-sql-injection-py',
    category: 'security',
    severity: 'critical',
    title: 'SQL Injection (Python)',
    description: 'String concatenation or f-string used in SQL query method. Use parameterized queries instead.',
    suggestion: 'Use parameterized queries: cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    query: `(call
  function: (attribute
    attribute: (identifier) @_method)
  arguments: (argument_list
    (binary_operator
      operator: "+") @concat)
  (#match? @_method "^(execute|executemany|raw)$"))`,
    languages: ['python'],
    captureName: 'concat',
    confidence: 'high',
  },
  {
    id: 'ts-sql-injection-java',
    category: 'security',
    severity: 'critical',
    title: 'SQL Injection (Java)',
    description: 'String concatenation in SQL statement creation. Use PreparedStatement with parameterized queries.',
    suggestion: 'Use PreparedStatement: conn.prepareStatement("SELECT * FROM users WHERE id = ?")',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    query: `(method_invocation
  name: (identifier) @_method
  arguments: (argument_list
    (binary_expression
      operator: "+") @concat)
  (#match? @_method "^(executeQuery|executeUpdate|execute|prepareStatement)$"))`,
    languages: ['java'],
    captureName: 'concat',
    confidence: 'high',
  },
  {
    id: 'ts-sql-injection-go',
    category: 'security',
    severity: 'critical',
    title: 'SQL Injection (Go)',
    description: 'String formatting used in database query. Use parameterized queries with $1 or ? placeholders.',
    suggestion: 'Use parameterized queries: db.Query("SELECT * FROM users WHERE id = $1", userID)',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    query: `(call_expression
  function: (selector_expression
    field: (field_identifier) @_method)
  arguments: (argument_list
    (call_expression
      function: (selector_expression
        field: (field_identifier) @_fmt))
    )
  (#match? @_method "^(Query|QueryRow|Exec|QueryContext|ExecContext)$")
  (#match? @_fmt "^(Sprintf|Fprintf)$"))`,
    languages: ['go'],
    captureName: '_method',
    confidence: 'high',
  },

  // --- Command Injection ---
  {
    id: 'ts-command-injection-py',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection (Python)',
    description: 'Shell command execution via os/subprocess module. Validate and sanitize inputs, or use subprocess with shell=False.',
    suggestion: 'Use subprocess.run([...], shell=False) with a list of arguments instead of a shell string.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    query: `(call
  function: (attribute
    object: (identifier) @_mod
    attribute: (identifier) @_fn)
  (#match? @_mod "^(os|subprocess)$")
  (#match? @_fn "^(system|popen|call|run|check_output|check_call)$"))`,
    languages: ['python'],
    captureName: '_fn',
    confidence: 'medium',
  },
  {
    id: 'ts-command-injection-java',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection (Java)',
    description: 'Runtime.exec() can be vulnerable to command injection. Validate inputs and avoid shell expansion.',
    suggestion: 'Use ProcessBuilder with a list of arguments instead of Runtime.exec() with a single string.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    query: `(method_invocation
  object: (_)
  name: (identifier) @_method
  (#match? @_method "^exec$"))`,
    languages: ['java'],
    captureName: '_method',
    confidence: 'medium',
  },
  {
    id: 'ts-command-injection-go',
    category: 'security',
    severity: 'critical',
    title: 'Command Injection (Go)',
    description: 'exec.Command can be vulnerable to command injection if arguments come from user input.',
    suggestion: 'Validate and sanitize all arguments passed to exec.Command. Avoid shell expansion.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    query: `(call_expression
  function: (selector_expression
    field: (field_identifier) @_fn)
  (#match? @_fn "^(Command|CommandContext)$"))`,
    languages: ['go'],
    captureName: '_fn',
    confidence: 'medium',
  },
  {
    id: 'ts-command-injection-rust',
    category: 'security',
    severity: 'warning',
    title: 'Command Execution (Rust)',
    description: 'std::process::Command usage detected. Ensure arguments are validated.',
    suggestion: 'Validate and sanitize all arguments. Avoid passing user input directly.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    query: `(call_expression
  function: (scoped_identifier
    path: (identifier) @_path
    name: (identifier) @_fn)
  (#eq? @_path "Command")
  (#eq? @_fn "new"))`,
    languages: ['rust'],
    captureName: '_fn',
    confidence: 'low',
  },

  // --- Eval / Dynamic Code Execution ---
  {
    id: 'ts-eval-py',
    category: 'security',
    severity: 'critical',
    title: 'Dynamic Code Execution (Python)',
    description: 'eval()/exec()/compile() executes arbitrary code. Avoid using with untrusted input.',
    suggestion: 'Use ast.literal_eval() for safe evaluation, or avoid dynamic code execution entirely.',
    cwe: 'CWE-94',
    owasp: 'A03:2021 Injection',
    query: `(call
  function: (identifier) @fn
  (#match? @fn "^(eval|exec|compile)$"))`,
    languages: ['python'],
    captureName: 'fn',
    confidence: 'high',
  },
  {
    id: 'ts-eval-ruby',
    category: 'security',
    severity: 'critical',
    title: 'Dynamic Code Execution (Ruby)',
    description: 'eval() executes arbitrary Ruby code. Avoid using with untrusted input.',
    suggestion: 'Avoid eval(). Use safer alternatives like send() with a whitelist of allowed methods.',
    cwe: 'CWE-94',
    owasp: 'A03:2021 Injection',
    query: `(call
  method: (identifier) @fn
  (#match? @fn "^eval$"))`,
    languages: ['ruby'],
    captureName: 'fn',
    confidence: 'high',
  },

  // --- Hardcoded Secrets ---
  {
    id: 'ts-hardcoded-secret-py',
    category: 'security',
    severity: 'warning',
    title: 'Hardcoded Secret (Python)',
    description: 'A variable with a credential-like name is assigned a string literal. Use environment variables or a secrets manager.',
    suggestion: 'Use os.environ.get("SECRET_KEY") or a secrets manager instead of hardcoding.',
    cwe: 'CWE-798',
    owasp: 'A07:2021 Identification and Authentication Failures',
    query: `(assignment
  left: (identifier) @_name
  right: (string) @value
  (#match? @_name "^(password|secret|api_key|apikey|token|private_key|auth_token|access_key|PASSWORD|SECRET|API_KEY|APIKEY|TOKEN|PRIVATE_KEY|AUTH_TOKEN|ACCESS_KEY|Password|Secret|Api_Key|Token|Private_Key)$"))`,
    languages: ['python'],
    captureName: 'value',
    excludeFiles: /test|fixture|__tests__|spec|mock/i,
    confidence: 'medium',
  },
  {
    id: 'ts-hardcoded-secret-java',
    category: 'security',
    severity: 'warning',
    title: 'Hardcoded Secret (Java)',
    description: 'A variable with a credential-like name is assigned a string literal. Use environment variables or a vault.',
    suggestion: 'Use System.getenv("SECRET_KEY") or a secrets manager.',
    cwe: 'CWE-798',
    owasp: 'A07:2021 Identification and Authentication Failures',
    query: `(variable_declarator
  name: (identifier) @_name
  value: (string_literal) @value
  (#match? @_name "^(password|secret|apiKey|token|privateKey|authToken|accessKey|PASSWORD|SECRET|APIKEY|TOKEN|PRIVATEKEY|AUTHTOKEN|ACCESSKEY|Password|Secret|ApiKey|Token|PrivateKey|AuthToken|AccessKey)$"))`,
    languages: ['java'],
    captureName: 'value',
    confidence: 'medium',
  },
  {
    id: 'ts-hardcoded-secret-go',
    category: 'security',
    severity: 'warning',
    title: 'Hardcoded Secret (Go)',
    description: 'A variable with a credential-like name is assigned a string literal. Use environment variables.',
    suggestion: 'Use os.Getenv("SECRET_KEY") instead of hardcoding secrets.',
    cwe: 'CWE-798',
    owasp: 'A07:2021 Identification and Authentication Failures',
    query: `(short_var_declaration
  left: (expression_list
    (identifier) @_name)
  right: (expression_list
    (interpreted_string_literal) @value)
  (#match? @_name "^(password|secret|apiKey|token|privateKey|authToken|accessKey|PASSWORD|SECRET|APIKEY|TOKEN|PRIVATEKEY|AUTHTOKEN|ACCESSKEY|Password|Secret|ApiKey|Token|PrivateKey|AuthToken|AccessKey)$"))`,
    languages: ['go'],
    captureName: 'value',
    confidence: 'medium',
  },

  // --- Insecure Hash ---
  {
    id: 'ts-insecure-hash-py',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Hash Algorithm (Python)',
    description: 'MD5/SHA1 should not be used for security purposes. Use SHA-256 or stronger.',
    suggestion: 'Use hashlib.sha256() or hashlib.sha3_256() instead.',
    cwe: 'CWE-328',
    owasp: 'A02:2021 Cryptographic Failures',
    query: `(call
  function: (attribute
    object: (identifier) @_mod
    attribute: (identifier) @_fn)
  (#match? @_mod "^hashlib$")
  (#match? @_fn "^(md5|sha1)$"))`,
    languages: ['python'],
    captureName: '_fn',
    confidence: 'high',
  },
  {
    id: 'ts-insecure-hash-java',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Hash Algorithm (Java)',
    description: 'MD5/SHA-1 should not be used for security purposes. Use SHA-256 or stronger.',
    suggestion: 'Use MessageDigest.getInstance("SHA-256") instead.',
    cwe: 'CWE-328',
    owasp: 'A02:2021 Cryptographic Failures',
    query: `(method_invocation
  name: (identifier) @_method
  arguments: (argument_list
    (string_literal) @_algo)
  (#match? @_method "^getInstance$")
  (#match? @_algo "^(MD5|SHA-1|SHA1|md5|sha-1|sha1|Md5|Sha1)$"))`,
    languages: ['java'],
    captureName: '_algo',
    confidence: 'high',
  },
  {
    id: 'ts-insecure-hash-go',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Hash Algorithm (Go)',
    description: 'MD5/SHA1 should not be used for security purposes. Use SHA-256 or stronger.',
    suggestion: 'Use crypto/sha256 instead of crypto/md5 or crypto/sha1.',
    cwe: 'CWE-328',
    owasp: 'A02:2021 Cryptographic Failures',
    query: `(call_expression
  function: (selector_expression
    operand: (identifier) @_pkg
    field: (field_identifier) @_fn)
  (#match? @_pkg "^(md5|sha1)$")
  (#match? @_fn "^(New|Sum)$"))`,
    languages: ['go'],
    captureName: '_fn',
    confidence: 'high',
  },

  // --- Path Traversal ---
  {
    id: 'ts-path-traversal-py',
    category: 'security',
    severity: 'warning',
    title: 'Potential Path Traversal (Python)',
    description: 'File open with string concatenation may allow path traversal. Validate and sanitize file paths.',
    suggestion: 'Use os.path.realpath() and verify the resolved path is within the expected directory.',
    cwe: 'CWE-22',
    owasp: 'A01:2021 Broken Access Control',
    query: `(call
  function: (identifier) @_fn
  arguments: (argument_list
    (binary_operator
      operator: "+") @concat)
  (#match? @_fn "^open$"))`,
    languages: ['python'],
    captureName: 'concat',
    confidence: 'medium',
  },
]

// ---------------------------------------------------------------------------
// Quality Rules
// ---------------------------------------------------------------------------

const QUALITY_RULES: TreeSitterRule[] = [
  // --- Empty Catch ---
  {
    id: 'ts-empty-catch-py',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Empty Except Block (Python)',
    description: 'Empty except block with pass silently swallows errors. Log or handle the exception.',
    suggestion: 'At minimum, log the exception: except Exception as e: logger.exception(e)',
    query: `(except_clause
  (block
    (pass_statement) @pass))`,
    languages: ['python'],
    captureName: 'pass',
    confidence: 'high',
  },
  {
    id: 'ts-empty-catch-java',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Empty Catch Block (Java)',
    description: 'Empty catch block silently swallows exceptions. Log or rethrow the exception.',
    suggestion: 'At minimum, log the exception: catch (Exception e) { logger.error("Error", e); }',
    query: `(catch_clause
  body: (block) @body)`,
    languages: ['java'],
    captureName: 'body',
    confidence: 'medium',
  },
  {
    id: 'ts-empty-catch-go',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Ignored Error (Go)',
    description: 'Error value assigned to blank identifier. Handle or propagate the error.',
    suggestion: 'Handle the error: if err != nil { return fmt.Errorf("context: %w", err) }',
    query: `(short_var_declaration
  left: (expression_list
    (identifier) @_blank)
  right: (expression_list
    (call_expression))
  (#eq? @_blank "_"))`,
    languages: ['go'],
    captureName: '_blank',
    confidence: 'medium',
  },

  // --- TODO/FIXME Comments ---
  {
    id: 'ts-todo-comment',
    category: 'reliability',
    severity: 'info',
    title: 'TODO/FIXME Comment',
    description: 'Unresolved TODO or FIXME comment found. Track these as issues.',
    query: `(comment) @comment`,
    languages: ['python', 'java', 'go', 'rust', 'ruby', 'c', 'cpp', 'csharp', 'kotlin', 'swift', 'php'],
    captureName: 'comment',
    confidence: 'high',
  },

  // --- Bare Except (Python) ---
  {
    id: 'ts-bare-except-py',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Bare Except Clause (Python)',
    description: 'Bare except catches all exceptions including SystemExit and KeyboardInterrupt. Catch specific exceptions.',
    suggestion: 'Use except Exception as e: to avoid catching SystemExit/KeyboardInterrupt.',
    query: `(except_clause) @clause`,
    languages: ['python'],
    captureName: 'clause',
    confidence: 'medium',
  },

  // --- Unsafe Deserialization (Python) ---
  {
    id: 'ts-unsafe-deserialize-py',
    category: 'security',
    severity: 'critical',
    title: 'Unsafe Deserialization (Python)',
    description: 'pickle.loads/yaml.load can execute arbitrary code. Use safe alternatives.',
    suggestion: 'Use yaml.safe_load() instead of yaml.load(). Avoid pickle with untrusted data.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    query: `(call
  function: (attribute
    object: (identifier) @_mod
    attribute: (identifier) @_fn)
  (#match? @_mod "^(pickle|yaml)$")
  (#match? @_fn "^(loads?|load)$"))`,
    languages: ['python'],
    captureName: '_fn',
    confidence: 'medium',
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const TREE_SITTER_RULES: TreeSitterRule[] = [
  ...SECURITY_RULES,
  ...QUALITY_RULES,
]

/** Get all Tree-sitter rules for a given language. */
export function getRulesForLanguage(language: string): TreeSitterRule[] {
  return TREE_SITTER_RULES.filter(r => r.languages.includes(language))
}

/** Get all unique languages that have Tree-sitter rules defined. */
export function getLanguagesWithRules(): Set<string> {
  const langs = new Set<string>()
  for (const rule of TREE_SITTER_RULES) {
    for (const lang of rule.languages) {
      langs.add(lang)
    }
  }
  return langs
}
