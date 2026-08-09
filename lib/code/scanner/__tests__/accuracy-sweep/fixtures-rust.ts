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
      { ruleId: 'rust-unsafe-block', line: 4, expectation: 'present' },
      { ruleId: 'rust-unsafe-block', line: 8, expectation: 'present' },
      { ruleId: 'rust-unsafe', line: 4, expectation: 'present' },
      { ruleId: 'rust-unsafe', line: 8, expectation: 'present' },
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
      { ruleId: 'rust-unwrap', line: 4, expectation: 'present' },
      { ruleId: 'rust-unwrap', line: 5, expectation: 'present' },
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

  // -----------------------------------------------------------------------
  // 5. Rust unsafe without SAFETY comment → TP for both rules
  // -----------------------------------------------------------------------
  {
    name: 'rust-unsafe-no-safety-comment',
    description: 'unsafe block without // SAFETY: — TP for rust-unsafe and rust-unsafe-block',
    file: {
      path: 'src/mem/raw.rs',
      content: `pub fn raw_copy(src: *const u8, dst: *mut u8, len: usize) {
    unsafe {
        std::ptr::copy_nonoverlapping(src, dst, len);
    }
}`,
      language: 'rust',
    },
    expected: [
      { ruleId: 'rust-unsafe', line: 2, expectation: 'present' },
      { ruleId: 'rust-unsafe-block', line: 2, expectation: 'present' },
    ],
  },

  // -----------------------------------------------------------------------
  // 6. Rust unwrap_or_default → should NOT fire (safe alternative)
  // -----------------------------------------------------------------------
  {
    name: 'rust-unwrap-or-default-safe',
    description: 'unwrap_or_default() does not match unwrap() pattern — should NOT fire',
    file: {
      path: 'src/config/defaults.rs',
      content: `use std::env;

pub fn get_port() -> u16 {
    env::var("PORT")
        .unwrap_or_default()
        .parse::<u16>()
        .unwrap_or(3000)
}`,
      language: 'rust',
    },
    expected: [
      // unwrap_or_default() and unwrap_or(x) don't match \.unwrap\s*\(
      // because there are characters between "unwrap" and "("
    ],
  },

  // -----------------------------------------------------------------------
  // 7. Rust unsafe with SAFETY: comment → rust-unsafe-block suppressed
  // -----------------------------------------------------------------------
  {
    name: 'rust-unsafe-with-safety-comment',
    description: 'unsafe with // SAFETY: comment — rust-unsafe-block suppressed, rust-unsafe still fires',
    file: {
      path: 'src/ffi/wrapper.rs',
      content: `extern "C" {
    fn c_compress(data: *const u8, len: usize) -> i32;
}

pub fn compress(data: &[u8]) -> i32 {
    // SAFETY: c_compress reads exactly len bytes from a valid slice pointer
    unsafe { c_compress(data.as_ptr(), data.len()) }
}`,
      language: 'rust',
    },
    expected: [
      // rust-unsafe fires (no SAFETY excludePattern on that rule)
      { ruleId: 'rust-unsafe', line: 7, expectation: 'present' },
      // rust-unsafe-block has excludePattern /\/\/\s*SAFETY/ — suppressed
    ],
  },
]
