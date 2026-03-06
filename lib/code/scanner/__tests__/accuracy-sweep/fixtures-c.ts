// C/C++ fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const cFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. gets() usage → TP (buffer overflow)
  // -----------------------------------------------------------------------
  {
    name: 'c-gets-usage',
    description: 'gets(buffer) — impossible to use safely, removed in C11',
    file: {
      path: 'src/input/reader.c',
      content: `#include <stdio.h>

void read_input() {
    char buffer[256];
    gets(buffer);
    printf("%s\\n", buffer);
}`,
      language: 'c',
    },
    expected: [
      { ruleId: 'c-gets', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 2. strcpy without size check → TP
  // -----------------------------------------------------------------------
  {
    name: 'c-strcpy-buffer-overflow',
    description: 'strcpy(dest, src) without bounds checking — buffer overflow',
    file: {
      path: 'src/utils/string-helpers.c',
      content: `#include <string.h>

void copy_name(const char* src) {
    char dest[64];
    strcpy(dest, src);
}`,
      language: 'c',
    },
    expected: [
      { ruleId: 'c-strcpy', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Format string vulnerability → TP
  // -----------------------------------------------------------------------
  {
    name: 'c-format-string-vuln',
    description: 'printf(user_input) — format string vulnerability',
    file: {
      path: 'src/logging/logger.c',
      content: `#include <stdio.h>

void log_message(const char* user_input) {
    printf(user_input);
}`,
      language: 'c',
    },
    expected: [
      { ruleId: 'c-format-string', line: 4, verdict: 'tp' },
    ],
  },
]
