# Full Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and `superpowers:systematic-debugging`. Independent tasks may run in parallel, but workers must edit only their assigned paths.

**Goal:** Close every validated correctness, security, performance, state-isolation, responsive-layout, and accessibility finding from the 2026-08-23 full review.

**Architecture:** Preserve RepoLens's client-side repository model while making every content consumer explicitly aware of complete versus resident-only stores. Add operation identity to asynchronous state, enforce resource limits at shared boundaries, upgrade vulnerable direct dependencies, and use existing Radix primitives for accessible interaction patterns.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, pnpm, IndexedDB, fflate, Mermaid.

**Spec:** This document's Global Constraints and task requirements restate the validated review findings.

## Global Constraints

- Use strict TDD: add a focused regression test and observe the expected failure before modifying production code.
- Preserve current public APIs unless a task explicitly introduces a backward-compatible optional field.
- Do not weaken authentication, validation, type safety, CSP, cache isolation, or repository coverage reporting.
- Do not add a production dependency unless the task requires a patched version of an existing dependency.
- Use request generations or `AbortController`; do not hide stale results with delays or broad catches.
- Treat unavailable dependency, CVE, or repository content as unknown/partial, never as healthy or complete.
- Keep the shared worktree uncommitted; the primary agent owns final integration and verification.

---

### Task 1: Content tiers, search bounds, AST cache, and dependency truthfulness

**Files:**
- Modify: `lib/code/code-index.ts`, `lib/code/content-store.ts`, `lib/ai/structural-index.ts`
- Modify: `lib/code/scanner/scanner.ts`, `lib/code/scanner/ast-parser.ts`, `lib/code/scanner/cve-lookup.ts`
- Modify: `lib/github/indexing-pipeline.ts`, `lib/cache/repo-cache.ts`
- Modify: `lib/deps/health-scorer.ts`, `lib/deps/types.ts`, `components/features/deps/deps-panel.tsx`
- Test: co-located `*.test.ts`/`*.test.tsx` files for each changed boundary

**Interfaces:**
- Produce bounded/partial search results carrying `unsearchedPaths` and truncation metadata.
- Produce async dependency extraction that hydrates only package manifests and supported lockfiles.
- Produce dependency-health values that distinguish `known` from `unknown` signals.

- [x] **Step 1: Add failing content-tier tests**

```ts
it('hydrates only requested lazy paths and reports the rest as unsearched', async () => {
  const result = await searchIndexAsync(indexWithResidentOnlyStore, 'needle', { maxMatches: 10 })
  expect(result.results).toHaveLength(1)
  expect(result.unsearchedPaths).toEqual(['src/not-resident.ts'])
})

it('parses dependencies from an IDB-backed package manifest', async () => {
  expect(await parseDependenciesAsync(idbIndex)).toContainEqual(
    expect.objectContaining({ name: 'react', requestedRange: '^19.0.0' }),
  )
})
```

- [x] **Step 2: Run the focused tests and confirm they fail because current bulk hydration throws and dependency parsing skips absent inline content**

```powershell
pnpm vitest run lib/code/__tests__/code-index-lazy.test.ts lib/code/__tests__/lazy-bulk-hydration.test.ts lib/code/__tests__/search-partial.test.ts lib/code/scanner/cve-lookup.test.ts --pool=forks --maxWorkers=1
```

- [x] **Step 3: Implement bounded, partial content operations**

```ts
export interface SearchLimits {
  maxMatches?: number
  maxMatchesPerFile?: number
  signal?: AbortSignal
}

export interface AsyncSearchResult {
  results: SearchResult[]
  unsearchedPaths: string[]
  truncated: boolean
}
```

Use targeted `contentStore.get(path)` calls in bounded batches for lazy stores. Preserve missing-path coverage instead of throwing. Keep synchronous in-memory search internal and apply global/per-file limits while scanning.

- [x] **Step 4: Add a failing catastrophic-regex test and move user regex execution off the main thread or reject unsafe patterns**

```ts
expect(() => buildSearchRegex('(a+)+$', { regex: true })).toThrow(/unsafe regular expression/i)
```

