# AGENTS.md — RepoLens

## PROJECT_IDENTITY

**RepoLens** is an AI-powered GitHub repository analysis tool built with Next.js. Users paste a GitHub URL (or navigate to `mgithub.com/owner/repo`) to instantly browse code, scan for issues, generate documentation, create architecture diagrams, and chat with AI about any codebase. All processing happens client-side against an in-browser code index; users bring their own API keys.

## TECH_STACK

| Category | Technology | Version |
| -------- | --------- | ------- |
| Framework | Next.js (App Router) | 15.2.6 |
| Language | TypeScript | ^5 |
| UI Library | React | ^19 |
| Styling | Tailwind CSS | ^3.4.17 |
| Component Library | shadcn/ui + Radix UI | Multiple primitives |
| AI SDK | Vercel AI SDK (`ai`) | ^6.0.108 |
| AI Providers | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | ^3.x |
| Auth | NextAuth (next-auth) | 5.0.0-beta.30 |
| AST Parsing | `@babel/parser`, `@babel/traverse` | ^7.29.x |
| Diagrams | Mermaid.js | ^11.4.0 |
| Syntax Highlighting | Shiki | ^4.0.1 |
| Markdown | react-markdown | ^10.1.0 |
| Markdown plugins | remark-gfm, rehype-raw | ^4.0.1 / ^7.0.0 |
| Forms | react-hook-form + zod | ^7.60 / 3.25.x |
| Charts | Recharts | 2.15.4 |
| Icons | lucide-react | ^0.454.0 |
| Archive Handling | JSZip | ^3.10.1 |
| Package Manager | pnpm | — |
| Unit Testing | Vitest + Testing Library | ^4.0.18 |
| E2E Testing | Playwright | ^1.58.2 |
| Analytics | @vercel/analytics | ^1.6.1 |

## STRUCTURE

