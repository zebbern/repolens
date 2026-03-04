// Framework-specific security scan rules — patterns for Next.js, Express.js,
// Django, Flask, and Spring/Java framework misconfigurations.

import type { ScanRule } from './types'
import { JS_TS, PY, JAVA, KOTLIN } from './constants'

export const FRAMEWORK_RULES: ScanRule[] = [

  // ---------------------------------------------------------------------------
  // Next.js / React
  // ---------------------------------------------------------------------------

  {
    id: 'nextjs-public-env-secret',
    category: 'security',
    severity: 'critical',
    title: 'Secret Exposed via NEXT_PUBLIC_ Env Var',
    description:
      'Environment variables prefixed with NEXT_PUBLIC_ are bundled into the client-side JavaScript and visible to every user. Secrets, API keys, and tokens must never use this prefix.',
    suggestion:
      'Remove the NEXT_PUBLIC_ prefix and access the variable only in server-side code (API routes, getServerSideProps, Server Components)',
    cwe: 'CWE-200',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/200.html',
    pattern:
      'NEXT_PUBLIC_(?:SECRET|PASSWORD|API_KEY|API_SECRET|PRIVATE|TOKEN|AUTH)',
    patternOptions: { regex: true, caseSensitive: true },
    fileFilter: JS_TS,
    confidence: 'high',
  },
  {
    id: 'nextjs-server-action-no-auth',
    category: 'security',
    severity: 'info',
    title: 'Server Action Without Visible Auth Check',
    description:
      '"use server" marks a module as a Next.js Server Action entry-point. Server Actions are publicly callable — each exported async function must validate authentication and authorization before performing mutations.',
    suggestion:
      'Add an auth check (e.g. getSession(), auth()) at the top of every exported server action function',
    cwe: 'CWE-862',
    owasp: 'A01:2021 Broken Access Control',
    pattern: '[\'"]use server[\'"]',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    confidence: 'low',
  },
  {
    id: 'nextjs-dangerous-html-prop',
    category: 'security',
    severity: 'warning',
    title: 'dangerouslySetInnerHTML with Dynamic Content',
    description:
      'dangerouslySetInnerHTML injects raw HTML into the DOM. When the __html value comes from a variable rather than a static string, it creates a Cross-Site Scripting (XSS) vector if the value includes unsanitized user input.',
    suggestion:
      'Sanitize with DOMPurify.sanitize() before injection, or use a Markdown renderer that escapes HTML',
    cwe: 'CWE-79',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/79.html',
    pattern: 'dangerouslySetInnerHTML\\s*=\\s*\\{\\s*\\{\\s*__html\\s*:\\s*(?![\'"])',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    excludePattern: /DOMPurify|sanitize|purify|escape|xss/i,
    confidence: 'medium',
  },
  {
    id: 'nextjs-redirect-input',
    category: 'security',
    severity: 'warning',
    title: 'Next.js Redirect with User Input',
    description:
      'redirect() called with a value derived from request parameters (req, params, searchParams, query). An attacker can craft a URL that redirects victims to a phishing site.',
    suggestion:
      'Validate the redirect target against a whitelist of allowed paths, or use a relative path only',
    cwe: 'CWE-601',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/601.html',
    pattern: 'redirect\\s*\\(\\s*(?:req\\.|params\\.|searchParams|query)',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Express.js
  // ---------------------------------------------------------------------------

  // NOTE: Detecting the *absence* of helmet or rate-limit middleware reliably
  // requires composite / structural analysis (cross-file). These rules flag
  // the express app creation as an informational reminder.

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
    pattern: 'express\\s*\\(\\s*\\)',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    // Suppress when helmet is imported/required in the same file
    excludePattern: /helmet|require\(['"]helmet['"]\)/i,
    confidence: 'low',
  },
  {
    id: 'express-no-rate-limit',
    category: 'security',
    severity: 'info',
    title: 'Express App — Verify Rate Limiting',
    description:
      'Express route handlers detected without visible rate limiting. Without rate limiting, APIs are vulnerable to brute-force attacks and resource exhaustion.',
    suggestion:
      'Add express-rate-limit middleware: app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }))',
    cwe: 'CWE-770',
    owasp: 'A05:2021 Security Misconfiguration',
    pattern: 'app\\.(?:get|post|put|delete|patch|use)\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    excludePattern: /rateLimit|rate-limit|express-rate-limit|throttle/i,
    confidence: 'low',
  },
  {
    id: 'express-cookie-not-signed',
    category: 'security',
    severity: 'info',
    title: 'Express Cookie Without Signed Option',
    description:
      'res.cookie() called without the signed option. Unsigned cookies can be tampered with by the client. For cookies that carry security-relevant data, enable signing.',
    suggestion:
      'Set signed: true and configure cookieParser with a secret: app.use(cookieParser("secret"))',
    cwe: 'CWE-565',
    owasp: 'A02:2021 Cryptographic Failures',
    pattern: 'res\\.cookie\\s*\\(',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    excludePattern: /signed\s*:\s*true|httpOnly\s*:\s*true/,
    confidence: 'low',
  },
  {
    id: 'express-session-fixation',
    category: 'security',
    severity: 'warning',
    title: 'Express Session — Potential Session Fixation',
    description:
      'express-session detected. If the session ID is not regenerated after login, attackers can fixate a known session ID and hijack authenticated sessions.',
    suggestion:
      'Call req.session.regenerate() after successful authentication, and set resave: false, saveUninitialized: false',
    cwe: 'CWE-384',
    owasp: 'A07:2021 Identification and Authentication Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/384.html',
    pattern: 'express-session|express\\.session',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    excludePattern: /resave\s*:\s*false/,
    confidence: 'medium',
  },
  {
    id: 'express-trust-proxy',
    category: 'security',
    severity: 'info',
    title: 'Express trust proxy Set Broadly',
    description:
      'Setting trust proxy to true trusts ALL proxies, meaning any client can spoof X-Forwarded-* headers. This affects rate limiting, IP logging, and HTTPS detection.',
    suggestion:
      "Set a specific proxy count or IP: app.set('trust proxy', 1) or app.set('trust proxy', 'loopback')",
    cwe: 'CWE-290',
    owasp: 'A05:2021 Security Misconfiguration',
    pattern: 'trust\\s*proxy[\'"]\\s*,\\s*true\\b',
    patternOptions: { regex: true },
    fileFilter: JS_TS,
    confidence: 'low',
  },

  // ---------------------------------------------------------------------------
  // Django
  // ---------------------------------------------------------------------------

  // NOTE: django-debug (DEBUG = True) is already covered by the
  // `python-django-debug` rule in rules-security-lang.ts — not duplicated here.

  {
    id: 'django-csrf-exempt',
    category: 'security',
    severity: 'warning',
    title: 'Django @csrf_exempt Decorator',
    description:
      'The @csrf_exempt decorator disables CSRF protection for a view. This allows cross-site request forgery attacks where a malicious site can submit forms on behalf of authenticated users.',
    suggestion:
      'Remove @csrf_exempt. For APIs, use Django REST Framework token/session auth which handles CSRF correctly.',
    cwe: 'CWE-352',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/352.html',
    pattern: '@csrf_exempt',
    patternOptions: { regex: false },
    fileFilter: PY,
    confidence: 'high',
  },
  {
    id: 'django-mark-safe',
    category: 'security',
    severity: 'critical',
    title: 'Django mark_safe() with Dynamic Content',
    description:
      'mark_safe() tells Django to skip HTML escaping. When called with dynamic content (f-strings, request data, str()), any user input inside is injected as raw HTML, enabling XSS.',
    suggestion:
      'Use format_html() instead, which escapes arguments: format_html("<p>{}</p>", user_input)',
    cwe: 'CWE-79',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/79.html',
    pattern: 'mark_safe\\s*\\(\\s*(?:f[\'"]|request\\.|self\\.|str\\()',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /format_html/,
    confidence: 'medium',
  },
  {
    id: 'django-raw-sql',
    category: 'security',
    severity: 'critical',
    title: 'Django Raw SQL with String Interpolation',
    description:
      'Using .raw(), .extra(), or cursor().execute() with string formatting (f-strings, % formatting) bypasses Django ORM\'s parameterized queries and enables SQL injection.',
    suggestion:
      'Use parameterized queries: Model.objects.raw("SELECT * FROM t WHERE id = %s", [user_id])',
    cwe: 'CWE-89',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/89.html',
    pattern: '\\.raw\\s*\\(\\s*(?:f[\'"]|[\'"].*%s|request\\.)',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /params\s*=|%s.*,\s*\[/,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Flask
  // ---------------------------------------------------------------------------

  {
    id: 'flask-debug-mode',
    category: 'security',
    severity: 'warning',
    title: 'Flask Debug Mode Enabled',
    description:
      'app.run(debug=True) starts the Werkzeug debugger, which provides an interactive Python shell accessible to anyone who can trigger an exception. In production this is a Remote Code Execution vulnerability.',
    suggestion:
      'Remove debug=True from app.run(). Use FLASK_DEBUG=1 only in development, never in production.',
    cwe: 'CWE-489',
    owasp: 'A05:2021 Security Misconfiguration',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/489.html',
    pattern: 'app\\.run\\s*\\([^)]*debug\\s*=\\s*True',
    patternOptions: { regex: true },
    fileFilter: PY,
    excludePattern: /test|#.*debug/i,
    confidence: 'high',
  },
  {
    id: 'flask-secret-key-hardcoded',
    category: 'security',
    severity: 'critical',
    title: 'Hardcoded Flask Secret Key',
    description:
      'Flask SECRET_KEY is hardcoded as a string literal. This key signs session cookies — if it leaks (e.g. via source control), attackers can forge session tokens and impersonate any user.',
    suggestion:
      'Load from environment: app.secret_key = os.environ["SECRET_KEY"]',
    cwe: 'CWE-798',
    owasp: 'A07:2021 Identification and Authentication Failures',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/798.html',
    pattern: '(?:SECRET_KEY|secret_key)\\s*=\\s*[\'"][^\'"]{4,}[\'"]',
    patternOptions: { regex: true, caseSensitive: true },
    fileFilter: PY,
    excludePattern: /os\.environ|os\.getenv|config\[|\.get\(|environ|env\b/i,
    confidence: 'medium',
  },

  // ---------------------------------------------------------------------------
  // Spring / Java
  // ---------------------------------------------------------------------------

  {
    id: 'spring-csrf-disabled',
    category: 'security',
    severity: 'warning',
    title: 'Spring Security CSRF Disabled',
    description:
      'CSRF protection is explicitly disabled in the Spring Security configuration. This allows cross-site request forgery attacks on state-changing endpoints. Only disable CSRF for stateless APIs using token authentication (JWT, OAuth2).',
    suggestion:
      'Remove .csrf().disable() for session-based apps. For stateless APIs, document why CSRF is disabled.',
    cwe: 'CWE-352',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/352.html',
    pattern:
      'csrf\\s*\\(\\s*\\)\\s*\\.disable\\s*\\(\\s*\\)|\\.csrf\\(\\)\\.disable\\(\\)',
    patternOptions: { regex: true },
    fileFilter: [...JAVA, ...KOTLIN],
    confidence: 'high',
  },
  {
    id: 'spring-missing-valid',
    category: 'security',
    severity: 'info',
    title: 'Spring @RequestBody Without @Valid',
    description:
      '@RequestBody deserializes client input into an object, but without @Valid/@Validated, Bean Validation constraints (e.g. @NotNull, @Size) are not enforced. Malformed or malicious payloads pass through unchecked.',
    suggestion:
      'Add @Valid before the parameter: public ResponseEntity<?> create(@Valid @RequestBody UserDto dto)',
    cwe: 'CWE-20',
    owasp: 'A03:2021 Injection',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/20.html',
    pattern:
      '@(?:Post|Put|Patch)Mapping[^)]*\\)\\s*(?:public\\s+)?\\w+\\s+\\w+\\s*\\([^)]*@RequestBody\\s+(?!@Valid|@Validated)',
    patternOptions: { regex: true },
    fileFilter: [...JAVA, ...KOTLIN],
    confidence: 'medium',
  },
  {
    id: 'spring-permit-all',
    category: 'security',
    severity: 'warning',
    title: 'Spring Security Overly Permissive Authorization',
    description:
      'authorizeRequests().anyRequest().permitAll() or antMatchers("/**").permitAll() disables authentication for all endpoints. This may unintentionally expose admin or internal endpoints.',
    suggestion:
      'Use permitAll() only on specific public paths (login, health). Require authentication by default: .anyRequest().authenticated()',
    cwe: 'CWE-862',
    owasp: 'A01:2021 Broken Access Control',
    learnMoreUrl: 'https://cwe.mitre.org/data/definitions/862.html',
    pattern:
      '\\.authorizeRequests\\(\\)\\s*\\.anyRequest\\(\\)\\s*\\.permitAll\\(\\)|antMatchers\\s*\\(\\s*["\']/?\\*\\*["\']\\s*\\)\\s*\\.permitAll',
    patternOptions: { regex: true },
    fileFilter: [...JAVA, ...KOTLIN],
    confidence: 'medium',
  },
]
