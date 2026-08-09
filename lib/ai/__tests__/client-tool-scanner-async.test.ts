import { describe, expect, it, vi } from 'vitest'

import { createEmptyIndex, indexFile } from '@/lib/code/code-index'

const scanIssuesAsync = vi.fn().mockResolvedValue({
  issues: [{
    id: 'ts-bare-except-py-src/app.py-3',
    ruleId: 'ts-bare-except-py',
    category: 'bad-practice',
    severity: 'warning',
    title: 'Bare except',
    description: 'Bare except',
    file: 'src/app.py',
    line: 3,
    column: 0,
    snippet: 'except:',
    confidence: 'medium',
  }],
})

vi.mock('@/lib/code/scanner/scanner', () => ({
  scanIssuesAsync,
  scanIssues: vi.fn(() => {
    throw new Error('sync scanner must not be used')
  }),
}))

import { executeToolLocally } from '@/lib/ai/client-tool-executor'

describe('scanIssues AI tool', () => {
  it('uses the authoritative async scanner path', async () => {
    let index = createEmptyIndex()
    index = indexFile(index, 'src/app.py', 'try:\n    pass\nexcept:\n    pass\n', 'python')

    const result = JSON.parse(
      await executeToolLocally('scanIssues', { path: 'src/app.py' }, index),
    )

    expect(scanIssuesAsync).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ issueCount: 1 })
  })
})