```text
workproject/                    # Next.js application root
├── app/                        # App Router pages and API routes
│   ├── layout.tsx              # Root layout (fonts, metadata, Providers wrapper)
│   ├── page.tsx                # Home page — chat sidebar + preview panel
│   ├── error.tsx               # Global error boundary
│   ├── not-found.tsx           # 404 page
│   ├── loading.tsx             # Global loading fallback
│   ├── globals.css             # CSS variables, Tailwind base, theme tokens
│   ├── compare/                # Repository comparison page
│   └── api/                    # API route handlers
│       ├── auth/               # NextAuth routes (GitHub OAuth)
│       ├── changelog/          # AI changelog generation endpoint
│       ├── chat/               # AI chat streaming endpoint
│       ├── deps/               # Dependency health endpoint
│       ├── docs/               # AI documentation generation endpoint
│       ├── github/             # GitHub API proxy routes (blame, commits, tags, branches, compare, zipball)
│       ├── inline-actions/     # Inline code action AI endpoint
│       ├── issues/             # Issues-related API routes
│       └── models/             # AI model listing endpoint
├── components/
│   ├── layout/                 # App shell — header, resizable split layout
│   ├── ui/                     # shadcn/ui primitives (button, dialog, card, etc.)
│   ├── theme-provider.tsx      # Dark/light theme toggle
│   └── features/               # Feature-specific components
│       ├── auth/               # Login button, user menu
│       ├── changelog/          # AI changelog generator
│       │   ├── changelog-viewer.tsx # Main viewer with history sidebar
│       │   ├── new-changelog-view.tsx # Generation form with ref/quality selectors
│       │   └── changelog-helpers.tsx # Shared sub-components
│       ├── chat/               # Chat sidebar, message display, input, model selector
│       ├── code/               # Code browser, file tree, syntax viewer
│       ├── compare/            # Side-by-side repo comparison UI
│       ├── deps/               # Dependency health dashboard
│       │   ├── deps-panel.tsx      # Main deps container
│       │   ├── deps-summary.tsx    # Overall health summary
│       │   ├── deps-table.tsx      # Sortable package table
│       │   ├── deps-detail-drawer.tsx # Package detail drawer
│       │   ├── health-badge.tsx    # A-F health grade badge
│       │   └── download-sparkline.tsx # Download trend sparkline chart
│       ├── diagrams/           # Mermaid diagram viewer/generator
│       ├── docs/               # Documentation viewer
│       ├── export/             # Export menu (markdown, JSON, clipboard, URL)
│       ├── files/              # File explorer, search, outline
│       ├── git-history/        # Git history and blame explorer
│       │   ├── git-history-panel.tsx # Main container with view switching
│       │   ├── blame-view.tsx      # Line-by-line blame with age heatmap
│       │   ├── commit-timeline.tsx # Commit list grouped by date
│       │   ├── file-history-list.tsx # File-specific commit history
│       │   ├── commit-detail-view.tsx # Commit detail with unified diffs
│       │   └── git-history-helpers.tsx # AuthorAvatar, CommitRow, DiffStats
│       ├── issues/             # Issue scanner results display
│       ├── landing/            # Landing page hero/CTA
│       ├── loading/            # Loading skeletons and progress indicators
│       ├── preview/            # Main preview panel (tab-based content area)
│       ├── repo/               # Repository info display
│       └── settings/           # Settings modal (API keys, preferences)
├── providers/                  # React Context providers
│   ├── index.tsx               # Composed provider tree (see ARCHITECTURE)
│   ├── api-keys-provider.tsx   # API key storage/validation (localStorage)
│   ├── repository-provider.tsx # Repo fetching, file indexing, code index state
│   ├── tours-provider.tsx      # Tour CRUD and playback state
│   ├── docs-provider.tsx       # Documentation generation state
│   ├── changelog-provider.tsx  # Changelog generation state (split contexts)
│   ├── app-provider.tsx        # Global app state (active tab, selected file, etc.)
│   └── comparison-provider.tsx # Comparison feature state
├── lib/                        # Core business logic (non-UI)
│   ├── utils.ts                # cn() helper (clsx + tailwind-merge)
│   ├── ai/                     # AI integration
│   │   ├── providers.ts        # AI model factory (OpenAI, Anthropic, Google, OpenRouter)
│   │   ├── tool-definitions.ts # Vercel AI SDK tool declarations (no execute — client-side)
│   │   ├── tool-schemas.ts     # Zod schemas for tool inputs
│   │   ├── client-tool-executor.ts  # Client-side tool execution against CodeIndex
│   │   ├── tool-call-handler.ts # Bridges useChat tool calls to executeToolLocally
│   │   ├── structural-index.ts # Structural summary builder for AI context
│   │   └── context-compactor.ts # Context window management
│   ├── auth/                   # NextAuth config (GitHub OAuth provider)
│   ├── cache/                  # Caching infrastructure
│   │   ├── repo-cache.ts       # IndexedDB repo caching (v2, includes tours store)
│   │   ├── tour-cache.ts       # IndexedDB tour CRUD operations
│   │   └── memory-cache.ts     # In-memory FIFO cache with TTL and SWR
│   ├── changelog/              # Changelog generation
│   │   ├── types.ts            # Changelog types and presets
│   │   ├── preset-config.ts    # 4 changelog presets
│   │   ├── prompt-builder.ts   # AI prompt construction
│   │   └── index.ts            # Barrel exports
│   ├── code/                   # Code analysis engine
│   │   ├── code-index.ts       # In-memory file index (search, symbol lookup)
│   │   ├── import-parser.ts    # Dependency graph analysis
│   │   ├── issue-scanner.ts    # Issue scanning orchestrator
│   │   ├── parser/             # Language-specific AST parsers
│   │   └── scanner/            # Security/quality scanner (268+ rules)
│   │       ├── scanner.ts            # Main scanner entry
│   │       ├── rules-security.ts     # Security vulnerability rules
│   │       ├── rules-security-lang.ts # Language-specific security rules
│   │       ├── rules-quality.ts      # Code quality rules
│   │       ├── rules-framework.ts    # Framework-specific rules
│   │       ├── rules-composite.ts    # Multi-file composite rules
│   │       ├── ast-analyzer.ts       # AST-based analysis
│   │       ├── ast-parser.ts         # AST parsing and caching
│   │       ├── taint-tracker.ts      # Taint tracking for data flow
│   │       ├── cve-lookup.ts         # CVE database matching
│   │       ├── compliance-matrix.ts  # OWASP/CWE compliance mapping
│   │       ├── structural-scanner.ts # Structural code analysis (circular deps, coupling)
│   │       ├── supply-chain-scanner.ts # Dependency/supply chain analysis
│   │       ├── entropy.ts            # Shannon entropy for secret detection
│   │       ├── context-classifier.ts # Line context classification for FP reduction
│   │       ├── risk-scorer.ts        # CVSS-based risk scoring
│   │       ├── fix-generator.ts      # Code fix suggestion generation
│   │       ├── ai-validator.ts       # LLM-based finding validation
│   │       ├── constants.ts          # Shared constants (file filters, thresholds)
│   │       ├── types.ts              # Scanner type definitions
│   │       └── index.ts              # Barrel exports
│   ├── compare/                # Repository comparison logic
│   ├── deps/                   # Dependency health scoring
│   │   ├── types.ts            # Dependency health types
│   │   ├── health-scorer.ts    # Health scoring algorithm
│   │   ├── version-checker.ts  # Semver version comparison
│   │   ├── npm-client.ts       # npm registry API client
│   │   └── index.ts            # Barrel exports
│   ├── diagrams/               # Mermaid diagram generation
│   ├── export/                 # Export formats (markdown, JSON, clipboard, URL)
│   ├── git-history/            # Git history processing
│   │   ├── types.ts            # Internal blame/commit types
│   │   ├── blame-utils.ts      # Blame range expansion/stats
│   │   ├── commit-utils.ts     # Commit grouping/stats
│   │   ├── diff-utils.ts       # Unified diff parsing
│   │   └── index.ts            # Barrel exports
│   ├── github/                 # GitHub API client
│   │   ├── client.ts           # Authenticated GitHub API wrapper + cached proxy functions
│   │   ├── fetcher.ts          # Repo metadata, tree, file, blame, commit detail fetching
│   │   ├── graphql.ts          # GitHub GraphQL API utility
│   │   ├── validation.ts       # Shared GITHUB_NAME_RE constant
│   │   ├── parser.ts           # GitHub URL parsing
│   │   └── zipball.ts          # Zipball download and extraction
│   └── parsers/                # Language parsers (TypeScript AST)
├── hooks/                      # Custom React hooks
│   ├── use-changelog-engine.ts # Changelog generation lifecycle
│   ├── use-docs-engine.ts      # Documentation generation hook
│   ├── use-git-history.ts      # Git history state management
│   ├── use-mobile.ts           # Mobile breakpoint detection
│   └── use-toast.ts            # Toast notification hook
├── types/                      # Shared TypeScript type definitions
│   ├── types.ts                # Core app types (AI providers, API keys, etc.)
│   ├── repository.ts           # Repository-related types (FileNode, GitHubRepo)
│   ├── comparison.ts           # Comparison feature types
│   ├── tours.ts                # Tour and stop types
│   └── git-history.ts          # Blame and commit detail types
├── config/
│   └── constants.ts            # Layout and UI constants
├── test/
│   └── setup.ts                # Vitest global setup
├── e2e/
│   └── app.spec.ts             # Playwright E2E tests
├── middleware.ts                # URL rewriting (owner/repo → /?repo=...) + security headers
├── next.config.mjs             # Next.js config (CSP, image optimization, package imports)
├── tailwind.config.ts           # Tailwind config (custom colors, shadcn/ui theme)
├── tsconfig.json                # TypeScript config (strict, path alias @/*)
├── vitest.config.ts             # Vitest config (jsdom, path alias, coverage)
└── playwright.config.ts         # Playwright config (chromium, localhost:3000)
```

