---
id: pr-review
name: PR Review
description: Structured pull request code review with severity-classified findings, security analysis, and actionable improvement suggestions for each changed file.
trigger: When asked to review a pull request, analyze PR changes, or audit a diff
relatedTools:
  - reviewPRFile
  - readFile
  - searchFiles
  - scanIssues
lastReviewed: "2026-03-09"
reviewCycleDays: 180
standardsReferenced:
  - name: OWASP Top 10
    pinnedVersion: "2021"
---

# PR Review

## Purpose

Performs a structured code review of a pull request, analyzing each changed file's diff for bugs, security vulnerabilities, performance regressions, and code quality issues. Produces severity-classified findings with exact file locations and actionable fix suggestions.

## Prerequisites

Ensure the PR diff data is loaded before proceeding. The `reviewPRFile` tool should be available. For security-focused review, the `scanIssues` tool provides additional AST-based analysis. Use `readFile` to examine unchanged surrounding code for context.

## Methodology

Follow this structured approach for every PR review. Complete each phase in order.

### Phase 1: Understand Intent

1. Read the PR title and description to understand what the PR is trying to accomplish
2. Review the list of changed files to understand the scope
3. Identify the primary purpose: feature, bugfix, refactor, dependency update, or configuration change
4. Note any related issue numbers or references in the PR description

### Phase 2: File-by-File Review

For each changed file, ordered by change size (largest first):

1. Use `reviewPRFile` to analyze the diff patch
2. For non-trivial changes, use `readFile` to examine the full file for context
3. Check each change against these categories:

#### Bugs & Correctness
- Null/undefined access without guards
- Off-by-one errors in loops and array operations
- Missing error handling for async operations
- Type mismatches or incorrect type assertions
- Logic errors in conditionals

#### Security
- Injection vulnerabilities (SQL, XSS, command injection)
- Hardcoded secrets or credentials
- Missing input validation at boundaries
- Authentication/authorization gaps
- Unsafe deserialization

#### Performance
- N+1 queries or loops with I/O
- Missing memoization for expensive computations
- Unbounded data fetching (missing pagination/limits)
- Memory leaks (event listeners, subscriptions not cleaned up)

#### Code Quality
- Functions doing too many things (SRP violation)
- Duplicated logic that should be extracted
- Unclear naming or misleading variable names
- Missing or incorrect types
- TODO/FIXME without associated issue tracking

### Phase 3: Cross-Cutting Concerns

1. Check for consistency with existing codebase patterns
2. Verify test coverage for new functionality
3. Look for breaking changes to public APIs
4. Check import organization and unused imports
5. Verify error messages are actionable

### Phase 4: Summary

1. Group findings by severity (critical → warning → suggestion → praise)
2. Provide an overall assessment of code quality
3. State a clear verdict: approve, request changes, or comment
4. Highlight any particularly good patterns worth noting (praise)

## Finding Severity Guide

| Severity | Criteria | Examples |
|----------|----------|----------|
| critical | Bug or security issue that must be fixed before merge | SQL injection, null pointer crash, data loss |
| warning | Issue that should be addressed but doesn't block merge | Performance regression, missing edge case handling |
| suggestion | Improvement that would enhance code quality | Better naming, extract helper function, add type |
| praise | Good pattern worth acknowledging | Clean abstraction, thorough error handling, good tests |
