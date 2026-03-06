// Composite scan rules — file-level rules that detect co-occurring dangerous
// patterns. The danger comes from the combination, not a single line.

import type { CodeIndex } from '../code-index'
import type { CompositeRule, CodeIssue } from './types'
import { JS_TS, PY, SKIP_VENDORED } from './constants'
import { isExampleOrDocsFile, hasInlineSuppression } from './context-classifier'

// ---------------------------------------------------------------------------
// Shared regex constants for command injection composite rules
// ---------------------------------------------------------------------------

const CHILD_PROCESS_IMPORT = /(?:require\s*\(\s*['"]child_process['"]\)|from\s+['"]child_process['"]|from\s+['"]node:child_process['"])/
const CMD_INJECTION_MITIGATIONS = [/execFile|shell-quote|shell-escape|shellescape/]

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
    fileFilter: JS_TS,
    requiredPatterns: [
      CHILD_PROCESS_IMPORT,
      /\bexec(?:Sync)?\s*\(\s*[a-zA-Z_$]/,  // exec called with a variable, not a string literal
    ],
    sinkPattern: /\bexec(?:Sync)?\s*\(\s*[a-zA-Z_$]/,
    mitigations: CMD_INJECTION_MITIGATIONS,
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
    fileFilter: JS_TS,
    requiredPatterns: [
      CHILD_PROCESS_IMPORT,
      /util\.format\s*\(/,
    ],
    sinkPattern: /util\.format\s*\(/,
    mitigations: CMD_INJECTION_MITIGATIONS,
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
    fileFilter: JS_TS,
    requiredPatterns: [
      CHILD_PROCESS_IMPORT,
      /(?:command|cmd)\s*(?:=|\+=)\s*.*\+/,
    ],
    sinkPattern: /(?:command|cmd)\s*(?:=|\+=)\s*.*\+/,
    mitigations: CMD_INJECTION_MITIGATIONS,
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
    fileFilter: JS_TS,
    requiredPatterns: [
      /(?:req\.params|req\.query|req\.body|request\.params|searchParams\.get)/,
      /(?:readFile|writeFile|createReadStream|readdir|unlink|stat|access)(?:Sync)?\s*\(/,
    ],
    sinkPattern: /(?:readFile|writeFile|createReadStream|readdir|unlink|stat|access)(?:Sync)?\s*\(/,
    mitigations: [/path\.resolve.*startsWith|sanitize.*path|whitelist|allowedPaths/],
    sourceBeforeSink: true,
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
    fileFilter: JS_TS,
    requiredPatterns: [
      /(?:req\.params|req\.query|req\.body|request\.params|searchParams\.get)/,
      /(?:fetch\s*\(|axios\.|got\(|http\.request|https\.request|urllib)/,
    ],
    sinkPattern: /(?:fetch\s*\(|axios\.|got\(|http\.request|https\.request)/,
    mitigations: [/allowlist|whitelist|allowedHosts|validUrl|isValidUrl|URL_ALLOWLIST/i],
    maxLineDistance: 50,
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Helmet (CWE-693)
  // -----------------------------------------------------------------------

  // Express app without helmet middleware
  {
    id: 'express-no-helmet',
    category: 'security',
    severity: 'info',
    title: 'Express App — Verify Helmet Middleware',
    description:
      'An Express application was detected. Helmet sets security-related HTTP headers (X-Content-Type-Options, Strict-Transport-Security, etc.). Verify that helmet middleware is registered.',
    suggestion:
      "Install and use helmet: app.use(helmet()). See https://helmetjs.github.io/",
    cwe: 'CWE-693',
    owasp: 'A05:2021 Security Misconfiguration',
    fileFilter: JS_TS,
    requiredPatterns: [
      /express\s*\(\s*\)/,
    ],
    sinkPattern: /express\s*\(\s*\)/,
    mitigations: [/helmet|require\(['"]helmet['"]\)/i],
    confidence: 'low',
  },

  // -----------------------------------------------------------------------
  // CSRF (CWE-352)
  // -----------------------------------------------------------------------
  // Rate Limiting (CWE-770)
  // -----------------------------------------------------------------------

  // Express app with route handlers but no rate limiting
  {
    id: 'express-no-rate-limit',
    category: 'security',
    severity: 'info',
    title: 'Express App — Verify Rate Limiting',
    description:
      'Express application has route handlers but no rate-limiting middleware detected. Without rate limiting, APIs are vulnerable to brute-force attacks and resource exhaustion.',
    suggestion:
      'Add express-rate-limit middleware: app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }))',
    cwe: 'CWE-770',
    owasp: 'A05:2021 Security Misconfiguration',
    fileFilter: JS_TS,
    requiredPatterns: [
      /app\.(?:get|post|put|delete|patch)\s*\(/,
      /express\s*\(\)/,
    ],
    sinkPattern: /app\.(?:get|post|put|delete|patch)\s*\(/,
    mitigations: [/rateLimit|rate-limit|express-rate-limit|throttle|slowDown|express-slow-down|rate_limit/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Next.js API Auth (CWE-306)
  // -----------------------------------------------------------------------

  // Next.js API route without auth check
  {
    id: 'nextjs-api-no-auth',
    category: 'security',
    severity: 'info',
    title: 'Next.js API Route — No Auth Check',
    description:
      'Next.js API route exports handler without authentication checks in the file. Any unauthenticated client can call this endpoint.',
    suggestion:
      'Add an auth check (e.g. getServerSession(), auth(), verifyToken()) at the top of the handler',
    cwe: 'CWE-306',
    owasp: 'A07:2021 Identification and Authentication Failures',
    fileFilter: JS_TS,
    requiredPatterns: [
      /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\(/,
    ],
    sinkPattern: /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\(/,
    mitigations: [/getServerSession|getSession|auth\s*\(|verifyToken|requireAuth|isAuthenticated|cookies\s*\(|headers\s*\(.*authorization|getToken|withAuth|authenticate/i],
    mustNotContain: [/webhook|health|status|ping|public|cron|sitemap|robots|favicon|manifest|opengraph|og-image/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // CSRF (CWE-352)
  // -----------------------------------------------------------------------

  // Express POST/PUT/PATCH/DELETE without CSRF protection
  {
    id: 'composite-csrf-missing-express',
    category: 'security',
    severity: 'warning',
    title: 'CSRF: State-Changing Route Without CSRF Protection',
    description:
      'This file defines Express POST/PUT/PATCH/DELETE route handlers but no CSRF protection middleware (csrf, csurf, csrfProtection) was detected. State-changing endpoints without CSRF tokens allow attackers to forge requests from external sites that execute with the victim\'s authenticated session.',
    suggestion:
      'Add CSRF middleware: npm install csurf, then app.use(csrf({ cookie: true })) before route handlers. Include the token in forms or as a request header.',
    cwe: 'CWE-352',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/352.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /app\.(post|put|patch|delete)\s*\(/,
    ],
    sinkPattern: /app\.(post|put|patch|delete)\s*\(/,
    mitigations: [/csrf|csurf|_csrf|csrfProtection/i],
    mustNotContain: [/csrf|csurf|lusca/i],
    confidence: 'medium',
  },
  // Django class-based view without CSRF protection
  {
    id: 'composite-csrf-missing-django-view',
    category: 'security',
    severity: 'warning',
    title: 'CSRF: Django View Without CSRF Protection',
    description:
      'This file defines Django class-based view methods (post/put/patch/delete) without CSRF protection. If CsrfViewMiddleware is disabled or @csrf_exempt is used, state-changing requests can be forged.',
    suggestion:
      'Ensure django.middleware.csrf.CsrfViewMiddleware is in MIDDLEWARE settings. Use @csrf_protect decorator if middleware is selectively disabled.',
    cwe: 'CWE-352',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/352.html',
    fileFilter: PY,
    requiredPatterns: [
      /def\s+(post|put|patch|delete)\s*\(self/,
    ],
    sinkPattern: /def\s+(post|put|patch|delete)\s*\(self/,
    mitigations: [/csrf|CsrfViewMiddleware|@csrf_protect/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Missing Authentication (CWE-862)
  // -----------------------------------------------------------------------

  // Express routes without auth middleware
  {
    id: 'composite-missing-auth-express-route',
    category: 'security',
    severity: 'warning',
    title: 'Missing Authentication: Express Route Without Auth Middleware',
    description:
      'This file defines Express route handlers using router.get/post/put/delete but no authentication middleware (auth, passport, jwt.verify, requireAuth) was detected. Routes without authentication allow unauthenticated access to potentially sensitive functionality.',
    suggestion:
      'Add authentication middleware to routes: router.get("/resource", requireAuth, handler). Use passport.authenticate(), jwt.verify(), or a custom isAuthenticated middleware.',
    cwe: 'CWE-862',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/862.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /router\.(get|post|put|delete)\s*\(/,
    ],
    sinkPattern: /router\.(get|post|put|delete)\s*\(/,
    mitigations: [/auth|authenticate|isAuthenticated|passport|requireAuth|ensureAuth|isLoggedIn|verifyToken|jwt\.verify|requireLogin/i],
    mustNotContain: [/isAuthenticated|requireAuth|passport\.authenticate|jwt\.verify/i],
    confidence: 'low',
  },

  // -----------------------------------------------------------------------
  // File Upload (CWE-434)
  // -----------------------------------------------------------------------

  // Upload handling without type/size validation
  {
    id: 'composite-file-upload-no-validation',
    category: 'security',
    severity: 'warning',
    title: 'File Upload: No Type or Size Validation',
    description:
      'This file handles file uploads (multer, formidable, busboy) but no file type, extension, or size validation was detected. Without validation, attackers can upload executable files, oversized files to cause DoS, or files with dangerous content types.',
    suggestion:
      'Add file validation: check mimetype against an allowlist, validate file extensions, enforce size limits. Example with multer: multer({ limits: { fileSize: 5_000_000 }, fileFilter: validateFile })',
    cwe: 'CWE-434',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/434.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /multer|formidable|busboy/,
    ],
    sinkPattern: /multer|formidable|busboy/,
    mitigations: [/\.(mimetype|ext|extension|size|limit|fileFilter|allowedTypes|validat|accept)|limits\s*:|ALLOWED_TYPES|allowedMimeTypes|contentType\s*===/i],
    mustNotContain: [/fileFilter|maxFileSize|accept|validateFile/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Mass Assignment (CWE-915)
  // -----------------------------------------------------------------------

  // ORM create/update with raw req.body
  {
    id: 'composite-mass-assignment-orm',
    category: 'security',
    severity: 'warning',
    title: 'Mass Assignment: ORM Operation with Raw Request Body',
    description:
      'This file passes req.body or req.query directly into an ORM create/update operation. Attackers can inject extra fields (e.g. isAdmin: true, role: "admin") that get persisted to the database, escalating privileges or corrupting data.',
    suggestion:
      'Whitelist allowed fields explicitly: const { name, email } = req.body; Model.create({ name, email }). Use lodash.pick() or a validation schema (Zod, Joi) to filter input.',
    cwe: 'CWE-915',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/915.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /\.(create|update|findOneAndUpdate|updateOne|insertOne)\s*\(.*req\.(body|query)/,
    ],
    sinkPattern: /\.(create|update|findOneAndUpdate|updateOne|insertOne)\s*\(/,
    mitigations: [/\.(select|pick|omit|whitelist|allowedFields|sanitize)/i],
    mustNotContain: [/\.pick\(|\.omit\(|allowedFields|sanitizeBody/i],
    confidence: 'medium',
  },
  // Sequelize-specific mass assignment
  {
    id: 'composite-mass-assignment-sequelize',
    category: 'security',
    severity: 'warning',
    title: 'Mass Assignment: Sequelize Operation with Raw Request Body',
    description:
      'This file passes req.body directly into a Sequelize create/update/bulkCreate operation. Without specifying allowed fields, attackers can inject extra columns into the database.',
    suggestion:
      'Use the "fields" or "attributes" option to whitelist columns: Model.create(req.body, { fields: ["name", "email"] })',
    cwe: 'CWE-915',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/915.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /\.(create|update|bulkCreate)\s*\(.*req\.body/,
    ],
    sinkPattern: /\.(create|update|bulkCreate)\s*\(/,
    mitigations: [/fields\s*:|attributes\s*:/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // IDOR (CWE-639)
  // -----------------------------------------------------------------------

  // Direct object lookup from request params without ownership check
  {
    id: 'composite-idor-direct-lookup',
    category: 'security',
    severity: 'warning',
    title: 'IDOR: Direct Object Lookup from Request Parameters',
    description:
      'This file uses req.params or req.query values directly in database lookups (findById, findByPk, findOne) without verifying the requesting user owns or has access to the resource. Attackers can enumerate IDs to access other users\' data.',
    suggestion:
      'Add an ownership or permission check: const item = await Model.findById(id); if (item.userId !== req.user.id) return res.status(403).json({ error: "Forbidden" })',
    cwe: 'CWE-639',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/639.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /\.(findById|findByPk|findOne)\s*\(.*req\.(params|query)/,
    ],
    sinkPattern: /\.(findById|findByPk|findOne)\s*\(/,
    mitigations: [/authorize|checkPermission|checkOwner|belongsTo|isOwner|canAccess|req\.user/i],
    confidence: 'low',
  },

  // -----------------------------------------------------------------------
  // Race Condition TOCTOU (CWE-367)
  // -----------------------------------------------------------------------

  // Sync file existence check followed by sync file operation
  {
    id: 'composite-toctou-file-check',
    category: 'security',
    severity: 'info',
    title: 'Race Condition: TOCTOU File Check (Sync)',
    description:
      'This file uses synchronous file existence checks (existsSync, accessSync, statSync) AND synchronous file operations (readFileSync, writeFileSync, etc.). Between the check and the use, another process can modify the file system, leading to a time-of-check to time-of-use (TOCTOU) race condition.',
    suggestion:
      'Use a try/catch around the file operation directly instead of checking first. Alternatively, use file locking (proper-lockfile, lockfile) for critical sections.',
    cwe: 'CWE-367',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/367.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /(existsSync|accessSync|statSync)\s*\(/,
      /(readFileSync|writeFileSync|unlinkSync|renameSync)\s*\(/,
    ],
    sinkPattern: /(readFileSync|writeFileSync|unlinkSync|renameSync)\s*\(/,
    mitigations: [/lock|mutex|semaphore|flock/i],
    sourceBeforeSink: true,
    confidence: 'medium',
  },
  // Async file existence check followed by async file operation
  {
    id: 'composite-toctou-async-file',
    category: 'security',
    severity: 'info',
    title: 'Race Condition: TOCTOU File Check (Async)',
    description:
      'This file uses asynchronous file existence checks (exists, access, stat) AND asynchronous file operations (readFile, writeFile, etc.). The async gap between check and use is even more susceptible to TOCTOU race conditions than synchronous operations.',
    suggestion:
      'Perform the file operation directly inside a try/catch instead of checking existence first. Use file locking for concurrent access scenarios.',
    cwe: 'CWE-367',
    owasp: 'A04:2021 Insecure Design',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/367.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /\b(exists|access|stat)\s*\(/,
      /\b(readFile|writeFile|unlink|rename)\s*\(/,
    ],
    sinkPattern: /\b(readFile|writeFile|unlink|rename)\s*\(/,
    mitigations: [/lock|mutex|semaphore/i],
    sourceBeforeSink: true,
    confidence: 'low',
  },

  // -----------------------------------------------------------------------
  // WebSocket (CWE-1385)
  // -----------------------------------------------------------------------

  // WebSocket server without authentication
  {
    id: 'composite-websocket-no-auth',
    category: 'security',
    severity: 'warning',
    title: 'WebSocket: No Authentication Detected',
    description:
      'This file creates a WebSocket server but no authentication mechanism (verifyClient, token validation, JWT) was detected. Without authentication, any client can connect and interact with the WebSocket, potentially accessing sensitive real-time data or triggering server-side actions.',
    suggestion:
      'Implement verifyClient callback for ws, or validate a token/session in the connection handler: wss.on("connection", (ws, req) => { if (!authenticate(req)) ws.close() })',
    cwe: 'CWE-1385',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/1385.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /new\s+WebSocket|WebSocketServer|ws\s*\(/,
    ],
    sinkPattern: /new\s+WebSocket|WebSocketServer|ws\s*\(/,
    mitigations: [/verifyClient|authenticate|authorization|token|jwt/i],
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Unvalidated Redirect (CWE-601)
  // -----------------------------------------------------------------------

  // Redirect using user-controlled input
  {
    id: 'composite-open-redirect-response',
    category: 'security',
    severity: 'warning',
    title: 'Unvalidated Redirect: User Input in Redirect URL',
    description:
      'This file uses res.redirect() AND reads from request input (req.query, req.params, req.body). If the redirect URL is constructed from user input without validation, attackers can redirect users to malicious sites for phishing.',
    suggestion:
      'Validate redirect URLs against a whitelist of allowed destinations. Use relative URLs or verify the hostname: const url = new URL(target, baseUrl); if (!allowedHosts.includes(url.hostname)) reject.',
    cwe: 'CWE-601',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/601.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /res\.redirect\s*\(/,
      /req\.(query|params|body)/,
    ],
    sinkPattern: /res\.redirect\s*\(/,
    mitigations: [/whitelist|allowedUrl|validUrl|startsWith.*https|url\.parse|new URL/i],
    maxLineDistance: 15,
    confidence: 'medium',
  },

  // -----------------------------------------------------------------------
  // Missing Error Handling (CWE-390)
  // -----------------------------------------------------------------------

  // Async functions without try-catch or .catch()
  {
    id: 'composite-async-no-try-catch',
    category: 'reliability',
    severity: 'info',
    title: 'Missing Error Handling: Async Function Without Try-Catch',
    description:
      'This file contains async functions but no try-catch blocks or .catch() handlers were detected. Unhandled promise rejections in async functions can crash the process (Node.js) or cause silent failures.',
    suggestion:
      'Wrap async function bodies in try/catch, or attach .catch() handlers to promise chains. Use a global error handler as a safety net: process.on("unhandledRejection", handler)',
    cwe: 'CWE-390',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/390.html',
    fileFilter: JS_TS,
    requiredPatterns: [
      /async\s+function|async\s*\(/,
    ],
    sinkPattern: /async\s+function|async\s*\(/,
    mitigations: [/try\s*\{|\.catch\s*\(|catchError|errorHandler|createErrorHandler/i],
    confidence: 'low',
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

      // Use pre-computed file content
      const content = file.content

      // Check ALL required patterns are present
      const allPresent = rule.requiredPatterns.every(p => p.test(content))
      if (!allPresent) continue

      // mustNotContain — if ANY of these patterns match, suppress the rule entirely
      if (rule.mustNotContain && rule.mustNotContain.some(p => p.test(content))) continue

      // Check mitigations — if ANY mitigation is present, skip
      // Track partial mitigation for credit
      let hasPartialMitigation = false
      if (rule.mitigations && rule.mitigations.length > 0) {
        const mitigationMatches = rule.mitigations.filter(m => m.test(content))
        if (mitigationMatches.length === rule.mitigations.length) continue // all mitigations present → skip
        if (mitigationMatches.length > 0) hasPartialMitigation = true
      }

      // sourceBeforeSink — requiredPatterns[0] must appear on an earlier line than requiredPatterns[1]
      if (rule.sourceBeforeSink && rule.requiredPatterns.length >= 2) {
        let sourceLine = -1
        let sinkMatchLine = -1
        for (let i = 0; i < file.lines.length; i++) {
          if (sourceLine === -1 && rule.requiredPatterns[0].test(file.lines[i])) {
            sourceLine = i
          }
          if (sinkMatchLine === -1 && rule.requiredPatterns[1].test(file.lines[i])) {
            sinkMatchLine = i
          }
          if (sourceLine !== -1 && sinkMatchLine !== -1) break
        }
        if (sourceLine === -1 || sinkMatchLine === -1 || sourceLine >= sinkMatchLine) continue
      }

      // maxLineDistance — max distance between any requiredPattern first-matches
      if (rule.maxLineDistance !== undefined) {
        const matchLines: number[] = []
        for (const pattern of rule.requiredPatterns) {
          for (let i = 0; i < file.lines.length; i++) {
            if (pattern.test(file.lines[i])) {
              matchLines.push(i)
              break
            }
          }
        }
        if (matchLines.length >= 2) {
          const maxDist = Math.max(...matchLines) - Math.min(...matchLines)
          if (maxDist > rule.maxLineDistance) continue
        }
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

      // --- Context-aware suppression for composite rules ---
      // Test/example file: skip non-security composite findings
      const isTestFile = /\.test\.|\.spec\.|__tests__[\/\\]/i.test(path)
      const isExampleFile = isExampleOrDocsFile(path)
      if ((isTestFile || isExampleFile) && rule.category !== 'security') continue

      // Inline suppression: check first required pattern's match line
      let firstPatternMatchLine = -1
      for (let i = 0; i < file.lines.length; i++) {
        if (rule.requiredPatterns[0].test(file.lines[i])) {
          firstPatternMatchLine = i
          break
        }
      }
      if (firstPatternMatchLine >= 0) {
        const matchLineContent = file.lines[firstPatternMatchLine]
        const prevLineContent = firstPatternMatchLine > 0 ? file.lines[firstPatternMatchLine - 1] : undefined
        if (hasInlineSuppression(matchLineContent, prevLineContent, rule.id)) continue
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