## CONVENTIONS

### File Organization

- **Feature-based grouping**: UI components live in `components/features/<feature>/`, business logic in `lib/<domain>/`.
- **Barrel exports**: Scanner and export modules use `index.ts` barrel files.
- **Co-located tests**: Test files sit next to their source (`*.test.ts`, `*.test.tsx`), except E2E tests in `e2e/`.
- **`__tests__/` folders**: Used for larger test suites within a module (e.g., `lib/code/scanner/__tests__/`).

### Naming

- **Components**: PascalCase files and exports (`ChatSidebar`, `PreviewPanel`).
- **Utilities/lib**: camelCase files and functions (`code-index.ts → createEmptyIndex()`).
- **Types**: PascalCase interfaces and types (`FileNode`, `GitHubRepo`, `CodeIndex`).
- **Constants**: UPPER_SNAKE_CASE (`SIDEBAR_CONFIG`, `DB_NAME`, `MAX_REPOS`).
- **CSS variables**: kebab-case with semantic names (`--text-primary`, `--interactive-hover`).

### Imports

- Path alias: `@/*` maps to the project root (`@/components/ui/button`, `@/lib/ai/providers`).
- Group order: React/Next.js → external packages → `@/` internal imports → relative imports.
- Prefer named imports over default imports (except for page/layout components).

