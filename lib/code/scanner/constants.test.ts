import { describe, expect, it } from 'vitest'
import { isExemptFromRuleCap } from '@/lib/code/scanner/constants'

describe('isExemptFromRuleCap', () => {
  it.each([
    ['security warning', 'security', 'warning', true],
    ['security info', 'security', 'info', true],
    ['critical bad practice', 'bad-practice', 'critical', true],
    ['critical reliability', 'reliability', 'critical', true],
    ['bad-practice warning', 'bad-practice', 'warning', false],
    ['reliability info', 'reliability', 'info', false],
  ] as const)('%s', (_name, category, severity, exempt) => {
    expect(isExemptFromRuleCap({ category, severity })).toBe(exempt)
  })
})