Use a conservative safe-regex validator implemented locally; fall back to literal search in the UI and return a warning in AI tools. Enforce cancellation, maximum matches, and maximum line length before regex execution.

- [x] **Step 5: Add a failing equal-length AST-cache test, then key cache entries by language plus a stable content hash**

```ts
expect(identifierNames(getAST(file('src/a.ts', 'const bb = 2')))).toContain('bb')
expect(identifierNames(getAST(file('src/a.ts', 'const bb = 2')))).not.toContain('aa')
```

- [x] **Step 6: Add failing dependency confidence/version tests**

```ts
expect(computeDependencyHealth(null, { status: 'unknown' }, { status: 'unknown' })).toEqual({
  score: null,
  grade: null,
  confidence: 'unknown',
})
expect(resolvePackageVersions(manifestRangeOnly)).toEqual(
  expect.arrayContaining([expect.objectContaining({ installedVersion: null })]),
)
```

Retain requested ranges, resolve exact versions only from lockfiles, keep distinct `(name, version, workspace)` tuples, and propagate npm/OSV errors to the UI. Never substitute the current date or zero CVEs after a failed request.

- [x] **Step 7: Restore cached line totals from persisted metadata**

```ts
expect(batchIndexMetadataOnly(index, [{ path: 'a.ts', lineCount: 12 }]).totalLines).toBe(12)
```

- [x] **Step 8: Run all owning tests**

```powershell
pnpm vitest run lib/code lib/deps components/features/deps lib/cache --pool=forks --maxWorkers=1
```

### Task 2: Repository-scoped state and asynchronous operation identity

**Files:**
- Modify: `providers/comparison-provider.tsx`, `providers/tours-provider.tsx`, `providers/pr-review-provider.tsx`
- Modify: `providers/github-token-provider.tsx`, `providers/api-keys-provider.tsx`
- Modify: `hooks/use-git-history.ts`, `lib/code/scanner/ai-validator.ts`
- Modify: `lib/ai/tool-call-handler.ts`
- Test: corresponding provider, hook, scanner, and tool-handler tests

**Interfaces:**
- Every asynchronous operation owns a monotonically increasing generation or abort signal.
- Tour state is keyed by the active repository and clears synchronously on repository changes.
- AI `readFile` fallback uses the authenticated proxy and honors line ranges.

- [x] **Step 1: Add failing comparison lifecycle tests**

```ts
it('retries an error entry in place', async () => {
  await actions.retryRepo('owner/repo')
  expect(state.repos.get('owner/repo')?.status).toBe('ready')
})

it('does not resurrect a removed in-flight repository', async () => {
  actions.removeRepo('owner/repo')
  deferredTree.resolve(tree)
  expect(state.repos.has('owner/repo')).toBe(false)
})
```

- [x] **Step 2: Reserve comparison slots atomically and guard commits by operation ID**

Maintain a ref-backed current map and a per-repository `{ generation, controller }`. Retry replaces the generation in place; remove and clear abort operations and invalidate their generations.

- [x] **Step 3: Add failing tour repository-switch tests and scope tour state**

```ts
rerender(<Harness repoKey="owner/b" />)
expect(result.current.activeTour).toBeNull()
expect(result.current.tours).toEqual([])
oldLoad.resolve([tourForA])
expect(result.current.tours).toEqual([])
```

- [x] **Step 4: Add stale-response tests for PRs, Git history, and credentials**

```ts
newer.resolve(newerValue)
older.resolve(olderValue)
expect(result.current.value).toEqual(newerValue)
```

Use request generations keyed by repository/filter/path/SHA/provider. A stale result may settle its own promise but must not mutate state, metadata, validity, or loading state.

- [x] **Step 5: Scope AI-validation cache by repository session and content hash**

```ts
expect(await validateIssue(issue, contextB)).not.toEqual(cachedVerdictFromContextA)
```

- [x] **Step 6: Route AI file fallback through `fetchFileViaProxy` and apply `startLine`/`endLine`**

```ts
expect(toolOutput.content).toBe('line 3\nline 4')
expect(proxyFetch).toHaveBeenCalledWith(owner, repo, branch, path, expect.anything())
```