### Component Patterns

- All page-level and interactive components use the `"use client"` directive.
- UI primitives (`components/ui/`) follow the shadcn/ui pattern: `cn()` for class merging, `cva()` for variants, `Slot` for composition.
- Feature components receive data via context providers, not prop drilling.
- Icons come from `lucide-react` exclusively.

### Styling

- Tailwind utility classes with the `cn()` helper for conditional merging.
- Semantic color tokens defined as CSS custom properties in `globals.css`, consumed via `hsl(var(--token-name))` in Tailwind config.
- Dark mode via `class` strategy (controlled by `next-themes`).
- No CSS modules or styled-components.

## ARCHITECTURE_DECISIONS

### Client-Side Tool Execution

AI tools (file reading, search, symbol lookup, issue scanning, diagram generation) are defined without `execute` functions in the Vercel AI SDK. The server streams tool call requests; the client executes them locally against the in-memory `CodeIndex`. This keeps all repository data client-side and avoids sending source code to the server.

### BYOK (Bring Your Own Key)

Users provide their own API keys for AI providers (OpenAI, Anthropic, Google, OpenRouter). Keys are stored in `localStorage` via `APIKeysProvider` and sent per-request to the API routes. No server-side key management.

### Provider Nesting Order

```text
SessionProvider → ThemeProvider → APIKeysProvider → RepositoryProvider → ToursProvider → DocsProvider → ChangelogProvider → AppProvider → ComparisonProvider
```

Each provider has a clear dependency chain. `RepositoryProvider` depends on no AI state; `ToursProvider` depends on repository context for file lookups; `DocsProvider` and `ChangelogProvider` depend on repository context; `AppProvider` provides global UI state; `ComparisonProvider` wraps children at the end of the chain.

### Repository Loading Pipeline

1. Parse GitHub URL → fetch metadata → fetch tree via API or zipball download
2. Extract files → build `CodeIndex` (in-memory search index) → cache in IndexedDB
3. On repeat visits, compare tree SHA to serve from cache (LRU, max 5 repos)

### URL Rewriting

Middleware rewrites `/:owner/:repo` paths to `/?repo=https://github.com/owner/repo`, enabling clean URLs like `mgithub.com/facebook/react`. Reserved segments (`api`, `_next`, `compare`, etc.) are excluded.

### Security Headers

Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) are applied in middleware. CSP is configured in `next.config.mjs` with `unsafe-inline`/`unsafe-eval` required for Mermaid rendering and Shiki WASM.

### Scanner Architecture

The issue scanner uses 268+ rules across four rule sets (security, quality, framework, composite). It supports AST-based analysis via Babel, taint tracking for data flow vulnerabilities, CVE lookup, and maps findings to OWASP Top 10 and CWE Top 25 standards.

### Provider Split Contexts

`ToursProvider`, `DocsProvider`, and `ChangelogProvider` use split contexts to minimize re-renders. State that changes infrequently (list of items, active ID) lives in one context; rapidly-changing streaming state (messages, status) lives in a second context. Components subscribe only to the context they need.

### GraphQL Blame

The GitHub REST API does not support blame. `lib/github/graphql.ts` provides a lightweight utility for GitHub GraphQL API calls, used by the `/api/github/blame` route to fetch line-by-line blame data via `repository.object.blame.ranges`.

