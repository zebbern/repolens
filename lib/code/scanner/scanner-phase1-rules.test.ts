/**
 * Phase 1 rule test suite — 51 new rules (34 security + 17 framework).
 * Pattern: createEmptyIndex() → indexFile() → scanIssues() → assert ruleId.
 */
import { describe, it, expect } from 'vitest'
import { scanIssues } from '@/lib/code/scanner/scanner'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'

function scanCode(filename: string, code: string, lang?: string) {
  let index = createEmptyIndex()
  index = indexFile(index, filename, code, lang)
  return scanIssues(index, null)
}
function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ── Phase 1A — Security Rules (34 rules) ──────────────────────────────────

describe('LLM / SaaS API Keys', () => {
  it('detects OpenAI key (sk-…)', () => {
    const r = scanCode('src/config.ts', 'const key = "sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ001122"')
    expect(issuesForRule(r.issues, 'llm-openai-key').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sk- key from process.env', () => {
    const r = scanCode('src/config.ts', 'const key = process.env.OPENAI_API_KEY')
    expect(issuesForRule(r.issues, 'llm-openai-key')).toHaveLength(0)
  })
  it('detects Anthropic key (sk-ant-…)', () => {
    const r = scanCode('src/config.ts', 'const key = "sk-ant-aBcDeFgHiJkLmNoPqRs123456"')
    expect(issuesForRule(r.issues, 'llm-anthropic-key').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sk-ant- from env var', () => {
    const r = scanCode('src/config.ts', 'const key = process.env.ANTHROPIC_API_KEY')
    expect(issuesForRule(r.issues, 'llm-anthropic-key')).toHaveLength(0)
  })
  it('detects Google AI key (AIzaSy…)', () => {
    const r = scanCode('src/config.ts', 'const key = "AIzaSyBCdEfGhIjKlMnOpQrStUvwXyZ01234567"')
    expect(issuesForRule(r.issues, 'llm-google-ai-key').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: AIzaSy from env var', () => {
    const r = scanCode('src/config.ts', 'const key = process.env.GOOGLE_AI_KEY')
    expect(issuesForRule(r.issues, 'llm-google-ai-key')).toHaveLength(0)
  })
  it('detects Slack bot token (xoxb-…)', () => {
    const r = scanCode('src/config.ts', 'const token = "xoxb-123456789012-abcDefGhiJk"')
    expect(issuesForRule(r.issues, 'slack-token').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: xoxb- from env var', () => {
    const r = scanCode('src/config.ts', 'const token = process.env.SLACK_TOKEN')
    expect(issuesForRule(r.issues, 'slack-token')).toHaveLength(0)
  })
  it('detects Stripe live key (sk_live_…)', () => {
    const r = scanCode('src/config.ts', 'const key = "sk_live_aBcDeFgHiJkLmNoPqRsT0"')
    expect(issuesForRule(r.issues, 'stripe-key').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sk_test_ does not match stripe-key', () => {
    const r = scanCode('src/config.ts', 'const key = "sk_test_aBcDeFgHiJkLmNoPqRsT0"')
    expect(issuesForRule(r.issues, 'stripe-key')).toHaveLength(0)
  })
})

describe('Prototype Pollution', () => {
  it('detects Object.assign with user input', () => {
    const r = scanCode('src/handler.ts', 'Object.assign(req.body, defaults)')
    expect(issuesForRule(r.issues, 'prototype-pollution-assign').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: Object.assign with safe source', () => {
    const r = scanCode('src/handler.ts', 'Object.assign({}, defaults, config)')
    expect(issuesForRule(r.issues, 'prototype-pollution-assign')).toHaveLength(0)
  })
  it('detects _.merge deep merge', () => {
    const r = scanCode('src/handler.ts', '_.merge(target, userInput)')
    expect(issuesForRule(r.issues, 'prototype-pollution-merge').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: safeMerge excluded', () => {
    const r = scanCode('src/handler.ts', 'safeMerge(target, userInput)')
    expect(issuesForRule(r.issues, 'prototype-pollution-merge')).toHaveLength(0)
  })
  it('detects __proto__ assignment', () => {
    const r = scanCode('src/handler.ts', 'obj.__proto__ = malicious')
    expect(issuesForRule(r.issues, 'prototype-pollution-proto').length).toBeGreaterThanOrEqual(1)
  })
  it('detects bracket __proto__ access', () => {
    const r = scanCode('src/handler.ts', "obj['__proto__'] = val")
    expect(issuesForRule(r.issues, 'prototype-pollution-proto').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: __proto__ with hasOwnProperty guard', () => {
    const r = scanCode('src/handler.ts', 'if (obj.hasOwnProperty("__proto__")) delete obj.__proto__')
    expect(issuesForRule(r.issues, 'prototype-pollution-proto')).toHaveLength(0)
  })
})

describe('JWT Vulnerabilities', () => {
  it('detects algorithms: "none"', () => {
    const r = scanCode('src/auth.ts', "const opts = { algorithms: ['none'] }")
    expect(issuesForRule(r.issues, 'jwt-algo-none').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: algorithms with safe value', () => {
    const r = scanCode('src/auth.ts', "const opts = { algorithms: ['RS256'] }")
    expect(issuesForRule(r.issues, 'jwt-algo-none')).toHaveLength(0)
  })
  it('detects jwt.sign with short secret', () => {
    const r = scanCode('src/auth.ts', "jwt.sign(payload, 'short')")
    expect(issuesForRule(r.issues, 'jwt-weak-secret').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: jwt.sign with env var', () => {
    const r = scanCode('src/auth.ts', 'jwt.sign(payload, process.env.JWT_SECRET)')
    expect(issuesForRule(r.issues, 'jwt-weak-secret')).toHaveLength(0)
  })
  it('detects jwt.verify without algorithms', () => {
    const r = scanCode('src/auth.ts', 'jwt.verify(token, secret)')
    expect(issuesForRule(r.issues, 'jwt-missing-algorithms').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: jwt.verify with algorithms', () => {
    const r = scanCode('src/auth.ts', "jwt.verify(token, secret, { algorithms: ['RS256'] })")
    expect(issuesForRule(r.issues, 'jwt-missing-algorithms')).toHaveLength(0)
  })
})

describe('Cookie Security', () => {
  it('detects httpOnly: false', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { httpOnly: false })')
    expect(issuesForRule(r.issues, 'cookie-no-httponly').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: httpOnly: true', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { httpOnly: true })')
    expect(issuesForRule(r.issues, 'cookie-no-httponly')).toHaveLength(0)
  })
  it('detects secure: false', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { secure: false })')
    expect(issuesForRule(r.issues, 'cookie-no-secure').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: secure: false with localhost', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { secure: false }) // localhost')
    expect(issuesForRule(r.issues, 'cookie-no-secure')).toHaveLength(0)
  })
  it('detects res.cookie without sameSite', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { httpOnly: true })')
    expect(issuesForRule(r.issues, 'cookie-no-samesite').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: res.cookie with sameSite', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("s", v, { sameSite: "strict" })')
    expect(issuesForRule(r.issues, 'cookie-no-samesite')).toHaveLength(0)
  })
})

describe('Information Exposure', () => {
  it('detects stack trace in response', () => {
    const r = scanCode('src/handler.ts', 'res.json({ error: err.stack })')
    expect(issuesForRule(r.issues, 'error-stack-exposure').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: res.json without stack', () => {
    const r = scanCode('src/handler.ts', 'res.json({ message: "Internal error" })')
    expect(issuesForRule(r.issues, 'error-stack-exposure')).toHaveLength(0)
  })
  it('detects raw error object in response', () => {
    const r = scanCode('src/handler.ts', 'res.send(error)')
    expect(issuesForRule(r.issues, 'verbose-error-response').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: error in errorHandler', () => {
    const r = scanCode('src/handler.ts', 'function errorHandler(e,q,r) { res.send(err) }')
    expect(issuesForRule(r.issues, 'verbose-error-response')).toHaveLength(0)
  })
  it('detects DEBUG = true', () => {
    const r = scanCode('src/config.ts', 'DEBUG = true')
    expect(issuesForRule(r.issues, 'debug-mode-production').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: debug via process.env', () => {
    const r = scanCode('src/config.ts', 'const debug = process.env.DEBUG === "true"')
    expect(issuesForRule(r.issues, 'debug-mode-production')).toHaveLength(0)
  })
  it('detects console.log(password)', () => {
    const r = scanCode('src/auth.ts', 'console.log(password)')
    expect(issuesForRule(r.issues, 'console-log-sensitive').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: console.log non-sensitive', () => {
    const r = scanCode('src/auth.ts', 'console.log("User logged in:", userId)')
    expect(issuesForRule(r.issues, 'console-log-sensitive')).toHaveLength(0)
  })
})

describe('GraphQL', () => {
  it('detects introspection: true', () => {
    const r = scanCode('src/gql.ts', 'new ApolloServer({ introspection: true })')
    expect(issuesForRule(r.issues, 'graphql-introspection-enabled').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: introspection with env check', () => {
    const r = scanCode('src/gql.ts', 'new ApolloServer({ introspection: process.env.NODE_ENV !== "prod" })')
    expect(issuesForRule(r.issues, 'graphql-introspection-enabled')).toHaveLength(0)
  })
  it('detects GraphQL server without depth limit', () => {
    const r = scanCode('src/gql.ts', 'new ApolloServer({ typeDefs, resolvers })')
    expect(issuesForRule(r.issues, 'graphql-no-depth-limit').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: server with depthLimit', () => {
    const r = scanCode('src/gql.ts', 'new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(10)] })')
    expect(issuesForRule(r.issues, 'graphql-no-depth-limit')).toHaveLength(0)
  })
})

describe('Timing Attacks', () => {
  it('detects === comparison on secret (JS)', () => {
    const r = scanCode('src/auth.ts', 'if (inputToken === secret) { grant() }')
    expect(issuesForRule(r.issues, 'timing-attack-comparison').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: timingSafeEqual', () => {
    const r = scanCode('src/auth.ts', 'if (crypto.timingSafeEqual(a, b)) { grant() }')
    expect(issuesForRule(r.issues, 'timing-attack-comparison')).toHaveLength(0)
  })
  it('detects == comparison on secret (Python)', () => {
    const r = scanCode('src/auth.py', 'if token == secret:\n    grant()')
    expect(issuesForRule(r.issues, 'timing-attack-py').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: hmac.compare_digest', () => {
    const r = scanCode('src/auth.py', 'if hmac.compare_digest(a, b):\n    grant()')
    expect(issuesForRule(r.issues, 'timing-attack-py')).toHaveLength(0)
  })
})

describe('ReDoS', () => {
  it('detects RegExp from req.body', () => {
    const r = scanCode('src/search.ts', 'const rx = new RegExp(req.body.pattern)')
    expect(issuesForRule(r.issues, 'redos-user-regex').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: literal RegExp', () => {
    const r = scanCode('src/search.ts', 'const rx = new RegExp("^[a-z]+$")')
    expect(issuesForRule(r.issues, 'redos-user-regex')).toHaveLength(0)
  })
  it('detects dynamic RegExp from variable', () => {
    const r = scanCode('src/search.ts', 'const rx = new RegExp(pattern)')
    expect(issuesForRule(r.issues, 'redos-dynamic-regex').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sanitized pattern', () => {
    const r = scanCode('src/search.ts', 'const rx = new RegExp(sanitized)')
    expect(issuesForRule(r.issues, 'redos-dynamic-regex')).toHaveLength(0)
  })
})

describe('XXE', () => {
  it('detects DOMParser usage (JS)', () => {
    const r = scanCode('src/parser.ts', 'const p = new DOMParser()\np.parseFromString(xml, "text/xml")')
    expect(issuesForRule(r.issues, 'xxe-js-parser').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: xml2js with noent: false', () => {
    const r = scanCode('src/parser.ts', 'const opts = { noent: false }; xml2js.parseString(data, opts)')
    expect(issuesForRule(r.issues, 'xxe-js-parser')).toHaveLength(0)
  })
  it('detects xml.etree.ElementTree.parse (Python)', () => {
    const r = scanCode('src/parser.py', 'tree = xml.etree.ElementTree.parse(data)')
    expect(issuesForRule(r.issues, 'xxe-python').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: defusedxml', () => {
    const r = scanCode('src/parser.py', 'tree = defusedxml.ElementTree.parse(data)')
    expect(issuesForRule(r.issues, 'xxe-python')).toHaveLength(0)
  })
  it('detects DocumentBuilderFactory.newInstance (Java)', () => {
    const r = scanCode('src/Parser.java', 'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();')
    expect(issuesForRule(r.issues, 'xxe-java').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: factory with FEATURE_SECURE_PROCESSING', () => {
    const r = scanCode('src/Parser.java', 'dbf = DocumentBuilderFactory.newInstance(); dbf.setFeature(FEATURE_SECURE_PROCESSING, true);')
    expect(issuesForRule(r.issues, 'xxe-java')).toHaveLength(0)
  })
})

describe('Log Injection', () => {
  it('detects user input in JS log', () => {
    const r = scanCode('src/auth.ts', 'console.log("Login:", req.body.username)')
    expect(issuesForRule(r.issues, 'log-injection-js').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sanitized log input (JS)', () => {
    const r = scanCode('src/auth.ts', 'console.log("Login:", sanitize(req.body.username))')
    expect(issuesForRule(r.issues, 'log-injection-js')).toHaveLength(0)
  })
  it('detects user input in Python log', () => {
    const r = scanCode('src/views.py', 'logging.info("User: " + request.form["name"])')
    expect(issuesForRule(r.issues, 'log-injection-py').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: sanitized Python log', () => {
    const r = scanCode('src/views.py', 'logging.info("User: " + sanitize(request.form["name"]))')
    expect(issuesForRule(r.issues, 'log-injection-py')).toHaveLength(0)
  })
})

describe('Weak Cryptography', () => {
  it('detects DES cipher', () => {
    const r = scanCode('src/crypto.ts', 'algo = "DES"')
    expect(issuesForRule(r.issues, 'weak-cipher-des').length).toBeGreaterThanOrEqual(1)
  })
  it('detects 3DES cipher', () => {
    const r = scanCode('src/crypto.ts', 'algo = "3DES"')
    expect(issuesForRule(r.issues, 'weak-cipher-des').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: DES in comment', () => {
    const r = scanCode('src/crypto.ts', '// Do not use DES encryption')
    expect(issuesForRule(r.issues, 'weak-cipher-des')).toHaveLength(0)
  })
  it('detects RC4 cipher', () => {
    const r = scanCode('src/crypto.ts', 'algo = "RC4"')
    expect(issuesForRule(r.issues, 'weak-cipher-rc4').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: RC4 in comment', () => {
    const r = scanCode('src/crypto.ts', '// RC4 is deprecated')
    expect(issuesForRule(r.issues, 'weak-cipher-rc4')).toHaveLength(0)
  })
  it('detects ECB mode via AES/ECB', () => {
    const r = scanCode('src/Crypto.java', 'Cipher.getInstance("AES/ECB/PKCS5Padding")')
    expect(issuesForRule(r.issues, 'weak-cipher-ecb').length).toBeGreaterThanOrEqual(1)
  })
  it('detects .MODE_ECB', () => {
    const r = scanCode('src/crypto.py', 'cipher = AES.new(key, AES.MODE_ECB)')
    expect(issuesForRule(r.issues, 'weak-cipher-ecb').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: ECB in comment', () => {
    const r = scanCode('src/crypto.ts', '// Never use ECB mode')
    expect(issuesForRule(r.issues, 'weak-cipher-ecb')).toHaveLength(0)
  })
})

describe('SSTI', () => {
  it('detects template render with user input (JS)', () => {
    const r = scanCode('src/render.ts', 'ejs.render(req.body.template)')
    expect(issuesForRule(r.issues, 'ssti-js').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: static template (JS)', () => {
    const r = scanCode('src/render.ts', 'ejs.render(templateFile, { name: displayName })')
    expect(issuesForRule(r.issues, 'ssti-js')).toHaveLength(0)
  })
  it('detects render_template_string with user input (Python)', () => {
    const r = scanCode('src/views.py', 'render_template_string(request.form["tpl"])')
    expect(issuesForRule(r.issues, 'ssti-python').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: render_template with file path', () => {
    const r = scanCode('src/views.py', 'render_template("index.html", data=data)')
    expect(issuesForRule(r.issues, 'ssti-python')).toHaveLength(0)
  })
})

// ── Phase 1B — Framework Rules (17 rules) ─────────────────────────────────

describe('Next.js / React', () => {
  it('detects NEXT_PUBLIC_SECRET_KEY', () => {
    const r = scanCode('src/config.ts', 'const key = process.env.NEXT_PUBLIC_SECRET_KEY')
    expect(issuesForRule(r.issues, 'nextjs-public-env-secret').length).toBeGreaterThanOrEqual(1)
  })
  it('detects NEXT_PUBLIC_API_KEY', () => {
    const r = scanCode('src/config.ts', 'const key = process.env.NEXT_PUBLIC_API_KEY')
    expect(issuesForRule(r.issues, 'nextjs-public-env-secret').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: NEXT_PUBLIC_APP_NAME', () => {
    const r = scanCode('src/config.ts', 'const name = process.env.NEXT_PUBLIC_APP_NAME')
    expect(issuesForRule(r.issues, 'nextjs-public-env-secret')).toHaveLength(0)
  })
  it('flags "use server" directive', () => {
    const r = scanCode('src/actions.ts', '"use server"\nexport async function update() {}')
    expect(issuesForRule(r.issues, 'nextjs-server-action-no-auth').length).toBeGreaterThanOrEqual(1)
  })
  it('detects dangerouslySetInnerHTML with dynamic content', () => {
    const r = scanCode('src/page.tsx', '<div dangerouslySetInnerHTML={{ __html: content }} />')
    expect(issuesForRule(r.issues, 'nextjs-dangerous-html-prop').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: dangerouslySetInnerHTML with DOMPurify sanitization', () => {
    const r = scanCode('src/page.tsx', '<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />')
    expect(issuesForRule(r.issues, 'nextjs-dangerous-html-prop')).toHaveLength(0)
  })
  it('detects redirect with user input', () => {
    const r = scanCode('src/handler.ts', 'redirect(req.query.url)')
    expect(issuesForRule(r.issues, 'nextjs-redirect-input').length).toBeGreaterThanOrEqual(1)
  })
  it('detects redirect with searchParams', () => {
    const r = scanCode('src/handler.ts', 'redirect(searchParams.get("next"))')
    expect(issuesForRule(r.issues, 'nextjs-redirect-input').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: redirect with static path', () => {
    const r = scanCode('src/handler.ts', 'redirect("/dashboard")')
    expect(issuesForRule(r.issues, 'nextjs-redirect-input')).toHaveLength(0)
  })
})

describe('Express.js', () => {
  it('flags express() without helmet', () => {
    const r = scanCode('src/server.ts', 'const app = express()')
    expect(issuesForRule(r.issues, 'express-no-helmet').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: express() when helmet is present', () => {
    const r = scanCode('src/server.ts', 'const helmet = require("helmet"); const app = express()')
    expect(issuesForRule(r.issues, 'express-no-helmet')).toHaveLength(0)
  })
  it('flags route without rate limit', () => {
    const r = scanCode('src/routes.ts', 'const app = express()\napp.get("/api/users", handler)')
    expect(issuesForRule(r.issues, 'express-no-rate-limit').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: route with rateLimit', () => {
    const r = scanCode('src/routes.ts', 'const app = express()\napp.get("/api/users", handler)\napp.use(rateLimit({ windowMs: 900000, max: 100 }))')
    expect(issuesForRule(r.issues, 'express-no-rate-limit')).toHaveLength(0)
  })
  it('flags res.cookie without signed', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("session", value)')
    expect(issuesForRule(r.issues, 'express-cookie-not-signed').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: res.cookie with signed: true', () => {
    const r = scanCode('src/auth.ts', 'res.cookie("session", value, { signed: true })')
    expect(issuesForRule(r.issues, 'express-cookie-not-signed')).toHaveLength(0)
  })
  it('detects express-session without resave: false', () => {
    const r = scanCode('src/server.ts', 'const session = require("express-session")')
    expect(issuesForRule(r.issues, 'express-session-fixation').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: express-session with resave: false', () => {
    const r = scanCode('src/server.ts', 'app.use(require("express-session")({ resave: false }))')
    expect(issuesForRule(r.issues, 'express-session-fixation')).toHaveLength(0)
  })
  it('detects trust proxy set to true', () => {
    const r = scanCode('src/server.ts', "app.set('trust proxy', true)")
    expect(issuesForRule(r.issues, 'express-trust-proxy').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: trust proxy set to number', () => {
    const r = scanCode('src/server.ts', "app.set('trust proxy', 1)")
    expect(issuesForRule(r.issues, 'express-trust-proxy')).toHaveLength(0)
  })
})

describe('Django', () => {
  it('detects @csrf_exempt', () => {
    const r = scanCode('src/views.py', '@csrf_exempt\ndef my_view(request):\n    pass')
    expect(issuesForRule(r.issues, 'django-csrf-exempt').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: @csrf_exempt in non-Python file', () => {
    const r = scanCode('src/notes.txt', '@csrf_exempt')
    expect(issuesForRule(r.issues, 'django-csrf-exempt')).toHaveLength(0)
  })
  it('detects mark_safe with f-string', () => {
    const r = scanCode('src/views.py', 'return mark_safe(f"<p>{name}</p>")')
    expect(issuesForRule(r.issues, 'django-mark-safe').length).toBeGreaterThanOrEqual(1)
  })
  it('detects mark_safe with request data', () => {
    const r = scanCode('src/views.py', 'return mark_safe(request.POST["html"])')
    expect(issuesForRule(r.issues, 'django-mark-safe').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: static mark_safe', () => {
    const r = scanCode('src/views.py', 'return mark_safe("<p>safe</p>")')
    expect(issuesForRule(r.issues, 'django-mark-safe')).toHaveLength(0)
  })
  it('detects .raw() with f-string SQL', () => {
    const r = scanCode('src/views.py', 'Model.objects.raw(f"SELECT id FROM t WHERE name = {name}")')
    expect(issuesForRule(r.issues, 'django-raw-sql').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: parameterized .raw() query', () => {
    const r = scanCode('src/views.py', 'Model.objects.raw("SELECT id FROM t WHERE name = %s", [name])')
    expect(issuesForRule(r.issues, 'django-raw-sql')).toHaveLength(0)
  })
})

describe('Flask', () => {
  it('detects app.run(debug=True)', () => {
    const r = scanCode('src/app.py', 'app.run(debug=True, port=5000)')
    expect(issuesForRule(r.issues, 'flask-debug-mode').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: app.run without debug', () => {
    const r = scanCode('src/app.py', 'app.run(port=5000)')
    expect(issuesForRule(r.issues, 'flask-debug-mode')).toHaveLength(0)
  })
  it('detects hardcoded SECRET_KEY', () => {
    const r = scanCode('src/config.py', "SECRET_KEY = 'a8f3k2m9x7v1b3q5w2e4r1t8'")
    expect(issuesForRule(r.issues, 'flask-secret-key-hardcoded').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: SECRET_KEY from os.environ', () => {
    const r = scanCode('src/config.py', 'SECRET_KEY = os.environ["SECRET_KEY"]')
    expect(issuesForRule(r.issues, 'flask-secret-key-hardcoded')).toHaveLength(0)
  })
})

describe('Spring / Java', () => {
  it('detects .csrf().disable()', () => {
    const r = scanCode('src/SecurityConfig.java', 'http.csrf().disable()')
    expect(issuesForRule(r.issues, 'spring-csrf-disabled').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: csrf with defaults', () => {
    const r = scanCode('src/SecurityConfig.java', 'http.csrf(withDefaults())')
    expect(issuesForRule(r.issues, 'spring-csrf-disabled')).toHaveLength(0)
  })
  it('detects @RequestBody without @Valid', () => {
    const r = scanCode('src/UserCtrl.java', '@PostMapping("/users") public ResponseEntity create(@RequestBody UserDto dto) {')
    expect(issuesForRule(r.issues, 'spring-missing-valid').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: @RequestBody with @Valid', () => {
    const r = scanCode('src/UserCtrl.java', '@PostMapping("/users") public ResponseEntity create(@RequestBody @Valid UserDto dto) {')
    expect(issuesForRule(r.issues, 'spring-missing-valid')).toHaveLength(0)
  })
  it('detects .authorizeRequests().anyRequest().permitAll()', () => {
    const r = scanCode('src/SecurityConfig.java', 'http.authorizeRequests().anyRequest().permitAll()')
    expect(issuesForRule(r.issues, 'spring-permit-all').length).toBeGreaterThanOrEqual(1)
  })
  it('detects antMatchers("/**").permitAll()', () => {
    const r = scanCode('src/SecurityConfig.java', 'http.authorizeRequests().antMatchers("/**").permitAll()')
    expect(issuesForRule(r.issues, 'spring-permit-all').length).toBeGreaterThanOrEqual(1)
  })
  it('FP: anyRequest().authenticated()', () => {
    const r = scanCode('src/SecurityConfig.java', 'http.authorizeRequests().anyRequest().authenticated()')
    expect(issuesForRule(r.issues, 'spring-permit-all')).toHaveLength(0)
  })
})

// ── False-Positive Regression ──────────────────────────────────────────────

describe('False-Positive Regression', () => {
  it('does not fire secret rules on type annotations', () => {
    const r = scanCode('src/types.ts', 'interface Config { api_key: string; secret_key: string }')
    expect(issuesForRule(r.issues, 'hardcoded-secret')).toHaveLength(0)
  })
  it('does not fire LLM key rules on redacted examples', () => {
    const r = scanCode('src/docs.ts', 'const example = "sk-..."')
    expect(issuesForRule(r.issues, 'llm-openai-key')).toHaveLength(0)
  })
  it('does not fire weak cipher rules on doc strings', () => {
    const r = scanCode('src/readme.ts', 'const doc = "Avoid using DES encryption"')
    expect(issuesForRule(r.issues, 'weak-cipher-des')).toHaveLength(0)
  })
  it('does not fire cookie rules on non-JS/TS files', () => {
    const r = scanCode('src/config.yaml', 'httpOnly: false')
    expect(issuesForRule(r.issues, 'cookie-no-httponly')).toHaveLength(0)
  })
  it('does not fire framework rules on wrong file types', () => {
    const r = scanCode('src/readme.md', '@csrf_exempt')
    expect(issuesForRule(r.issues, 'django-csrf-exempt')).toHaveLength(0)
  })
})