- [x] **Step 7: Run owning tests**

```powershell
pnpm vitest run providers hooks lib/ai lib/code/scanner/ai-validator.test.ts --pool=forks --maxWorkers=1
```

### Task 3: Security boundaries, dependency upgrades, and resource ceilings

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `components/ui/markdown-renderer.tsx`, `components/features/diagrams/mermaid-diagram.tsx`
- Modify: `next.config.mjs`
- Modify: `lib/api/rate-limit.ts`, `app/api/deps/route.ts`, `app/api/github/file/route.ts`, `app/api/github/zipball/route.ts`
- Modify: `lib/github/fetcher.ts`, `lib/github/zipball.ts`, GitHub route callers that discard `request.signal`
- Modify: `lib/auth/token.ts`, `lib/auth/config.ts`, `app/api/models/google/route.ts`
- Modify: `lib/cache/repo-cache.ts`, `providers/github-token-provider.tsx`, `components/features/auth/user-menu.tsx`
- Test: affected route, renderer, archive, auth, and cache tests

**Interfaces:**
- AI Markdown remote images are blocked unless a user explicitly opens the URL.
- All GitHub/npm proxy paths enforce endpoint-specific byte/cost limits and cancellation.
- Private cache records carry a credential-principal namespace or are cleared on credential removal/sign-out.

- [x] **Step 1: Add a failing Markdown remote-image test**

```tsx
render(<MarkdownRenderer content="![secret](https://attacker.invalid/leak)" />)
expect(screen.queryByRole('img')).not.toBeInTheDocument()
expect(screen.getByRole('link', { name: /remote image blocked/i })).toBeInTheDocument()
```

Implement an `img` override that never triggers an automatic cross-origin request. Tighten `img-src` to required hosts and local/data/blob sources.

- [x] **Step 2: Upgrade vulnerable direct dependencies and verify compatibility**

```powershell
pnpm update next@^16.2.11 next-auth@5.0.0-beta.32 @auth/core@^0.41.3 mermaid@^11.16.1
```

Keep the existing package manager and inspect the lockfile diff. Preserve GitHub-only authentication semantics.

- [x] **Step 3: Add failing malformed-Bearer and Mermaid sanitization tests**

```ts
expect(await getAccessToken(requestWithBearer('%'))).toBeUndefined()
expect(sanitizeMermaidSource('classDef x fill:url(https://evil.invalid)')).not.toContain('url(')
```

Catch malformed header resolution at the shared token boundary. Reject Mermaid directives and CSS constructs that can load or affect content outside the diagram; retain ordinary diagrams.

- [x] **Step 4: Add failing endpoint cost and response-size tests**

```ts
expect(postDeps({ packages: Array(21).fill('react') }).status).toBe(422)
expect(await getLargeFileResponse()).toMatchObject({ status: 413 })
expect(await proxyLargeZipball()).toMatchObject({ status: 413 })
```

Deduplicate package names, lower the batch ceiling, use a cost-weighted policy, reject oversized `Content-Length`, and use bounded streaming readers when the length is absent.

- [x] **Step 5: Add failing ZIP decompression-accounting tests**

```ts
expect(onSkipped).toHaveBeenCalledWith('src/bomb.ts', 'oversized')
expect(result.totalSize).toBeLessThanOrEqual(maxTotalSize)
```

Check `originalSize`, count every output byte before skip logic, terminate the file stream at the per-file limit, and cancel the response reader at the global limit. Measure UTF-8 bytes rather than JavaScript character count.

- [x] **Step 6: Propagate request cancellation through GitHub fetchers**

Every route passes `request.signal`; every fetch helper combines that signal with its timeout. Tests abort a request and assert the upstream mock observes the signal.

- [x] **Step 7: Stop putting the Google key in the URL and reduce GitHub scope guidance**

```ts
expect(fetchUrl).not.toContain(apiKey)
expect(fetchInit.headers).toMatchObject({ 'x-goog-api-key': apiKey })
```

Use `read:user` plus the least-privilege repository mechanism supported by the product. Update help text to recommend fine-grained read-only PATs.

- [x] **Step 8: Add principal-aware private-cache cleanup tests**