### In-Memory SWR Cache

`lib/cache/memory-cache.ts` provides a FIFO cache with configurable TTL and stale-while-revalidate semantics. GitHub API proxy functions in `lib/github/client.ts` use it to cache responses, serving stale data immediately while revalidating in the background. Max 100 entries with 5-minute TTL and 1-minute SWR window by default.

## BUILD_AND_TEST

### Prerequisites

- Node.js 22+
- pnpm

### Commands

| Command | Description |
| ------- | ----------- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start dev server (localhost:3000) |
| `pnpm build` | Production build (cleans `.next` first via rimraf) |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with V8 coverage |
| `pnpm test:ui` | Open Vitest UI |
| `pnpm test:e2e` | Run Playwright E2E tests (starts dev server automatically) |

### Environment Variables

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth (optional, for authenticated API access)
- `AUTH_SECRET` — NextAuth secret
- `NEXT_PUBLIC_AUTH_ENABLED` — Set to `"true"` to show the login button

### Test Configuration

- **Unit tests (Vitest)**: jsdom environment, `@/` path alias, files matched from `lib/`, `app/`, `components/`, `hooks/`, `providers/`, `types/`. Setup in `test/setup.ts`.
- **E2E tests (Playwright)**: Chromium only, tests in `e2e/`, auto-starts dev server on port 3000.
- **Coverage**: V8 provider, reporters: text, lcov, json-summary.

## KEY_PATTERNS

### Adding a New AI Tool

1. Define the Zod input schema in `lib/ai/tool-schemas.ts`.
2. Add the tool declaration (no `execute`) in `lib/ai/tool-definitions.ts`.
3. Implement local execution in `lib/ai/client-tool-executor.ts`.
4. The tool is automatically available to both chat and docs AI routes.

### Adding a New Scanner Rule

1. Add the rule to the appropriate rule file in `lib/code/scanner/` (`rules-security.ts`, `rules-quality.ts`, `rules-framework.ts`, or `rules-composite.ts`).
2. Each rule implements the `ScanRule` interface with `id`, `severity`, `category`, `pattern`/`check`, and `message`.
3. Rules are auto-discovered by `getAllRules()` in `scanner.ts`.

### Adding a New Provider

1. Add context, state interface, and hook in `providers/<name>-provider.tsx`.
2. Nest it in the provider tree in `providers/index.tsx`.
3. Re-export the hook from `providers/index.tsx`.

### Adding a New Feature Tab

1. Create components in `components/features/<feature>/`.
2. Add the tab to `PREVIEW_TABS` in `components/features/preview/tab-config.ts` (icon from `lucide-react`).
3. Add lazy import + tab case in `components/features/preview/preview-panel.tsx` with `FeatureErrorBoundary` + `Suspense`.
4. Add skeleton to `components/features/loading/tab-skeleton.tsx`.
5. Add the view ID to the `ViewId` union in `lib/export/shareable-url.ts`.
6. Add any business logic in `lib/<feature>/`.
7. If the feature needs shared state, create a provider (see above).

### Adding a New Changelog Preset

1. Add the preset key to the `ChangelogPreset` union in `lib/changelog/types.ts`.
2. Define the preset config in `PRESET_CONFIGS` in `lib/changelog/preset-config.ts` (label, description, system prompt template).
3. The prompt template supports `{{commits}}` and `{{dateRange}}` interpolation via `lib/changelog/prompt-builder.ts`.
4. The preset appears automatically in the `NewChangelogView` component selector.

### Adding a New API Route

1. Create `app/api/<route>/route.ts`.
2. Export named handlers (`GET`, `POST`, etc.).
3. API keys are passed in request headers/body from the client — never stored server-side.
4. Use `lib/ai/providers.ts` → `createAIModel()` for AI routes.

### CSS Theming

- Add new color tokens as CSS custom properties in `globals.css` (both light and dark variants).
- Reference them in `tailwind.config.ts` with the `hsl(var(--token))` pattern.
- Use semantic names (e.g., `--status-error`, `--interactive-hover`), not color values.
