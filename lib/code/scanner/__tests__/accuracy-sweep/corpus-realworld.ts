// Real-world vulnerability corpus — types and barrel exports.

import type { FixtureCase } from './types'

// ============================================================================
// Corpus entry type (extends FixtureCase with category metadata)
// ============================================================================

export interface CorpusEntry extends FixtureCase {
  id: string
  category: 'vulnerable' | 'secure' | 'mixed'
  groundTruth: {
    expectedVulnCount: number
    expectedClean: boolean
  }
}

// ============================================================================
// Re-export full corpus
// ============================================================================

import { VULNERABLE_CORPUS_A } from './corpus-vulnerable-a'
import { VULNERABLE_CORPUS_B } from './corpus-vulnerable-b'
import { SECURE_CORPUS } from './corpus-secure'
import { MIXED_CORPUS } from './corpus-mixed'

export { SECURE_CORPUS } from './corpus-secure'
export { MIXED_CORPUS } from './corpus-mixed'

export const VULNERABLE_CORPUS: CorpusEntry[] = [
  ...VULNERABLE_CORPUS_A,
  ...VULNERABLE_CORPUS_B,
]

export const REALWORLD_CORPUS: CorpusEntry[] = [
  ...VULNERABLE_CORPUS,
  ...SECURE_CORPUS,
  ...MIXED_CORPUS,
]
