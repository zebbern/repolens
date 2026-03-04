import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { CodeIssue } from '@/lib/code/scanner/types'

// Mock the 'ai' module before importing the module under test
vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

// Mock the providers module
vi.mock('@/lib/ai/providers', () => ({
  createAIModel: vi.fn(() => 'mock-model'),
}))

import {
  buildValidationPrompt,
  parseValidationResponse,
  getCodeContext,
  validateFinding,
  validateBatch,
  clearValidationCache,
  type ValidationOptions,
} from '@/lib/code/scanner/ai-validator'
import { generateText } from 'ai'
import { createAIModel } from '@/lib/ai/providers'

const mockedGenerateText = vi.mocked(generateText)
const mockedCreateAIModel = vi.mocked(createAIModel)

/** Helper to create a minimal CodeIssue. */
function makeIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: 'test-1',
    ruleId: 'sec-eval',
    category: 'security',
    severity: 'critical',
    title: 'Eval usage detected',
    description: 'Use of eval() allows arbitrary code execution.',
    file: 'src/utils.ts',
    line: 5,
    column: 1,
    snippet: 'eval(userInput)',
    cwe: 'CWE-95',
    owasp: 'A03:2021 Injection',
    confidence: 'high',
    ...overrides,
  }
}

const SAMPLE_FILE = `import { something } from 'lib'

function process(userInput: string) {
  // dangerous
  eval(userInput)
  return true
}

export { process }
`

const defaultOptions: ValidationOptions = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'test-key',
}

describe('buildValidationPrompt', () => {
  it('includes issue title, description, and CWE in the user prompt', () => {
    const issue = makeIssue()
    const context = getCodeContext(SAMPLE_FILE, 5)
    const { user, system } = buildValidationPrompt(issue, context)

    expect(user).toContain('Eval usage detected')
    expect(user).toContain('eval() allows arbitrary code execution')
    expect(user).toContain('CWE-95')
    expect(user).toContain('A03:2021 Injection')
    expect(user).toContain('sec-eval')
    expect(system).toContain('security code reviewer')
  })

  it('includes code context in the user prompt', () => {
    const issue = makeIssue()
    const context = getCodeContext(SAMPLE_FILE, 5)
    const { user } = buildValidationPrompt(issue, context)

    expect(user).toContain('eval(userInput)')
    expect(user).toContain('src/utils.ts')
  })

  it('includes severity and category', () => {
    const issue = makeIssue({ severity: 'warning', category: 'bad-practice' })
    const context = 'some context'
    const { user } = buildValidationPrompt(issue, context)

    expect(user).toContain('Severity: warning')
    expect(user).toContain('Category: bad-practice')
  })

  it('omits CWE/OWASP when not present', () => {
    const issue = makeIssue({ cwe: undefined, owasp: undefined })
    const context = 'some context'
    const { user } = buildValidationPrompt(issue, context)

    expect(user).not.toContain('CWE:')
    expect(user).not.toContain('OWASP:')
  })
})

describe('getCodeContext', () => {
  it('extracts surrounding lines with line numbers', () => {
    const ctx = getCodeContext(SAMPLE_FILE, 5, 2)
    // Should include lines 3-7 approximately
    expect(ctx).toContain('eval(userInput)')
    expect(ctx).toContain('>>>')
  })

  it('handles line at start of file', () => {
    const ctx = getCodeContext(SAMPLE_FILE, 1, 2)
    expect(ctx).toContain("import")
    expect(ctx).toContain('>>>')
  })

  it('handles line at end of file', () => {
    const lines = SAMPLE_FILE.split('\n')
    const ctx = getCodeContext(SAMPLE_FILE, lines.length, 2)
    expect(ctx).toContain('>>>')
  })
})

