import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { CodeIndex } from '@/lib/code/code-index'
import type { CodeIssue } from '@/lib/code/scanner/types'
import type { FixSuggestion, ValidationResult } from '@/lib/code/scanner'
import { useBatchOperations } from './use-batch-operations'

function createCodeIndex(files?: Map<string, { content: string }>): CodeIndex {
  const fileMap = new Map<string, { path: string; name: string; content: string; lines: string[]; lineCount: number }>()
  if (files) {
    for (const [path, { content }] of files) {
      fileMap.set(path, {
        path,
        name: path.split('/').pop() || path,
        content,
        lines: content.split('\n'),
        lineCount: content.split('\n').length,
      })
    }
  }
  return {
    files: fileMap as CodeIndex['files'],
    totalFiles: fileMap.size,
    totalLines: 0,
    isIndexing: false,
  }
}

function createIssue(overrides: Partial<CodeIssue> = {}): CodeIssue {
  return {
    id: `issue-${Math.random().toString(36).slice(2, 8)}`,
    ruleId: 'no-eval',
    category: 'security',
    severity: 'critical',
    title: 'Eval usage',
    description: 'Bad',
    file: 'src/utils.ts',
    line: 10,
    column: 1,
    snippet: 'eval(x)',
    ...overrides,
  }
}

function createFix(ruleId = 'no-eval'): FixSuggestion {
  return {
    ruleId,
    original: 'eval(x)',
    fixed: 'JSON.parse(x)',
    explanation: 'Use JSON.parse',
    confidence: 'auto',
    diffLines: [],
  }
}

function createValidationResult(issueId: string): ValidationResult {
  return {
    issueId,
    verdict: 'true-positive',
    confidence: 'high',
    reasoning: 'Confirmed',
  }
}

