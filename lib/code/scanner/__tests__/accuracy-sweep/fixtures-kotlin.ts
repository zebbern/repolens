// Kotlin fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const kotlinFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. lateinit var usage → TP
  // -----------------------------------------------------------------------
  {
    name: 'kotlin-lateinit',
    description: 'lateinit var without guaranteed init — risk of UninitializedPropertyAccessException, TP',
    file: {
      path: 'src/services/UserService.kt',
      content: `class UserService {
    lateinit var repository: UserRepository

    fun getUser(id: Long): User {
        return repository.findById(id)
    }
}`,
      language: 'kotlin',
    },
    expected: [
      { ruleId: 'kotlin-lateinit-abuse', line: 2, expectation: 'present' },
    ],
  },
]