```ts
await removeToken()
expect(await listCachedRepos()).not.toContainEqual(expect.objectContaining({ visibility: 'private' }))
```

Record repository visibility/principal when known. Clear private entries and active private state on token removal and sign-out without deleting public caches.

- [x] **Step 9: Run owning tests and production audit**

```powershell
pnpm vitest run app/api lib/api lib/github lib/auth lib/cache components/ui components/features/diagrams --pool=forks --maxWorkers=1
pnpm audit --prod
```

### Task 4: Responsive code browsing and keyboard-accessible interaction

**Files:**
- Modify: `components/features/code/code-browser.tsx`, `components/features/code/code-activity-bar.tsx`
- Modify: `components/features/code/code-tab-bar.tsx`, `components/features/code/file-tree-node.tsx`
- Modify: `components/features/preview/global-search-overlay.tsx`, `components/features/preview/preview-panel.tsx`
- Modify: `components/features/diagrams/mermaid-toolbar.tsx`, `components/ui/markdown-renderer.tsx`
- Modify: `playwright.config.ts`, `e2e/app.spec.ts` or a focused new E2E file
- Test: corresponding component tests

**Interfaces:**
- Below the mobile breakpoint, the code sidebar is a dismissible overlay and the editor retains the viewport width.
- Code tabs implement `tablist`/`tab`; the tree implements roving focus and standard arrow/Home/End behavior.
- Global search uses the existing Dialog primitive and restores focus to its opener.

- [x] **Step 1: Add failing mobile layout tests**

```tsx
setViewportWidth(375)
render(<CodeBrowser />)
expect(screen.getByRole('button', { name: /open explorer/i })).toBeVisible()
expect(screen.queryByTestId('desktop-code-sidebar')).not.toBeVisible()
```

- [x] **Step 2: Implement the mobile sidebar as an overlay/drawer**

Reuse the repository's `Sheet` primitive and retain the resizable desktop sidebar at the existing breakpoint.

- [x] **Step 3: Add failing tab and tree keyboard tests**

```tsx
await user.keyboard('{ArrowRight}')
expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('b.ts')
await user.keyboard('{End}')
expect(lastTreeItem).toHaveFocus()
```

Implement roving `tabIndex`, `aria-selected`, `aria-expanded`, arrow navigation, Home/End, Enter/Space activation, accessible action names, and `focus-visible` disclosure.

- [x] **Step 4: Replace the search overlay with the existing Dialog primitive**

```tsx
await user.click(openSearch)
expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
await user.keyboard('{Escape}')
expect(openSearch).toHaveFocus()
```

- [x] **Step 5: Reveal Mermaid actions for keyboard and coarse-pointer users**

Use `group-focus-within`/`focus-visible` and keep essential controls visible under coarse-pointer media behavior.

- [x] **Step 6: Add a mobile Playwright project and focused navigation test**

```ts
projects: [
  { name: 'chromium', use: devices['Desktop Chrome'] },
  { name: 'mobile-chromium', use: devices['Pixel 5'] },
]
```

- [x] **Step 7: Run owning tests**

```powershell
pnpm vitest run components/features/code components/features/preview components/features/diagrams --pool=forks --maxWorkers=1
pnpm test:e2e --project=mobile-chromium
```

### Task 5: Integrated verification and final review

**Files:**
- Inspect: all modified files and tests
- No new production interfaces unless required to fix an integration failure

- [x] **Step 1: Review the complete diff for unrelated changes and overlapping edits**

```powershell
git status --short
git diff --check
git diff --stat
```

- [x] **Step 2: Run static and focused verification**

```powershell
pnpm lint
pnpm typecheck
pnpm test:unit
```

- [x] **Step 3: Run the production build and E2E suite**

```powershell
pnpm build
pnpm test:e2e
```

- [x] **Step 4: Re-run the production dependency audit and manually verify each original trigger plus a legitimate control**

```powershell
pnpm audit --prod
```

- [x] **Step 5: Perform a whole-diff correctness and security review**

Verify every item in Tasks 1-4 has a regression test, the test failed before its fix, the final test passes, and no unresolved Critical or High review issue remains.