describe('parseValidationResponse', () => {
  it('parses a valid JSON response for true-positive', () => {
    const response = JSON.stringify({
      verdict: 'true-positive',
      confidence: 'high',
      reasoning: 'Eval with user input is dangerous.',
      suggestedSeverity: 'critical',
    })

    const result = parseValidationResponse(response, 'issue-1')

    expect(result.verdict).toBe('true-positive')
    expect(result.confidence).toBe('high')
    expect(result.reasoning).toBe('Eval with user input is dangerous.')
    expect(result.suggestedSeverity).toBe('critical')
    expect(result.issueId).toBe('issue-1')
  })

  it('parses a valid JSON response for false-positive', () => {
    const response = JSON.stringify({
      verdict: 'false-positive',
      confidence: 'medium',
      reasoning: 'This eval is in a test file with hardcoded input.',
    })

    const result = parseValidationResponse(response, 'issue-2')

    expect(result.verdict).toBe('false-positive')
    expect(result.confidence).toBe('medium')
    expect(result.reasoning).toBe('This eval is in a test file with hardcoded input.')
    expect(result.suggestedSeverity).toBeUndefined()
  })

  it('extracts JSON from markdown-fenced response', () => {
    const response = `Here is my analysis:
\`\`\`json
{"verdict":"true-positive","confidence":"high","reasoning":"Real vulnerability."}
\`\`\`
That's my verdict.`

    const result = parseValidationResponse(response, 'issue-3')

    expect(result.verdict).toBe('true-positive')
    expect(result.confidence).toBe('high')
  })

  it('defaults to "uncertain" when response is garbled', () => {
    const response = 'I cannot determine the issue status properly due to xyz reasons.'

    const result = parseValidationResponse(response, 'issue-4')

    expect(result.verdict).toBe('uncertain')
    expect(result.confidence).toBe('low')
  })

  it('uses keyword detection for "true positive" in plain text', () => {
    const response = 'This is a true positive. The eval call is dangerous.'

    const result = parseValidationResponse(response, 'issue-5')

    expect(result.verdict).toBe('true-positive')
  })

  it('uses keyword detection for "false positive" in plain text', () => {
    const response = 'This is a false positive because the input is sanitized.'

    const result = parseValidationResponse(response, 'issue-6')

    expect(result.verdict).toBe('false-positive')
  })

  it('normalizes alternative verdict phrasings in JSON', () => {
    const response = JSON.stringify({
      verdict: 'True Positive',
      confidence: 'HIGH',
      reasoning: 'Dangerous.',
    })

    const result = parseValidationResponse(response, 'issue-7')

    expect(result.verdict).toBe('true-positive')
    expect(result.confidence).toBe('high')
  })

  it('truncates very long reasoning', () => {
    const longReason = 'x'.repeat(1000)
    const response = JSON.stringify({
      verdict: 'uncertain',
      confidence: 'low',
      reasoning: longReason,
    })

    const result = parseValidationResponse(response, 'issue-8')

    expect(result.reasoning.length).toBeLessThanOrEqual(500)
  })
})

describe('validateFinding', () => {
  beforeEach(() => {
    clearValidationCache()
    vi.clearAllMocks()
    mockedCreateAIModel.mockReturnValue('mock-model' as never)
  })

  it('returns correct ValidationResult from AI response', async () => {
    mockedGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'true-positive',
        confidence: 'high',
        reasoning: 'Eval with user-controlled input is dangerous.',
      }),
    } as never)

    const issue = makeIssue()
    const result = await validateFinding(issue, SAMPLE_FILE, defaultOptions)

    expect(result.verdict).toBe('true-positive')
    expect(result.confidence).toBe('high')
    expect(result.issueId).toBe('test-1')
    expect(mockedGenerateText).toHaveBeenCalledOnce()
  })

  it('returns uncertain on AI error', async () => {
    mockedGenerateText.mockRejectedValueOnce(new Error('Rate limit exceeded'))

    const issue = makeIssue()
    const result = await validateFinding(issue, SAMPLE_FILE, defaultOptions)

    expect(result.verdict).toBe('uncertain')
    expect(result.confidence).toBe('low')
    expect(result.reasoning).toContain('Rate limit exceeded')
  })

  it('returns cached result on second call', async () => {
    mockedGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'false-positive',
        confidence: 'medium',
        reasoning: 'Cached result test.',
      }),
    } as never)

    const issue = makeIssue()
    const first = await validateFinding(issue, SAMPLE_FILE, defaultOptions)
    const second = await validateFinding(issue, SAMPLE_FILE, defaultOptions)

    expect(first.verdict).toBe('false-positive')
    expect(second).toEqual(first)
    expect(mockedGenerateText).toHaveBeenCalledOnce() // only called once
  })

  it('calls createAIModel with correct arguments', async () => {
    mockedGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'uncertain',
        confidence: 'low',
        reasoning: 'Cannot determine.',
      }),
    } as never)

    const issue = makeIssue()
    await validateFinding(issue, SAMPLE_FILE, {
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'test-google-key',
    })

    expect(mockedCreateAIModel).toHaveBeenCalledWith(
      'google',
      'gemini-2.5-flash',
      'test-google-key',
    )
  })
})

