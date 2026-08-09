// Shell fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const shellFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Unquoted shell variables → TP
  // -----------------------------------------------------------------------
  {
    name: 'shell-unquoted-var',
    description: 'rm/cp/chmod with unquoted $VAR — word splitting risk, TP',
    file: {
      path: 'scripts/cleanup.sh',
      content: `#!/bin/bash
rm -rf $TEMP_DIR
cp $SOURCE_FILE /dest/
chmod -R $SCRIPT_PATH`,
      language: 'shellscript',
    },
    expected: [
      { ruleId: 'shell-unquoted-var', line: 2, expectation: 'present' },
      { ruleId: 'shell-unquoted-var', line: 3, expectation: 'present' },
      { ruleId: 'shell-unquoted-var', line: 4, expectation: 'present' },
    ],
  },
]
