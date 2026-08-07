# Frontend React & UX — Improvement Notes

_Honest summary: a genuinely well-architected React frontend. The real weaknesses are one main-thread performance trap, incomplete modal a11y, and a few re-render / theming footguns — none critical. Severity legend: **critical** (data loss / crash / security) · **high** (broken UX for many users) · **medium** (real degradation, bounded) · **low** (polish / correctness-in-edge-cases)._

## Overall assessment

This codebase does the hard things well. The repository provider is deliberately split into Data / Actions / Progress contexts so high-frequency indexing ticks don't re-render data consumers, and the wide `useRepository()` hook is only used in tests — feature code uses the narrow hooks. XSS posture on the three `dangerouslySetInnerHTML` sinks is sound: Shiki output is escaped, Mermaid runs `securityLevel: 'strict'`, and the markdown renderer never wires `rehype-raw`. Every lazy tab is wrapped in both an error boundary and Suspense.

The weaknesses are narrower: (a) the Symbols tab re-parses the whole repo synchronously on the main thread every time it opens; (b) the global-search overlay is a modal without dialog semantics, focus trap, or focus restoration; (c) two context values don't live up to their own stated re-render contracts; and (d) two components fight over Mermaid's global singleton. Nothing here is a crash or a security hole. No critical or high-severity issues survived verification.

## Findings

### [MEDIUM] Symbols tab re-parses the entire repo synchronously on the main thread every time it opens

