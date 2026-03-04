// Security scan rules — language-specific patterns for Python, Go, Rust,
// Java/Kotlin, C/C++, Ruby, PHP, and Shell vulnerabilities.

import type { ScanRule } from './types'
import { PY, GO, RUST, JAVA, KOTLIN, C_CPP, RUBY, PHP, SHELL, CSHARP } from './constants'

export const SECURITY_LANG_RULES: ScanRule[] = [

  // ---------------------------------------------------------------------------
  // Python
  // ---------------------------------------------------------------------------

  {
    id: 'python-exec',
    category: 'security',
    severity: 'critical',
    title: 'exec() / eval() in Python',
    description: 'exec() and eval() execute arbitrary Python code. If any part of the input is user-controlled, this is a Remote Code Execution vulnerability.',
    suggestion: 'Use ast.literal_eval() for safe data evaluation, or restructure to avoid dynamic execution',
    cwe: 'CWE-94',
    owasp: 'A03:2021 Injection',
    pattern: '\\b(?:exec|eval)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /literal_eval|#.*exec|#.*eval/,
    confidence: 'high',
  },
  {
    id: 'python-pickle',
    category: 'security',
    severity: 'critical',
    title: 'Insecure Deserialization (pickle)',
    description: 'pickle.loads() can execute arbitrary code during deserialization. Never unpickle data from untrusted sources.',
    suggestion: 'Use JSON or MessagePack for data interchange. If pickle is required, use hmac to verify authenticity.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/502.html',
    pattern: '\\bpickle\\.(?:loads?|Unpickler)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PY,
    confidence: 'high',
  },
  {
    id: 'python-subprocess-shell',
    category: 'security',
    severity: 'critical',
    title: 'subprocess with shell=True',
    description: 'Running subprocess with shell=True passes the command through the system shell, enabling command injection if any argument is user-controlled.',
    suggestion: 'Use subprocess.run(["cmd", "arg1"], shell=False) with a list of arguments',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    pattern: 'subprocess\\.(?:run|call|Popen|check_output|check_call)\\s*\\([^)]*shell\\s*=\\s*True',
    patternOptions: { regex: true },
    fileFilter: PY,
    confidence: 'high',
  },
  {
    id: 'python-assert-security',
    category: 'security',
    severity: 'warning',
    title: 'Assert Used for Security Validation',
    description: 'Assert statements are stripped when Python runs with -O (optimize) flag. Never use assert for security or input validation checks in production.',
    suggestion: 'Use if/raise instead: if not condition: raise ValueError(...)',
    cwe: 'CWE-617',
    pattern: '\\bassert\\b.*(?:password|token|auth|permission|admin|role|user)',
    patternOptions: { regex: true, caseSensitive: false },
    fileFilter: PY,
    confidence: 'low',
  },
  {
    id: 'python-yaml-load',
    category: 'security',
    severity: 'critical',
    title: 'Unsafe YAML Loading',
    description: 'yaml.load() without SafeLoader can execute arbitrary Python code embedded in YAML. This is a deserialization attack vector.',
    suggestion: 'Use yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader)',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    pattern: '\\byaml\\.load\\s*\\([^)]*(?!SafeLoader|safe_load)',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /SafeLoader|safe_load/,
    confidence: 'medium',
  },
  {
    id: 'python-django-debug',
    category: 'security',
    severity: 'warning',
    title: 'Django DEBUG = True',
    description: 'DEBUG mode in Django exposes stack traces, settings, and SQL queries to end users. Must be False in production.',
    suggestion: 'Set DEBUG = False in production settings and use environment variables',
    cwe: 'CWE-215',
    owasp: 'A05:2021 Security Misconfiguration',
    pattern: '\\bDEBUG\\s*=\\s*True\\b',
    patternOptions: { regex: true, caseSensitive: true },
    fileFilter: PY,
    excludePattern: /test|local|dev|#.*DEBUG/i,
    excludeFiles: /test|local_settings|dev_settings/i,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------------------

  {
    id: 'go-http-no-timeout',
    category: 'security',
    severity: 'warning',
    title: 'HTTP Client Without Timeout',
    description: 'http.Get/Post uses http.DefaultClient which has no timeout. Malicious or slow servers can exhaust your goroutines and file descriptors.',
    suggestion: 'Use &http.Client{Timeout: 10 * time.Second} instead of default client functions',
    cwe: 'CWE-400',
    pattern: '\\bhttp\\.(?:Get|Post|Head|PostForm)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: GO,
    confidence: 'low',
  },
  {
    id: 'go-sql-concat',
    category: 'security',
    severity: 'critical',
    title: 'SQL String Concatenation in Go',
    description: 'String formatting or concatenation in SQL query. Go database/sql supports parameterized queries natively.',
    suggestion: 'Use db.Query("SELECT * FROM users WHERE id = $1", userID) with placeholders',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    pattern: '(?:Query|Exec|Prepare)(?:Context)?\\s*\\(\\s*(?:ctx\\s*,\\s*)?(?:fmt\\.Sprintf|.*\\+)',
    patternOptions: { regex: true },
    fileFilter: GO,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Rust
  // ---------------------------------------------------------------------------

  {
    id: 'rust-unsafe',
    category: 'security',
    severity: 'warning',
    title: 'Unsafe Block',
    description: 'Unsafe blocks bypass Rust\'s memory safety guarantees. While sometimes necessary, each unsafe block is a potential source of memory corruption, use-after-free, or data races.',
    suggestion: 'Minimize unsafe scope. Document invariants. Prefer safe abstractions. Consider safe-transmute or zerocopy crates.',
    cwe: 'CWE-119',
    learnMoreUrl: 'https://doc.rust-lang.org/book/ch19-01-unsafe-rust.html',
    pattern: '\\bunsafe\\s*\\{',
    patternOptions: { regex: true },
    fileFilter: RUST,
    excludePattern: /\/\/.*unsafe|#\[allow\(unsafe/,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Java / Kotlin
  // ---------------------------------------------------------------------------

  {
    id: 'java-sql-concat',
    category: 'security',
    severity: 'critical',
    title: 'SQL String Concatenation in Java',
    description: 'Building SQL queries with string concatenation enables SQL injection. Use PreparedStatement with parameterized queries.',
    suggestion: 'Use PreparedStatement: stmt = conn.prepareStatement("SELECT * FROM users WHERE id = ?")',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    pattern: '(?:Statement|createStatement).*(?:execute|Query)\\s*\\(\\s*["\'].*\\+',
    patternOptions: { regex: true },
    fileFilter: [...JAVA, ...KOTLIN],
    confidence: 'medium',
  },
  {
    id: 'java-deserialization',
    category: 'security',
    severity: 'critical',
    title: 'Unsafe Deserialization',
    description: 'ObjectInputStream.readObject() can instantiate arbitrary classes and execute code during deserialization. This is a well-known RCE vector in Java.',
    suggestion: 'Use JSON/Protobuf for data interchange. If Java serialization is required, use a lookup-based filter.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    pattern: '\\bObjectInputStream\\b.*\\breadObject\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: JAVA,
    confidence: 'high',
  },
  {
    id: 'java-runtime-exec',
    category: 'security',
    severity: 'critical',
    title: 'Runtime.exec() Command Execution',
    description: 'Runtime.exec() executes OS commands. If the command string includes user input, this enables command injection.',
    suggestion: 'Use ProcessBuilder with explicit argument arrays. Validate and sanitize all inputs.',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    pattern: 'Runtime\\.getRuntime\\(\\)\\.exec\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: [...JAVA, ...KOTLIN],
    confidence: 'high',
  },

  // ---------------------------------------------------------------------------
  // C/C++
  // ---------------------------------------------------------------------------

  {
    id: 'c-gets',
    category: 'security',
    severity: 'critical',
    title: 'gets() — Buffer Overflow',
    description: 'gets() reads input with no length limit. It is impossible to use safely and has been removed from C11. Always causes buffer overflow vulnerabilities.',
    suggestion: 'Use fgets(buffer, sizeof(buffer), stdin) instead',
    cwe: 'CWE-120',
    owasp: 'A06:2021 Vulnerable and Outdated Components',
    pattern: '\\bgets\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: C_CPP,
    confidence: 'high',
  },
  {
    id: 'c-strcpy',
    category: 'security',
    severity: 'warning',
    title: 'strcpy/strcat — No Bounds Checking',
    description: 'strcpy() and strcat() copy strings without checking destination buffer size. If the source is longer than the destination, memory corruption occurs.',
    suggestion: 'Use strncpy()/strncat() with explicit size, or strlcpy()/strlcat() where available',
    cwe: 'CWE-120',
    pattern: '\\b(?:strcpy|strcat|sprintf|vsprintf)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: C_CPP,
    excludePattern: /strncpy|strncat|snprintf|vsnprintf/,
    confidence: 'medium',
  },
  {
    id: 'c-format-string',
    category: 'security',
    severity: 'critical',
    title: 'Format String Vulnerability',
    description: 'printf() family called with a non-literal format string. If user input reaches the format string, attackers can read memory, crash the program, or gain code execution.',
    suggestion: 'Always use a string literal as format: printf("%s", user_input) instead of printf(user_input)',
    cwe: 'CWE-134',
    pattern: '\\b(?:printf|fprintf|sprintf|snprintf)\\s*\\(\\s*[^"\'\\s,]',
    patternOptions: { regex: true },
    fileFilter: C_CPP,
    excludePattern: /stderr|stdout|^#/,
    confidence: 'high',
  },

  // ---------------------------------------------------------------------------
  // Ruby
  // ---------------------------------------------------------------------------

  {
    id: 'ruby-system-exec',
    category: 'security',
    severity: 'critical',
    title: 'Shell Command Execution',
    description: 'system(), exec(), backticks, and %x{} execute OS commands. If user input is interpolated, this enables command injection.',
    suggestion: 'Use the array form: system("cmd", "arg1", "arg2") to avoid shell interpretation',
    cwe: 'CWE-78',
    owasp: 'A03:2021 Injection',
    pattern: '(?:\\bsystem\\s*\\(|\\bexec\\s*\\(|`[^`]*#\\{|%x\\{)',
    patternOptions: { regex: true },
    fileFilter: RUBY,
    excludePattern: /Kernel\.system.*\[|#.*system/,
    confidence: 'medium',
  },
  {
    id: 'ruby-mass-assignment',
    category: 'security',
    severity: 'warning',
    title: 'Mass Assignment Risk',
    description: 'params.permit! or using params directly without strong parameters allows attackers to set any model attribute, including admin flags.',
    suggestion: 'Always use strong parameters: params.require(:user).permit(:name, :email)',
    cwe: 'CWE-915',
    owasp: 'A01:2021 Broken Access Control',
    pattern: 'params\\.permit!|params\\[:',
    patternOptions: { regex: true },
    fileFilter: RUBY,
    excludePattern: /require\(|permit\(/,
    confidence: 'low',
  },

  // ---------------------------------------------------------------------------
  // PHP
  // ---------------------------------------------------------------------------

  {
    id: 'php-eval',
    category: 'security',
    severity: 'critical',
    title: 'eval() / preg_replace /e',
    description: 'eval() and the /e modifier execute arbitrary PHP code. If user input reaches these, it enables RCE.',
    suggestion: 'Use alternatives: preg_replace_callback() instead of /e. Avoid eval() entirely.',
    cwe: 'CWE-94',
    owasp: 'A03:2021 Injection',
    pattern: '\\b(?:eval|assert)\\s*\\(|preg_replace\\s*\\([^)]+/[a-z]*e[a-z]*["\']',
    patternOptions: { regex: true },
    fileFilter: PHP,
    confidence: 'high',
  },
  {
    id: 'php-sql-injection',
    category: 'security',
    severity: 'critical',
    title: 'SQL Injection in PHP',
    description: 'Variable interpolation in SQL query string. PHP has excellent PDO support with prepared statements.',
    suggestion: 'Use PDO prepared statements: $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?"); $stmt->execute([$id]);',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    pattern: '(?:mysql_query|mysqli_query|\\$\\w+->query)\\s*\\(\\s*["\']\\s*(?:SELECT|INSERT|UPDATE|DELETE).*\\$',
    patternOptions: { regex: true, caseSensitive: false },
    fileFilter: PHP,
    confidence: 'medium',
  },
  {
    id: 'php-include-var',
    category: 'security',
    severity: 'critical',
    title: 'Dynamic File Include',
    description: 'include/require with a variable path enables Local/Remote File Inclusion (LFI/RFI). Attackers can include arbitrary files or URLs.',
    suggestion: 'Use a whitelist of allowed files instead of dynamic paths',
    cwe: 'CWE-98',
    owasp: 'A03:2021 Injection',
    pattern: '(?:include|require|include_once|require_once)\\s*\\(?\\s*\\$',
    patternOptions: { regex: true },
    fileFilter: PHP,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------

  {
    id: 'shell-unquoted-var',
    category: 'security',
    severity: 'warning',
    title: 'Unquoted Shell Variable',
    description: 'Unquoted variables undergo word splitting and glob expansion. If the variable contains spaces or special characters, the command behaves unexpectedly, potentially executing injected commands.',
    suggestion: 'Always double-quote variables: "$variable" instead of $variable',
    cwe: 'CWE-78',
    pattern: '(?:rm|mv|cp|cat|chmod|chown|mkdir)\\s+(?:-[a-zA-Z]+\\s+)*\\$[A-Za-z_]',
    patternOptions: { regex: true },
    fileFilter: SHELL,
    excludePattern: /"\$/,
    confidence: 'low',
  },

  // ---------------------------------------------------------------------------
  // Python — Additional Rules
  // ---------------------------------------------------------------------------

  {
    id: 'python-tempfile-mktemp',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Temporary File (mktemp)',
    description: 'tempfile.mktemp() creates a temporary filename but does not create the file atomically, enabling race condition attacks (TOCTOU). An attacker can create a symlink at the returned path before your code opens it.',
    suggestion: 'Use tempfile.mkstemp() or tempfile.NamedTemporaryFile() which create the file atomically.',
    cwe: 'CWE-377',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/377.html',
    pattern: '\\btempfile\\.mktemp\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PY,
    confidence: 'high',
  },
  {
    id: 'python-ssl-no-verify',
    category: 'security',
    severity: 'warning',
    title: 'SSL/TLS Verification Disabled (Python)',
    description: 'Setting verify=False or using CERT_NONE disables TLS certificate verification, allowing man-in-the-middle attacks on HTTPS connections.',
    suggestion: 'Remove verify=False. Use properly signed certificates. For self-signed certs in development, configure a custom CA bundle.',
    cwe: 'CWE-295',
    owasp: 'A07:2021 Identification and Authentication Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/295.html',
    pattern: '(?:\\bverify\\s*=\\s*False\\b|\\bCERT_NONE\\b)',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /test|spec|mock|fixture|#.*verify/i,
    confidence: 'medium',
  },
  {
    id: 'python-marshal-load',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Deserialization (marshal)',
    description: 'marshal.load()/loads() can execute arbitrary code during deserialization. The marshal module is not intended for untrusted data and provides no security guarantees.',
    suggestion: 'Use JSON or MessagePack for data interchange. marshal is only intended for .pyc files.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/502.html',
    pattern: '\\bmarshal\\.loads?\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PY,
    confidence: 'medium',
  },
  {
    id: 'python-shelve-open',
    category: 'security',
    severity: 'info',
    title: 'shelve.open() Uses pickle Internally',
    description: 'shelve uses pickle internally for serialization. If a shelve database file can be modified by an attacker, it enables arbitrary code execution during deserialization.',
    suggestion: 'Use JSON-based storage for untrusted data. Only use shelve for trusted, locally-controlled data.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/502.html',
    pattern: '\\bshelve\\.open\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PY,
    confidence: 'low',
  },

  // ---------------------------------------------------------------------------
  // PHP — Additional Rules
  // ---------------------------------------------------------------------------

  {
    id: 'php-unserialize',
    category: 'security',
    severity: 'warning',
    title: 'Unsafe Deserialization (PHP unserialize)',
    description: 'PHP unserialize() on untrusted data can trigger __wakeup() and __destruct() magic methods, leading to object injection and potentially remote code execution.',
    suggestion: 'Use json_decode() for data interchange. If unserialize is required, pass allowed_classes: false to restrict instantiation.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/502.html',
    pattern: '\\bunserialize\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: PHP,
    excludePattern: /allowed_classes\s*.*false|test|spec|mock/i,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Ruby — Additional Rules
  // ---------------------------------------------------------------------------

  {
    id: 'ruby-marshal-load',
    category: 'security',
    severity: 'warning',
    title: 'Insecure Deserialization (Marshal)',
    description: 'Marshal.load()/restore() can instantiate arbitrary Ruby objects and execute code during deserialization. Never use Marshal with untrusted data.',
    suggestion: 'Use JSON or MessagePack for data interchange. If Marshal is required, verify data integrity with HMAC first.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/502.html',
    pattern: '\\bMarshal\\.(?:load|restore)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: RUBY,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // .NET / C#
  // ---------------------------------------------------------------------------

  {
    id: 'dotnet-binary-formatter',
    category: 'security',
    severity: 'warning',
    title: 'BinaryFormatter Deserialization (.NET)',
    description: 'BinaryFormatter is inherently insecure and can execute arbitrary code during deserialization. Microsoft has deprecated it and recommends migration to safer alternatives.',
    suggestion: 'Use System.Text.Json or JsonSerializer for data interchange. For binary formats, use MessagePack or Protobuf.',
    cwe: 'CWE-502',
    owasp: 'A08:2021 Software and Data Integrity Failures',
    learnMoreUrl: 'https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide',
    pattern: '\\bBinaryFormatter\\b.*\\b(?:Deserialize|Serialize)\\b',
    patternOptions: { regex: true },
    fileFilter: CSHARP,
    confidence: 'medium',
  },
]
