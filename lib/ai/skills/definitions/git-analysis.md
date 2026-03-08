---
id: git-analysis
name: Git Analysis
description: Git history analysis with quantitative thresholds for hotspot detection, bus factor risk, file coupling, and code churn. Identifies ownership patterns, knowledge silos, and architectural evolution.
trigger: When asked to analyze git history, contributor patterns, change frequency, or code ownership
relatedTools:
  - getGitHistory
  - readFile
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# Git Analysis

## Purpose

Analyzes git history to reveal development patterns, code ownership, change hotspots, and collaboration dynamics. The analysis applies quantitative thresholds to classify findings by severity — distinguishing meaningful signals from noise (auto-generated files, formatting changes). The user receives actionable insights about code quality risks, knowledge silos, and areas that need refactoring or knowledge sharing.

## Prerequisites

Ensure the `getGitHistory` tool is available before proceeding. This tool requires a connected GitHub repository. If not available, inform the user that git analysis requires a repository connection. The `readFile` tool is used for contextual code review of flagged files.

## Methodology

Follow this structured approach for git history analysis.

### Phase 1: Recent Activity Overview

1. Call `getGitHistory({ mode: 'commits', path: '' })` to get recent commit history across the full repository
2. Default to the last **90 days** unless the user specifies a different time range
3. Identify the commit frequency and recency of changes
4. Note the active contributors and their commit patterns
5. Look for patterns in commit messages (conventional commits, ticket references)

**Verification**: Before proceeding to analysis, confirm the history contains sufficient data. If fewer than 10 commits in range, expand the window or inform the user of limited data.

### Phase 2: Targeted Analysis

Based on the user's question, focus on the relevant analysis type:

#### Change Frequency Analysis

- Use `getGitHistory({ mode: 'commits', path: '<file_or_dir>' })` to see how often specific files change
- Identify hotspots — files that change most frequently
- Look for files that always change together (coupling indicators)
- Note files that haven't changed recently (potential tech debt or stable modules)

#### Code Ownership Analysis

- Use `getGitHistory({ mode: 'blame', path: '<file>' })` on key files to see line-by-line authorship
- Identify primary owners for each module or directory
- Look for knowledge silos (files with only one contributor)
- Note bus factor risks (critical code owned by a single person)

#### Commit Detail Analysis

- Use `getGitHistory({ mode: 'commit-detail', ref: '<sha>' })` to inspect specific commits
- Review the changed files and diff statistics
- Understand the scope and impact of individual changes
- Correlate related commits that form a logical change set

### Phase 3: Pattern Recognition with Quantitative Thresholds

Apply these thresholds to classify findings. **Before reporting a finding, verify it by checking whether the changes are meaningful (not formatting, auto-generation, or lock file updates).**

#### Hotspot Detection

| Metric | Threshold (90 days) | Classification |
| ------ | ------------------- | ------------- |
| Changes to a single file | >10 | Active hotspot — review for complexity |
| Changes to a single file | 5-10 | Warm file — monitor |
| Changes to a single file | <5 | Stable |

#### Bus Factor Risk

| Metric | Threshold | Classification |
| ------ | --------- | ------------- |
| Contributors with blame on a file | 1 | Critical bus factor risk |
| Contributors with blame on a file | 2 | Elevated risk — cross-train |
| Contributors with blame on a file | 3+ | Healthy |

#### File Coupling

| Metric | Threshold | Classification |
| ------ | --------- | ------------- |
| Files that change together | >70% of commits | Tightly coupled — may need merging or explicit interface |
| Files that change together | 40-70% of commits | Moderate coupling — review dependency |
| Files that change together | <40% | Independent |

#### Code Churn

| Metric | Threshold (30 days) | Classification |
| ------ | ------------------- | ------------- |
| Reversals/rewrites on same file | >3 | Churn indicator — unstable requirements or design issue |
| Reversals/rewrites on same file | 2-3 | Mild churn — monitor |
| Reversals/rewrites on same file | 0-1 | Normal |

### Phase 4: Contextual Code Review