- **Where:** `components/features/preview/global-search-overlay.tsx:426-455`; `components/features/code/hooks/use-symbol-extraction.ts:204-215`
- **Problem:** The effect fires whenever `activeTab === 'symbols'`. It calls `codeIndex.contentStore.getBatch(paths)` for **all** files (materializing every file's content, potentially megabytes from IndexedDB), then in a single `.then` tick loops over the whole `codeIndex.files` map calling the **synchronous** regex `extractSymbols()` on each file's full content, flattening symbols + children into one array. The content fetch is async, but the extraction loop itself yields nowhere. Deps are `[codeIndex, activeTab]` (line 455), so it re-runs the entire extraction every time the user switches back to the tab, discarding prior work. There is no worker, no memo/cache, no chunking.
- **Impact:** On a large repo, opening the Symbols tab blocks the main thread for hundreds of ms to seconds — the still-mounted search input freezes and typing is dropped. Re-opening the tab repeats the full cost. Memory spikes because every file's content is pulled into one `contentMap` at once. Note the code tab already does the right thing via `searchInWorker` (line 347), so the infra to fix this exists.
- **Recommendation:** Move extraction into the existing search-worker infrastructure, or at minimum memoize the extracted symbol index keyed by `codeIndex` identity (build once per repo, reuse on tab re-entry). If kept on the main thread, chunk the loop and yield (`requestIdleCallback` / `await` per N files) and cache the `SymbolResult[]` outside the effect. Guarding on `codeIndex` identity alone would make tab re-entry instant.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Global search overlay is a modal without dialog semantics, focus trap, or focus restoration

- **Where:** `components/features/preview/global-search-overlay.tsx:536-546` (panel), `496-524` (`handleKeyDown`), `655` + `901-923` (listbox / header buttons)
- **Problem:** The overlay renders a backdrop + panel, but the panel `div` (542) has no `role="dialog"` / `aria-modal="true"` / `aria-label`. `handleKeyDown` intercepts Escape/Arrows/Enter/Ctrl+digit but **not Tab**, and the background is not inerted, so Tab moves focus out of the panel into the still-interactive UI behind the backdrop. Focus is never restored to the trigger on close (there's no captured `previouslyFocused` ref). Separately, the results container is `role="listbox"` (655) but in the code tab the collapsible file-group headers are `<button>` elements rendered directly inside it (901-923) with no `role="option"` — invalid listbox children that break the `aria-activedescendant` model at lines 569.
- **Impact:** Keyboard and screen-reader users can Tab behind the open modal and operate hidden controls; on close, focus drops to `<body>`, breaking keyboard flow. AT users hear a malformed listbox. This is a core, frequently-used feature (Ctrl+Shift+F).
- **Recommendation:** Add `role="dialog" aria-modal="true" aria-label="Search"` to the panel; trap Tab within it (or wrap in a Radix `Dialog`, which gives trap + restore + inert siblings for free); capture `document.activeElement` on mount and restore it in the cleanup. Make the listbox contain only `role="option"` children — wrap each file group in a `role="group"` and give the header `role="presentation"`, or lift headers out of the listbox element.
- **Effort:** M · **Confidence:** high

### [MEDIUM] Repository Actions context claims stable identity but re-creates on every content/pin/index change

- **Where:** `providers/repository-provider.tsx:44-45` (the contract comment), `113-118` (`getFileContent`), `268-304` (`loadFileContent`), `431-498` (`getPinnedContents`), `516-524` (`actionsValue`)
- **Problem:** The Actions context is documented "stable callbacks (never change identity)" (line 44). But `getFileContent` depends on `[modifiedContents, codeIndex]`, `loadFileContent` on `[repo, codeIndex, contentAvailability]`, and `getPinnedContents` on `[pinnedFiles, codeIndex]`. All three are listed in `actionsValue`'s `useMemo` dep array (516-524), so `actionsValue` gets a new identity whenever `codeIndex`, `modifiedContents`, or `pinnedFiles` change — i.e. exactly during editing, pinning, and lazy content loads, the operations that happen most in a session. The stability guarantee is false precisely when it matters, and the whole point of splitting Actions out of Data was so action-only consumers wouldn't re-render on data churn.
- **Impact:** Every `useRepositoryActions` consumer (CodeBrowser, preview-panel, etc.) re-renders on each content/pin/index mutation — the re-render coupling the three-context split was designed to avoid. The design intent is silently defeated, and a future reader trusts a comment that isn't true.
- **Recommendation:** The provider already mirrors `codeIndex` in `codeIndexRef` (94-95). Do the same for `modifiedContents` and `pinnedFiles`, then rewrite `getFileContent` / `loadFileContent` / `getPinnedContents` to read from refs with empty dep arrays, so `actionsValue` never changes identity. Alternatively, move the content-reading callbacks into their own context and keep Actions genuinely stable. Either way, fix or delete the "never change identity" comment.
- **Effort:** M · **Confidence:** high

### [LOW] APIKeys and Comparison context values are fresh object literals on every provider render

- **Where:** `providers/api-keys-provider.tsx:260-280`; `providers/comparison-provider.tsx:265-279`
- **Problem:** Both providers pass an inline object literal straight to `Provider value=` with no `useMemo`. Every provider render (APIKeysProvider re-renders on `isLoadingModels` toggles, model fetches, hydration, or any parent render) creates a new context value, forcing every consumer to re-render regardless of whether the field they read changed. `getValidProviders` / `selectedProvider` are also recomputed each render (252-258).
- **Impact:** `useAPIKeys` is consumed broadly (chat, code-browser inline actions, settings, preview-panel); each provider state change fans re-renders out to all of them. Bounded because these providers change relatively infrequently — but it's a free fix and contradicts the care taken in `repository-provider.tsx`.
- **Recommendation:** Wrap each `value` in `useMemo` over its real dependencies, mirroring the pattern in `repository-provider.tsx:512-532`.
- **Effort:** S · **Confidence:** high

### [LOW] Two components drive Mermaid's global singleton theme, and the diagram ignores app theme on first paint

- **Where:** `components/ui/markdown-renderer.tsx:281-334` (`MermaidDiagramBlock`); `components/features/diagrams/mermaid-diagram.tsx:14`, `72-88` (`getMermaid`/`DARK_THEME_CONFIG`/`themeRenderLock`), `263` (`previewTheme` default), `401-444` (`handleToggleTheme`)
- **Problem:** Mermaid is a module-global singleton. `MermaidDiagramBlock` calls `mermaid.initialize()` from an effect keyed on the app `resolvedTheme` (287-334), while the inner `MermaidDiagram` independently calls `getMermaid()` — which hard-initializes `DARK_THEME_CONFIG` (76) — and holds `previewTheme` state that starts `'dark'` regardless of the app theme (263). `handleToggleTheme` re-initializes the global to LIGHT then restores DARK (409/438), guarded only by a module-level `themeRenderLock` (88) that makes a second diagram's toggle silently no-op (402). Whichever `initialize()` ran last wins the global config for the next render.
- **Impact:** In light app theme, a diagram can render dark on first paint (or flicker) because `previewTheme` defaults dark and the two initializers race. With several diagrams on a page, a theme toggle on one can be dropped by the shared lock. Cosmetic and non-deterministic rather than a crash, but hard to debug.
- **Recommendation:** Derive `MermaidDiagram`'s initial `previewTheme` from the app theme via `next-themes` instead of hardcoding `'dark'`. Centralize all `mermaid.initialize()` calls behind one owner keyed on theme, or pass theme per-render via mermaid's render-time config rather than mutating the global. At minimum, remove the duplicate initialize path so only one component owns the singleton.
- **Effort:** M · **Confidence:** medium

### [LOW] Streaming chat messages key stateful tool/markdown parts by array index

- **Where:** `components/features/chat/chat-message.tsx:391-419` (`groupMessageParts`), `495-546` (render, `key={gi}` / `key={`tg-${gi}`}`)
- **Problem:** `groupMessageParts()` re-buckets parts every render, and the render maps groups using `key={gi}` (group index) for `MarkdownRenderer`, `ToolCallIndicator`, and `ToolCallGroup`. `ToolCallIndicator` / `ToolCallGroup` carry local `isExpanded` state. A run of tool calls renders as separate `single` items until it reaches 3, at which point `flushToolBuffer` (395-405) collapses them into one `tool-group` with a different key shape — shifting the index-to-component mapping mid-stream.
- **Impact:** During streaming, a user's expanded tool-result panel can collapse or re-attach to a different tool as the grouping boundary crosses 3 calls, and index-keyed remounts throw away that transient UI state. Low impact (transient, self-correcting) but a real streaming footgun.
- **Recommendation:** Key by stable identity: use `part.toolCallId` for tool parts and a content/index hybrid for text parts. Note `groupMessageParts` sets `index: -1` for buffered tool singles (line 401), so if you want to key singles by their underlying part index, fix that to carry the real `i` first.
- **Effort:** S · **Confidence:** medium

## Suggested order of work

1. **Symbols tab freeze** (medium) — biggest user-visible win; reuse the existing search worker or memoize by `codeIndex` identity so tab re-entry is instant.
2. **Search overlay modal a11y** (medium) — wrap in Radix `Dialog` (gives focus trap + restore + inert siblings) and fix the listbox `role="option"` children; core feature, keyboard/AT users.
3. **Actions context stability** (medium) — move `modifiedContents`/`pinnedFiles` to refs so `actionsValue` is genuinely stable; fixes the re-render coupling and makes the comment true.
4. **Unmemoized APIKeys/Comparison values** (low) — trivial `useMemo` wrap; free.
5. **Mermaid singleton theming** (low) — seed `previewTheme` from app theme and centralize `initialize()`.
6. **Chat-message stable keys** (low) — key tool parts by `toolCallId`.
