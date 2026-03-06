// Rust fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const rustFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. Rust unwrap in tests → should NOT fire in test context (FP)
  // -----------------------------------------------------------------------
  {
    name: 'rust-unwrap-in-test',
    description: 'unwrap() inside #[test] function — FP if test-file suppression works',
    file: {
      path: 'tests/parser_test.rs',
      content: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_input() {
        let result = parse("42").unwrap();
        assert_eq!(result, 42);
    }

    #[test]
    fn test_parse_expression() {
        let val = evaluate("1 + 2").expect("should parse");
        assert_eq!(val, 3);
    }
}`,
      language: 'rust',
    },
    expected: [
      // Test file in path (tests/) → rust-unwrap excludeFiles should match
    ],
  },

  // -----------------------------------------------------------------------
  // 2. Rust unsafe FFI → TP
  // -----------------------------------------------------------------------
  {
    name: 'rust-unsafe-ffi',
    description: 'unsafe block for FFI binding — TP even in FFI context',
    file: {
      path: 'src/ffi/bindings.rs',
      content: `extern crate libc;

pub fn allocate(size: usize) -> *mut u8 {
    unsafe { libc::malloc(size) as *mut u8 }
}

pub fn free_ptr(ptr: *mut u8) {
    unsafe { libc::free(ptr as *mut libc::c_void) }
}`,
      language: 'rust',
    },
    expected: [
      { ruleId: 'rust-unsafe-block', line: 4, verdict: 'tp' },
      { ruleId: 'rust-unsafe-block', line: 8, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Rust production unwrap → TP
  // -----------------------------------------------------------------------
  {
    name: 'rust-production-unwrap',
    description: 'unwrap() in production handler code — TP',
    file: {
      path: 'src/handlers/api.rs',
      content: `use serde_json::Value;

pub fn handle_request(body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap();
    let name = parsed["name"].as_str().unwrap();
    format!("Hello, {}!", name)
}`,
      language: 'rust',
    },
    expected: [
      { ruleId: 'rust-unwrap', line: 4, verdict: 'tp' },
      { ruleId: 'rust-unwrap', line: 5, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 4. Rust error handling with match → no unwrap rules should fire
  // -----------------------------------------------------------------------
  {
    name: 'rust-proper-error-handling',
    description: 'Proper match-based error handling — no unwrap rules fire',
    file: {
      path: 'src/handlers/safe.rs',
      content: `use std::io;

pub fn read_config(path: &str) -> Result<String, io::Error> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) => {
            eprintln!("Failed to read config: {}", e);
            Err(e)
        }
    }
}`,
      language: 'rust',
    },
    expected: [
      // No unwrap or expect — nothing should fire
    ],
  },
]