describe('validateBatch', () => {
  beforeEach(() => {
    clearValidationCache()
    vi.clearAllMocks()
    mockedCreateAIModel.mockReturnValue('mock-model' as never)
  })

  it('prioritizes critical issues first', async () => {
    const callOrder: string[] = []
    mockedGenerateText.mockImplementation(async () => {
      // Track call order by examining what was passed
      callOrder.push('called')
      return {
        text: JSON.stringify({
          verdict: 'uncertain',
          confidence: 'low',
          reasoning: 'Test.',
        }),
      } as never
    })

    const issues = [
      makeIssue({ id: 'info-1', severity: 'info', file: 'a.ts' }),
      makeIssue({ id: 'crit-1', severity: 'critical', file: 'a.ts' }),
      makeIssue({ id: 'warn-1', severity: 'warning', file: 'a.ts' }),
    ]

    const fileContents = new Map([['a.ts', SAMPLE_FILE]])

    const result = await validateBatch(issues, fileContents, defaultOptions)

    // All 3 validated
    expect(result.validatedCount).toBe(3)
    // Critical should be first in results
    expect(result.results[0].issueId).toBe('crit-1')
    expect(result.results[1].issueId).toBe('warn-1')
    expect(result.results[2].issueId).toBe('info-1')
  })

  it('respects maxFindings limit', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'true-positive',
        confidence: 'high',
        reasoning: 'Test.',
      }),
    } as never)

    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ id: `issue-${i}`, file: 'a.ts' }),
    )

    const fileContents = new Map([['a.ts', SAMPLE_FILE]])
    const options = { ...defaultOptions, maxFindings: 3 }

    const result = await validateBatch(issues, fileContents, options)

    expect(result.validatedCount).toBe(3)
    expect(result.results).toHaveLength(3)
  })

  it('skips issues without matching file content', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'true-positive',
        confidence: 'high',
        reasoning: 'Test.',
      }),
    } as never)

    const issues = [
      makeIssue({ id: 'has-content', file: 'a.ts' }),
      makeIssue({ id: 'no-content', file: 'missing.ts' }),
    ]

    const fileContents = new Map([['a.ts', SAMPLE_FILE]])

    const result = await validateBatch(issues, fileContents, defaultOptions)

    expect(result.validatedCount).toBe(1)
    expect(result.results[0].issueId).toBe('has-content')
  })

  it('returns correct aggregate counts', async () => {
    const responses = [
      { verdict: 'true-positive', confidence: 'high', reasoning: 'TP' },
      { verdict: 'false-positive', confidence: 'medium', reasoning: 'FP' },
      { verdict: 'uncertain', confidence: 'low', reasoning: 'U' },
    ]
    let callIdx = 0
    mockedGenerateText.mockImplementation(async () => {
      const resp = responses[callIdx % responses.length]
      callIdx++
      return { text: JSON.stringify(resp) } as never
    })

    const issues = [
      makeIssue({ id: 'i1', file: 'a.ts' }),
      makeIssue({ id: 'i2', file: 'a.ts' }),
      makeIssue({ id: 'i3', file: 'a.ts' }),
    ]

    const fileContents = new Map([['a.ts', SAMPLE_FILE]])

    const result = await validateBatch(issues, fileContents, defaultOptions)

    expect(result.truePositives).toBe(1)
    expect(result.falsePositives).toBe(1)
    expect(result.uncertain).toBe(1)
    expect(result.validatedCount).toBe(3)
  })
})
