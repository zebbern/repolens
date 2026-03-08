---
id: git-analysis
name: Git Analysis
description: Methodology for git history analysis, blame patterns, and contribution analysis
trigger: When asked to analyze git history, contributor patterns, change frequency, or code ownership
relatedTools:
  - getGitHistory
  - readFile
---

## Prerequisites

Ensure the `getGitHistory` tool is available before proceeding. This tool requires a connected GitHub repository. If not available, inform the user that git analysis requires a repository connection.

## Methodology

Follow this structured approach for git history analysis.

### Phase 1: Recent Activity Overview

1. Call `getGitHistory` with mode `commits` to get recent commit history
2. Identify the commit frequency and recency of changes
3. Note the active contributors and their commit patterns
4. Look for patterns in commit messages (conventional commits, ticket references)

### Phase 2: Targeted Analysis

Based on the user's question, focus on the relevant analysis type:

**Change Frequency Analysis**
- Use `getGitHistory` with mode `commits` and filter by file path to see how often specific files change
- Identify hotspots — files that change most frequently
- Look for files that always change together (coupling indicators)
- Note files that haven't changed recently (potential tech debt or stable modules)

**Code Ownership Analysis**
- Use `getGitHistory` with mode `blame` on key files to see line-by-line authorship
- Identify primary owners for each module or directory
- Look for knowledge silos (files with only one contributor)
- Note bus factor risks (critical code owned by a single person)

**Commit Detail Analysis**
- Use `getGitHistory` with mode `commit-detail` to inspect specific commits
- Review the changed files and diff statistics
- Understand the scope and impact of individual changes
- Correlate related commits that form a logical change set

### Phase 3: Pattern Recognition

Analyze the git history for meaningful patterns:

**Development Patterns**
- Are commits small and focused, or large and mixed?
- Is there a consistent branching strategy visible?
- Are there regular release patterns (tags, version bumps)?

**Collaboration Patterns**
- How many contributors are active?
- Are there review patterns visible (merge commits, co-authored-by)?
- Is work distributed evenly or concentrated?

**Code Evolution**
- Which areas of the codebase are actively evolving?
- Which areas are stable or potentially abandoned?
- Are there refactoring patterns (renames, moves, restructuring)?

### Phase 4: Contextual Code Review

For files identified as interesting from git analysis:
1. Use `readFile` to read the current state of key files
2. Compare current code with git history insights
3. Note if recent changes introduced complexity or simplified code
4. Identify if heavily-changed files need refactoring

### Phase 5: Report

Structure findings based on the analysis type:

**For Change Frequency Reports**
- Top 10 most frequently changed files
- Change frequency by directory or module
- Coupling analysis (files that change together)
- Stability analysis (unchanged files)

**For Code Ownership Reports**
- Primary maintainers by module
- Knowledge distribution heat map
- Bus factor assessment
- Recommendations for knowledge sharing

**For Commit Analysis Reports**
- Summary of analyzed commits
- Impact assessment of changes
- Pattern observations
- Recommendations based on findings

### General Report Guidelines
- Always include specific file paths and commit references
- Use tables for structured data (file paths, counts, contributors)
- Highlight actionable insights over raw data
- Note any limitations (e.g., partial history, missing branches)
