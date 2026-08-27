import { SECURITY_RULES } from '@/lib/code/scanner/rules-security'
import { BAD_PRACTICE_RULES, RELIABILITY_RULES } from '@/lib/code/scanner/rules-quality'
import { SECURITY_LANG_RULES } from '@/lib/code/scanner/rules-security-lang'

/**
 * Helper: test whether a rule's pattern matches a given string.
 * Respects the rule's patternOptions for case sensitivity, regex mode, etc.
 */
function matchesRule(
  rule: { pattern?: string; patternOptions?: { caseSensitive?: boolean; regex?: boolean }; excludePattern?: RegExp },
  input: string,
): boolean {
  if (!rule.pattern) return false
  const flags = rule.patternOptions?.caseSensitive ? 'g' : 'gi'
  const regex = rule.patternOptions?.regex
    ? new RegExp(rule.pattern, flags)
    : new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  const match = regex.test(input)
  if (match && rule.excludePattern && rule.excludePattern.test(input)) return false
  return match
}

describe('SECURITY_RULES', () => {
  it('has at least 5 rules defined', () => {
    expect(SECURITY_RULES.length).toBeGreaterThanOrEqual(5)
  })

  it('all rules have required fields', () => {
    for (const rule of SECURITY_RULES) {
      expect(rule.id).toBeTruthy()
      expect(rule.category).toBe('security')
      expect(rule.title).toBeTruthy()
      expect(rule.description).toBeTruthy()
      expect(rule.severity).toMatch(/^(critical|warning|info)$/)
    }
  })

  describe('hardcoded-aws-key', () => {
    const rule = SECURITY_RULES.find(r => r.id === 'hardcoded-aws-key')!

    it.each([
      { input: 'const key = "AKIAIOSFODNN7EXAMPL1"', shouldMatch: true, desc: 'detects AWS access key' },
      { input: 'const key = "ASIAXYZ123456789ABCD"', shouldMatch: true, desc: 'detects AWS temp key' },
      { input: 'const key = "AKIAIOSFODNN7EXAMPLE"', shouldMatch: false, desc: 'ignores AWS documentation access key' },
      { input: 'const key = "ASIAIOSFODNN7EXAMPLE"', shouldMatch: false, desc: 'ignores AWS documentation temp key' },
      { input: 'const key = "some-random-string"', shouldMatch: false, desc: 'ignores non-AWS string' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('hardcoded-secret', () => {
    const rule = SECURITY_RULES.find(r => r.id === 'hardcoded-secret')!

    it.each([
      { input: 'api_key = "sk_live_abc12345678"', shouldMatch: true, desc: 'detects api_key assignment' },
      { input: 'secret_key: "mysupersecret123"', shouldMatch: true, desc: 'detects secret_key assignment' },
      { input: 'api_key = process.env.API_KEY', shouldMatch: false, desc: 'ignores env var usage' },
      { input: 'api_key = "test_placeholder"', shouldMatch: false, desc: 'ignores test placeholders' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('eval-usage', () => {
    const rule = SECURITY_RULES.find(r => r.id === 'eval-usage')!

    it.each([
      { input: 'eval(userInput)', shouldMatch: true, desc: 'detects eval()' },
      { input: 'new Function("return " + code)', shouldMatch: true, desc: 'detects new Function()' },
      { input: 'JSON.parse(data)', shouldMatch: false, desc: 'ignores JSON.parse' },
      { input: '// eval is bad', shouldMatch: false, desc: 'ignores eval in comments' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('innerhtml-xss', () => {
    const rule = SECURITY_RULES.find(r => r.id === 'innerhtml-xss')!

    it.each([
      { input: 'el.innerHTML = userContent', shouldMatch: true, desc: 'detects innerHTML assignment' },
      { input: 'dangerouslySetInnerHTML={{ __html: html }}', shouldMatch: true, desc: 'detects dangerouslySetInnerHTML' },
      { input: 'el.textContent = text', shouldMatch: false, desc: 'ignores textContent' },
      { input: 'DOMPurify.sanitize(el.innerHTML = content)', shouldMatch: false, desc: 'ignores with DOMPurify' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('private-key-inline', () => {
    const rule = SECURITY_RULES.find(r => r.id === 'private-key-inline')!

    it.each([
      { input: '-----BEGIN RSA PRIVATE KEY-----', shouldMatch: true, desc: 'detects RSA private key' },
      { input: '-----BEGIN PRIVATE KEY-----', shouldMatch: true, desc: 'detects generic private key' },
      { input: '-----BEGIN PUBLIC KEY-----', shouldMatch: false, desc: 'ignores public key' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })
})

describe('BAD_PRACTICE_RULES', () => {
  it('has at least 5 rules defined', () => {
    expect(BAD_PRACTICE_RULES.length).toBeGreaterThanOrEqual(5)
  })

  describe('console-log', () => {
    const rule = BAD_PRACTICE_RULES.find(r => r.id === 'console-log')!

    it.each([
      { input: 'console.log("debug")', shouldMatch: true, desc: 'detects console.log' },
      { input: 'console.debug(data)', shouldMatch: true, desc: 'detects console.debug' },
      { input: 'console.error("error")', shouldMatch: false, desc: 'ignores console.error' },
      { input: '// console.log("commented")', shouldMatch: false, desc: 'ignores commented console.log' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('any-type', () => {
    const rule = BAD_PRACTICE_RULES.find(r => r.id === 'any-type')!

    it.each([
      { input: 'const x: any = 1', shouldMatch: true, desc: 'detects : any type' },
      { input: 'foo as any', shouldMatch: true, desc: 'detects as any cast' },
      { input: 'const x: unknown = 1', shouldMatch: false, desc: 'ignores unknown type' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('empty-catch', () => {
    const rule = BAD_PRACTICE_RULES.find(r => r.id === 'empty-catch')!

    it.each([
      { input: 'catch (e) {}', shouldMatch: true, desc: 'detects empty catch block' },
      { input: 'catch (e) { console.error(e) }', shouldMatch: false, desc: 'ignores catch with body' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('var-usage', () => {
    const rule = BAD_PRACTICE_RULES.find(r => r.id === 'var-usage')!

    it.each([
      { input: 'var x = 1', shouldMatch: true, desc: 'detects var declaration' },
      { input: 'const x = 1', shouldMatch: false, desc: 'ignores const' },
      { input: 'let x = 1', shouldMatch: false, desc: 'ignores let' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('python-bare-except', () => {
    const rule = BAD_PRACTICE_RULES.find(r => r.id === 'python-bare-except')!

    it.each([
      { input: 'except:', shouldMatch: true, desc: 'detects bare except' },
      { input: 'except Exception:', shouldMatch: false, desc: 'ignores specific except' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })
})

describe('RELIABILITY_RULES', () => {
  it('has at least 1 rule defined', () => {
    expect(RELIABILITY_RULES.length).toBeGreaterThanOrEqual(1)
  })

  describe('todo-fixme', () => {
    const rule = RELIABILITY_RULES.find(r => r.id === 'todo-fixme')!

    it.each([
      { input: '// TODO: fix this later', shouldMatch: true, desc: 'detects TODO comment' },
      { input: '// FIXME: broken', shouldMatch: true, desc: 'detects FIXME comment' },
      { input: '# HACK: temporary', shouldMatch: true, desc: 'detects HACK with hash' },
      { input: 'const todo = "value"', shouldMatch: false, desc: 'ignores todo in code' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })
})

describe('SECURITY_LANG_RULES', () => {
  it('has rules defined', () => {
    expect(SECURITY_LANG_RULES.length).toBeGreaterThanOrEqual(5)
  })

  describe('python-exec', () => {
    const rule = SECURITY_LANG_RULES.find(r => r.id === 'python-exec')!

    it.each([
      { input: 'exec(user_code)', shouldMatch: true, desc: 'detects exec()' },
      { input: 'eval(expression)', shouldMatch: true, desc: 'detects eval()' },
      { input: 'ast.literal_eval(data)', shouldMatch: false, desc: 'ignores literal_eval' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('python-pickle', () => {
    const rule = SECURITY_LANG_RULES.find(r => r.id === 'python-pickle')!

    it.each([
      { input: 'pickle.loads(data)', shouldMatch: true, desc: 'detects pickle.loads' },
      { input: 'pickle.load(file)', shouldMatch: true, desc: 'detects pickle.load' },
      { input: 'json.loads(data)', shouldMatch: false, desc: 'ignores json.loads' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })

  describe('python-subprocess-shell', () => {
    const rule = SECURITY_LANG_RULES.find(r => r.id === 'python-subprocess-shell')!

    it.each([
      { input: 'subprocess.run(cmd, shell=True)', shouldMatch: true, desc: 'detects subprocess with shell=True' },
      { input: 'subprocess.call(cmd, shell=True)', shouldMatch: true, desc: 'detects call with shell=True' },
      { input: 'subprocess.run(["ls", "-la"])', shouldMatch: false, desc: 'ignores safe subprocess' },
    ])('$desc', ({ input, shouldMatch }) => {
      expect(matchesRule(rule, input)).toBe(shouldMatch)
    })
  })
})