For files identified as interesting from git analysis:

1. Use `readFile` to read the current state of key files
2. Compare current code with git history insights
3. Note if recent changes introduced complexity or simplified code
4. Identify if heavily-changed files need refactoring
5. **Verify**: Confirm hotspots reflect meaningful changes, not auto-formatting or generated output

### Phase 5: Report

Structure findings based on the analysis type:

#### For Change Frequency Reports

- Top 10 most frequently changed files (with change count and last modified date)
- Change frequency by directory or module
- Coupling analysis (files that change together, with co-change percentage)
- Stability analysis (unchanged files)

#### For Code Ownership Reports

- Primary maintainers by module (contributor name, line count, percentage)
- Knowledge distribution heat map
- Bus factor assessment (files with single contributor)
- Recommendations for knowledge sharing

#### For Commit Analysis Reports

- Summary of analyzed commits
- Impact assessment of changes (files affected, lines changed)
- Pattern observations
- Recommendations based on findings

#### General Report Guidelines

- Always include specific file paths and commit references
- Use tables for structured data (file paths, counts, contributors)
- Highlight actionable insights over raw data
- Note any limitations (e.g., partial history, missing branches)

## Severity Classification

| Severity | Criteria | Example |
| -------- | -------- | ------- |
| **Critical** | Single-contributor ownership on critical path code, >15 changes in 90 days with increasing complexity | Core auth module with 1 contributor and 18 changes |
| **High** | Active hotspot (>10 changes) combined with bus factor risk, or >3 churn reversals | Payment processing file rewritten 4 times in 30 days |
| **Medium** | Bus factor = 1 on non-critical code, or tightly coupled files (>70% co-change) | Config parser known by only one developer |
| **Low** | Warm files (5-10 changes), moderate coupling (40-70%) | Utility module changing with moderate frequency |
| **Info** | Stable files, healthy ownership distribution, positive patterns | Well-distributed ownership across 4 contributors |

## Example Output

```markdown
### Finding: Active Hotspot with Bus Factor Risk — `lib/ai/chat-engine.ts`

- **Severity**: High
- **Metrics**:
  - 14 changes in the last 90 days (hotspot threshold: >10)
  - 1 contributor responsible for 96% of blame lines (bus factor: critical)
  - Average change size: 45 lines (non-trivial changes, not formatting)
- **Location**: `lib/ai/chat-engine.ts` — core module handling AI chat orchestration
- **Impact**: If the primary contributor is unavailable, no one else has deep knowledge of this rapidly-evolving module. The high change frequency suggests active development, increasing the risk of blocked work.
- **Verification**: Confirmed changes are meaningful (feature additions and bug fixes, not auto-generated or formatting). Reviewed 3 recent commits to validate.
- **Recommendation**:
  1. Schedule a knowledge-sharing session on the chat engine architecture
  2. Assign a second contributor to pair on the next 2-3 changes
  3. Add inline documentation for non-obvious design decisions
```

## Common False Positives

Skip or downgrade these patterns — they inflate metrics without indicating real risk:

1. **Auto-generated files**: Lock files (`pnpm-lock.yaml`, `package-lock.json`), build outputs (`dist/`, `.next/`), and generated types change frequently but don't indicate development problems
2. **Bulk formatting changes**: A Prettier or ESLint auto-fix run touching 50 files registers as a massive change but carries no architectural signal. Check commit messages for `style:`, `chore:`, or `format` keywords
3. **CI/CD config files**: Files like `.github/workflows/*.yml` or `Dockerfile` that change with every release are operational, not code quality concerns
4. **Dependency update commits**: Renovate/Dependabot PRs that bump versions in `package.json` are automated, not human development activity
5. **Initial scaffolding commits**: Large initial commits creating project structure shouldn't count toward change frequency analysis — filter out the first commit when measuring churn

## Related Skills

- For architecture context on heavily-changed areas (coupling, layer analysis), load `architecture-analysis`
- For security concerns in high-churn code (rushed changes may introduce vulnerabilities), load `security-audit`
