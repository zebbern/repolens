---
id: documentation-quality
name: Documentation Quality
description: Assess README completeness, code documentation coverage, API docs, inline comments, and developer onboarding experience
trigger: When asked to review documentation, check README quality, audit JSDoc coverage, assess developer experience, or evaluate onboarding documentation
relatedTools:
  - readFile
  - searchFiles
  - getProjectOverview
lastReviewed: "2026-03-08"
reviewCycleDays: 180
---

# Documentation Quality

## Purpose

Performs a systematic documentation quality audit measuring README completeness, public API documentation coverage, inline comment quality, architecture doc presence, and developer onboarding experience. The analysis applies quantitative thresholds to distinguish comprehensive documentation from gaps that slow onboarding and increase support burden. The user receives a prioritized list of documentation improvements with severity classification, measurable deficiencies, and specific content suggestions.

## Prerequisites

Ensure the `getProjectOverview` tool is available to understand project scope, tech stack, and directory structure. The `readFile` tool is required to inspect documentation files, source code comments, and configuration. Use `searchFiles` to locate documentation patterns across the codebase.

## Methodology

Follow this structured approach for every documentation quality audit. Complete each phase in order.

### Phase 1: README Assessment

1. Call `getProjectOverview` to understand the project type and scope
2. Read `README.md` (or equivalent) and evaluate against the completeness checklist:

| Section | Required | Weight | Notes |
| --------- | ---------- | -------- | ------- |
| Project description | Yes | High | What the project does in 1-2 sentences |
| Installation / Setup | Yes | High | Steps to get running locally |
| Usage / Quick start | Yes | High | Basic usage example or commands |
| Configuration | Conditional | Medium | Required if env vars or config files are needed |
| API Reference | Conditional | Medium | Required for libraries or services with public APIs |
| Contributing guide | Recommended | Low | Required for open-source projects |
| License | Yes | Medium | Must be present and match `package.json` |
| Badge / Status | Optional | Low | CI status, coverage, version badges |

1. Measure README length and content density:
   - Under 100 words: insufficient for any non-trivial project
   - 100–500 words: minimal — covers basics only
   - 500–2000 words: adequate for most projects
   - Over 2000 words: comprehensive — verify it stays current

**Verification**: Before flagging a missing section, check if the information exists in a separate file (e.g., `CONTRIBUTING.md`, `INSTALL.md`, `docs/` directory) and is linked from the README.

### Phase 2: Code Documentation Coverage

1. Use `searchFiles` to find public API surfaces:
   - Exported functions, classes, and constants in `lib/`, `src/`, or `utils/` directories
   - React component exports in `components/` directories
   - API route handlers in `app/api/` or `pages/api/`
2. For each public module, check for JSDoc/TSDoc comments on exported members:
   - Function description
   - `@param` tags for each parameter
   - `@returns` tag describing the return value
   - `@throws` tag for known error conditions
   - `@example` tag for non-obvious usage
3. Read flagged files with `readFile` and measure coverage ratio

#### Documentation Coverage Thresholds

| Metric | Threshold | Classification |
| -------- | ----------- | --------------- |
| Public function with > 5 params, no JSDoc | Any | Strong flag — complex interface needs docs |
| Public function with > 3 params, no JSDoc | Any | Flag — non-trivial interface |
| Module with > 20 exports, no doc comments | Any | Strong flag — high-surface API undocumented |
| Module with > 10 exports, no doc comments | Any | Flag — significant API undocumented |
| Public API coverage | < 25% | Critical — most of the API is undocumented |
| Public API coverage | 25%–50% | Low — significant gaps |
| Public API coverage | 50%–80% | Moderate — common paths covered |
| Public API coverage | > 80% | Good — comprehensive coverage |

**Verification**: Before flagging missing JSDoc, confirm the export is truly public API (consumed outside its own module), not an internal utility re-exported for testing convenience.

### Phase 3: API Documentation

1. Use `searchFiles` to locate API route handlers
2. For each endpoint, check for:
   - Route-level description (comment or documentation file)
   - Request body schema or validation (zod, yup, or documented types)
   - Response format documentation (TypeScript types or inline docs)
   - Error response codes and their meanings
   - Authentication requirements
3. Check for OpenAPI / Swagger specification if applicable

**Verification**: Before flagging undocumented API routes, check if TypeScript types on the request/response serve as self-documenting contracts. Strong typing with descriptive names may be sufficient for internal APIs.

### Phase 4: Inline Comment Quality

1. Use `searchFiles` to find files with high complexity (long functions, deep nesting)
2. Read those files and evaluate inline comments:
   - **Good comments**: Explain *why*, not *what* — business logic rationale, algorithm choices, workaround explanations, edge case documentation
   - **Bad comments**: Restate the code (`// increment counter`), outdated descriptions, commented-out code blocks
   - **Missing comments**: Complex regex patterns, non-obvious algorithms, business rules, magic numbers without explanation
3. Measure comment-to-code ratio in complex modules as a signal (not a target)