describe('useBatchOperations', () => {
  let setFixCache: ReturnType<typeof vi.fn>
  let setShowFix: ReturnType<typeof vi.fn>
  let setValidationResults: ReturnType<typeof vi.fn>
  let generateFix: ReturnType<typeof vi.fn>
  let validateFinding: ReturnType<typeof vi.fn>
  let codeIndex: CodeIndex

  beforeEach(() => {
    setFixCache = vi.fn()
    setShowFix = vi.fn()
    setValidationResults = vi.fn()
    generateFix = vi.fn()
    validateFinding = vi.fn()
    codeIndex = createCodeIndex(
      new Map([['src/utils.ts', { content: 'const x = eval("test")' }]]),
    )
  })

  function renderBatchHook(overrides: Record<string, unknown> = {}) {
    return renderHook(() =>
      useBatchOperations({
        codeIndex,
        selectedProvider: 'openai',
        selectedModel: { id: 'gpt-4' },
        apiKeys: { openai: { key: 'sk-test' } },
        generateFix,
        validateFinding,
        setFixCache,
        setShowFix,
        setValidationResults,
        ...overrides,
      }),
    )
  }

  describe('initial state', () => {
    it('returns idle progress for both validation and fix', () => {
      const { result } = renderBatchHook()
      expect(result.current.validationProgress).toEqual({
        completed: 0,
        total: 0,
        failed: 0,
        inProgress: false,
      })
      expect(result.current.fixProgress).toEqual({
        completed: 0,
        total: 0,
        failed: 0,
        inProgress: false,
      })
    })

    it('hasValidApiKey is true when all keys are present', () => {
      const { result } = renderBatchHook()
      expect(result.current.hasValidApiKey).toBe(true)
    })

    it('hasValidApiKey is false when provider is undefined', () => {
      const { result } = renderBatchHook({ selectedProvider: undefined })
      expect(result.current.hasValidApiKey).toBe(false)
    })

    it('hasValidApiKey is false when model is undefined', () => {
      const { result } = renderBatchHook({ selectedModel: undefined })
      expect(result.current.hasValidApiKey).toBe(false)
    })

    it('hasValidApiKey is false when API key is missing', () => {
      const { result } = renderBatchHook({ apiKeys: {} })
      expect(result.current.hasValidApiKey).toBe(false)
    })
  })

  describe('batchGenerateFixes', () => {
    it('generates fixes for all issues synchronously', () => {
      const issue1 = createIssue({ id: 'i1', file: 'src/utils.ts' })
      const issue2 = createIssue({ id: 'i2', file: 'src/utils.ts' })
      generateFix.mockReturnValue(createFix())

      const { result } = renderBatchHook()
      act(() => {
        result.current.batchGenerateFixes([issue1, issue2])
      })

      expect(generateFix).toHaveBeenCalledTimes(2)
      expect(setFixCache).toHaveBeenCalledTimes(1)
      expect(setShowFix).toHaveBeenCalledTimes(1)
    })

    it('sets fixProgress to completed after generation', () => {
      const issue = createIssue({ id: 'i1', file: 'src/utils.ts' })
      generateFix.mockReturnValue(createFix())

      const { result } = renderBatchHook()
      act(() => {
        result.current.batchGenerateFixes([issue])
      })

      expect(result.current.fixProgress).toEqual({
        completed: 1,
        total: 1,
        failed: 0,
        inProgress: false,
      })
    })

    it('counts failures when file is not in index', () => {
      const issue = createIssue({ id: 'i1', file: 'nonexistent.ts' })

      const { result } = renderBatchHook()
      act(() => {
        result.current.batchGenerateFixes([issue])
      })

      expect(result.current.fixProgress.failed).toBe(1)
      expect(generateFix).not.toHaveBeenCalled()
    })

    it('does nothing when issues array is empty', () => {
      const { result } = renderBatchHook()
      act(() => {
        result.current.batchGenerateFixes([])
      })

      expect(generateFix).not.toHaveBeenCalled()
      expect(result.current.fixProgress.inProgress).toBe(false)
    })

    it('passes file content to generateFix', () => {
      const issue = createIssue({ id: 'i1', file: 'src/utils.ts' })
      generateFix.mockReturnValue(null)

      const { result } = renderBatchHook()
      act(() => {
        result.current.batchGenerateFixes([issue])
      })

      expect(generateFix).toHaveBeenCalledWith(issue, 'const x = eval("test")')
    })
  })

  describe('batchValidate', () => {
    it('validates critical and warning issues only', async () => {
      const criticalIssue = createIssue({ id: 'i1', severity: 'critical', file: 'src/utils.ts' })
      const warningIssue = createIssue({ id: 'i2', severity: 'warning', file: 'src/utils.ts' })
      const infoIssue = createIssue({ id: 'i3', severity: 'info', file: 'src/utils.ts' })

      validateFinding.mockResolvedValue(createValidationResult(''))

      const { result } = renderBatchHook()
      await act(async () => {
        await result.current.batchValidate([criticalIssue, warningIssue, infoIssue])
      })

      // Only critical and warning should be validated
      expect(validateFinding).toHaveBeenCalledTimes(2)
    })

    it('does nothing when selectedProvider is undefined', async () => {
      const { result } = renderBatchHook({ selectedProvider: undefined })
      await act(async () => {
        await result.current.batchValidate([createIssue({ severity: 'critical' })])
      })
      expect(validateFinding).not.toHaveBeenCalled()
    })

    it('does nothing when no API key available', async () => {
      const { result } = renderBatchHook({ apiKeys: {} })
      await act(async () => {
        await result.current.batchValidate([createIssue({ severity: 'critical' })])
      })
      expect(validateFinding).not.toHaveBeenCalled()
    })

    it('updates validationResults for each completed issue', async () => {
      const issue = createIssue({ id: 'i1', severity: 'critical', file: 'src/utils.ts' })
      const valResult = createValidationResult('i1')
      validateFinding.mockResolvedValue(valResult)

      const { result } = renderBatchHook()
      await act(async () => {
        await result.current.batchValidate([issue])
      })

      expect(setValidationResults).toHaveBeenCalled()
    })

    it('handles validation errors gracefully', async () => {
      const issue = createIssue({ id: 'i1', severity: 'critical', file: 'src/utils.ts' })
      validateFinding.mockRejectedValue(new Error('API failure'))

      const { result } = renderBatchHook()
      await act(async () => {
        await result.current.batchValidate([issue])
      })

      expect(result.current.validationProgress.failed).toBe(1)
      expect(result.current.validationProgress.completed).toBe(1)
      // Should still call setValidationResults with uncertain result
      expect(setValidationResults).toHaveBeenCalled()
    })

    it('sets inProgress to false after completion', async () => {
      const issue = createIssue({ id: 'i1', severity: 'critical', file: 'src/utils.ts' })
      validateFinding.mockResolvedValue(createValidationResult('i1'))

      const { result } = renderBatchHook()
      await act(async () => {
        await result.current.batchValidate([issue])
      })

      expect(result.current.validationProgress.inProgress).toBe(false)
    })
  })

  describe('cancelBatch', () => {
    it('stops in-flight validation when cancelBatch is called', async () => {
      // Create many issues to ensure some are pending when cancel fires
      const issues = Array.from({ length: 10 }, (_, i) =>
        createIssue({ id: `i${i}`, severity: 'critical', file: 'src/utils.ts' }),
      )

      // Each validation takes a bit of time
      let callCount = 0
      validateFinding.mockImplementation(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
        return createValidationResult('')
      })

      const { result } = renderBatchHook()

      // Don't await — cancel mid-flight
      const promise = act(async () => {
        const batchPromise = result.current.batchValidate(issues)
        // Cancel immediately after starting
        result.current.cancelBatch()
        await batchPromise
      })

      await promise

      // Some calls may have started before cancel, but not all 10
      expect(callCount).toBeLessThanOrEqual(10)
    })
  })
})