| Comment Pattern | Classification |
| ---------------- | --------------- |
| Explains business rule or constraint | Valuable — keep |
| Documents a non-obvious algorithm | Valuable — keep |
| Explains a workaround with issue link | Valuable — keep |
| Restates what the code does | Noise — remove or improve |
| Commented-out code (> 10 lines) | Dead code — remove |
| TODO/FIXME without issue reference | Tech debt — add tracking |

**Verification**: Do not enforce a minimum comment density. Well-named functions and clear types reduce the need for comments. Only flag missing comments on genuinely complex or non-obvious logic.

### Phase 5: Architecture Documentation

1. Search for architecture-level documentation files:
   - `ARCHITECTURE.md`, `AGENTS.md`, `DESIGN.md`
   - `docs/` or `doc/` directory
   - Architecture Decision Records (ADRs) in `docs/adr/` or `docs/decisions/`
2. Evaluate against the project's complexity:
   - Simple projects (< 20 files): README may suffice
   - Medium projects (20–100 files): `ARCHITECTURE.md` is recommended
   - Large projects (> 100 files): `ARCHITECTURE.md` + ADRs are strongly recommended
3. Check if diagrams exist for system architecture, data flow, or deployment

### Phase 6: Onboarding Assessment

1. Estimate time-to-first-contribution based on documentation quality:
   - Can a new developer set up the project in under 15 minutes from docs alone?
   - Are required environment variables documented with example values?
   - Is the test command documented and does it work without additional setup?
   - Are common troubleshooting steps documented?
2. Check for `.env.example` or equivalent environment template
3. Verify that `CONTRIBUTING.md` (if present) covers branch strategy, PR process, and code style

### Phase 7: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: README, Code Documentation, API Docs, Comments, Architecture, or Onboarding
3. **Location**: File path or section reference
4. **Description**: What documentation is missing or inadequate
5. **Impact**: How this affects developer productivity, onboarding speed, or maintenance burden
6. **Remediation**: Specific content to add, with templates where helpful

Provide an overall summary:

- Total findings by severity and category
- Documentation coverage score heuristic
- Top 3 highest-impact improvements
- Quick wins (missing descriptions, outdated sections)
- Positive signals: well-documented areas worth preserving

## Severity Classification

| Severity | Criteria | Example |
| ---------- | ---------- | --------- |
| **Critical** | No README or README with only a title, no setup instructions for a project requiring configuration | Empty `README.md` with just the project name |
| **High** | Public API with 0% documentation coverage, missing environment setup for project with required env vars | 15 exported functions in `lib/api/` with no JSDoc, no `.env.example` |
| **Medium** | Missing setup instructions, undocumented complex functions, no architecture docs for large project | Complex 80-line parsing function with no comments explaining the algorithm |
| **Low** | Outdated screenshots, missing badges, minor sections absent from README | Contributing guide references old branch naming convention |
| **Informational** | Documentation style inconsistencies, suggestion to add examples | Some JSDoc uses `@return` while others use `@returns` |

## Example Output

````markdown
### Finding: Undocumented Public API Surface

- **Severity**: High
- **Category**: Code Documentation
- **Location**: `lib/api/repository.ts` — 12 exported functions
- **Description**: The `repository.ts` module exports 12 public functions including `fetchRepository`, `parseGitHubUrl`, `getDefaultBranch`, and `resolveFileTree`. None have JSDoc comments. Three functions accept > 5 parameters with non-obvious configuration objects. The module is imported by 8 other files, making it a core API surface.
- **Impact**: New contributors must read the implementation of each function to understand its contract, expected input format, and error behavior. This increases onboarding time and raises the risk of misuse at every call site.
- **Remediation**: Add JSDoc with `@param`, `@returns`, and `@throws` to each export. Start with the 3 most-used functions:
  ```ts
  /**
   * Fetches repository metadata and file tree from the GitHub API.
   *
   * @param owner - GitHub organization or username
   * @param repo - Repository name
   * @param options - Fetch options including branch, depth, and auth token
   * @returns Resolved repository with metadata and file tree
   * @throws {GitHubApiError} When the repository is not found or rate-limited
   * @example
   * const repo = await fetchRepository("vercel", "next.js", { branch: "canary" });
   */
  ```
````

## Common False Positives

Skip or downgrade these patterns — they look like documentation gaps but are acceptable:

1. **Internal utility functions**: Private helpers not exported from the module boundary do not need JSDoc — clear naming suffices
2. **Auto-generated files**: Files generated by codegen tools (Prisma client, GraphQL types, OpenAPI stubs) are regenerated and should not have manual doc additions
3. **Type-only modules**: Files that export only TypeScript types/interfaces are self-documenting through their type definitions — JSDoc adds little value unless the type is complex
4. **Re-export barrels**: `index.ts` files that only re-export from other modules (`export * from './utils'`) do not need their own documentation
5. **Test helpers**: Functions in `test/`, `__tests__/`, or `*.test.*` files exist for test clarity, not public API consumption — documentation is optional
6. **Simple CRUD components**: Components with obvious behavior from props and naming (e.g., `UserAvatar`, `DeleteButton`) may not need doc comments

## Related Skills

- For reviewing API endpoint documentation and design consistency, load `api-design-review`
- For identifying complex code that most needs documentation, load `code-complexity`
- For architecture-level documentation assessment, load `architecture-analysis`
