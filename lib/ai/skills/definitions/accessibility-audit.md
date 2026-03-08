---
id: accessibility-audit
name: Accessibility Audit
description: Review UI code for WCAG 2.2 AA compliance including ARIA patterns, keyboard navigation, color contrast, semantic HTML, and screen reader support
trigger: When asked to check accessibility, audit a11y, review WCAG compliance, check ARIA usage, or assess keyboard navigation
relatedTools:
  - searchFiles
  - readFile
  - scanIssues
lastReviewed: "2026-03-08"
reviewCycleDays: 180
standardsReferenced:
  - name: WCAG
    pinnedVersion: "2.2"
  - name: WAI-ARIA
    pinnedVersion: "1.2"
  - name: EU Accessibility Act
    pinnedVersion: "2025"
---

# Accessibility Audit

## Purpose

Performs a WCAG 2.2 AA compliance audit of UI code by analyzing semantic HTML structure, ARIA patterns, keyboard navigation, form accessibility, media alternatives, dynamic content announcements, and color contrast. The analysis traces component trees from rendered output to source code, classifying findings by their impact on users who rely on assistive technologies. The user receives a prioritized list of accessibility barriers with severity classification, affected user groups, WCAG success criteria references, and concrete code fixes. Note: the European Accessibility Act (EAA, effective June 2025) makes WCAG 2.1 AA compliance a legal requirement for many digital products sold in the EU.

## Prerequisites

Ensure the `searchFiles` and `readFile` tools are available for source code analysis. The `scanIssues` tool can detect common accessibility anti-patterns. Call `getProjectOverview` to understand the component library in use (e.g., Radix UI, Headless UI, shadcn/ui) — these libraries often handle ARIA patterns internally.

## Methodology

Follow this structured approach for every accessibility audit. Complete each phase in order.

### Phase 1: Semantic HTML

1. Use `searchFiles` to find component files in the UI layer
2. Check heading hierarchy:
   - Search for `<h1>` through `<h6>` usage — is there exactly one `<h1>` per page?
   - Are heading levels sequential (no skipping from `<h2>` to `<h4>`)?
   - Are headings used for structure, not just styling?
3. Check landmark regions:
   - Is `<main>` present on every page?
   - Are `<nav>`, `<header>`, `<footer>`, `<aside>` used appropriately?
   - Are multiple landmarks of the same type distinguished with `aria-label`?
4. Check element semantics:
   - Lists use `<ul>/<ol>/<li>`, not `<div>` with bullet-point styling
   - Tables use `<table>/<th>/<td>`, not grid `<div>` layouts for tabular data
   - Buttons use `<button>`, not `<div onClick>` or `<a>` without href
   - Links use `<a href>` for navigation, not `<span onClick>`

#### Semantic HTML Thresholds

| Pattern | Threshold | Classification |
| --------- | ----------- | --------------- |
| Heading level skip > 1 | Any (`<h2>` → `<h4>`) | Flag — breaks document outline |
| Multiple `<h1>` per page | > 1 | Flag — confuses screen readers |
| `<div onClick>` without role | Any | Flag — not keyboard accessible |
| Page without `<main>` landmark | Any | Flag — screen readers cannot skip to content |
| Clickable `<div>` or `<span>` without `role="button"` | Any | Flag — invisible to assistive tech |

**Verification**: Before flagging a heading skip, confirm it is not inside a reusable component that receives its heading level as a prop (e.g., `<Section headingLevel={3}>`). The visual page may have correct hierarchy even if a single component appears to skip.

### Phase 2: ARIA Patterns

1. Use `searchFiles` to find interactive components:
   - Dialogs/Modals: search for `dialog`, `modal`, `Dialog`, `Modal`
   - Menus/Dropdowns: search for `menu`, `dropdown`, `DropdownMenu`, `Popover`
   - Tabs: search for `tab`, `TabList`, `TabPanel`
   - Accordions: search for `accordion`, `collapsible`, `Accordion`
   - Tooltips: search for `tooltip`, `Tooltip`
2. For each interactive pattern, verify ARIA implementation:

| Component | Required ARIA | Common Issues |
| ----------- | -------------- | --------------- |
| Dialog | `role="dialog"`, `aria-label` or `aria-labelledby`, `aria-modal="true"` | Missing label, focus not trapped |
| Menu | `role="menu"`, `role="menuitem"`, `aria-expanded` on trigger | Arrow key navigation missing |
| Tabs | `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected` | Panel not associated with tab |
| Accordion | `aria-expanded`, `aria-controls`, panel `id` matching | Expanded state not announced |
| Tooltip | `role="tooltip"`, `aria-describedby` on trigger | Not accessible via keyboard |
| Combobox | `role="combobox"`, `aria-expanded`, `aria-activedescendant` | Screen reader cannot navigate options |

1. Check for ARIA misuse:
   - `aria-hidden="true"` on focusable elements — creates invisible tab stops
   - `role="button"` without keyboard event handlers — announces as button but is not operable
   - Redundant ARIA on native elements (`role="button"` on `<button>`) — unnecessary

**Verification**: Before flagging missing ARIA on a component, check if it is from a component library (Radix UI, Headless UI, shadcn/ui) that handles ARIA internally. Read the component implementation or library docs to confirm.

### Phase 3: Keyboard Navigation

1. Use `searchFiles` to find interactive elements and event handlers:
   - Search for `onClick`, `onPress`, `onMouseDown`, `onMouseEnter`
   - Search for `onKeyDown`, `onKeyUp`, `onKeyPress` — verify keyboard alternatives exist
2. Check focus management:
   - Do modals/dialogs trap focus within the dialog?
   - Does focus return to the trigger element when a dialog closes?
   - Is there a skip link to bypass navigation and reach `<main>` content?
   - Can keyboard-only users reach all interactive elements via Tab?
3. Check for keyboard traps:
   - Can the user exit any focused component using Escape or Tab?
   - Are custom widgets navigable with arrow keys where expected (menus, tabs, listboxes)?
4. Check `tabindex` usage:
   - `tabindex="0"` — adds element to natural tab order (valid)
   - `tabindex="-1"` — programmatically focusable only (valid for focus management)
   - `tabindex` > 0 — breaks natural tab order (**always flag**)

#### Keyboard Navigation Thresholds

| Pattern | Threshold | Classification |
| --------- | ----------- | --------------- |
| `onClick` without `onKeyDown` on non-button element | Any | Flag — not keyboard operable |
| Focus trap without Escape key exit | Any | Critical — keyboard user stuck |
| `tabindex` > 0 | Any | Flag — disrupts tab order |
| Modal without focus trap | Any | Flag — focus escapes to background |
| No skip link on pages with > 5 nav items | Any | Flag — keyboard users must tab through all nav |

**Verification**: Before flagging a missing `onKeyDown`, check if the element is a native `<button>` or `<a>` — these handle Enter and Space key activation natively without explicit keyboard handlers.

### Phase 4: Forms

1. Use `searchFiles` to find form elements:
   - Search for `<input`, `<select`, `<textarea`, `<form`
   - Search for form component libraries: `react-hook-form`, `formik`, form components
2. Check label associations:
   - Every `<input>` has a visible `<label>` with explicit `htmlFor`, or `aria-label`/`aria-labelledby`
   - Labels are descriptive — "Email address", not "Input 1"
3. Check error handling:
   - Are validation errors announced to screen readers? (`aria-describedby` pointing to error message, or `aria-invalid="true"`)
   - Are required fields indicated both visually and programmatically? (`required` attribute or `aria-required="true"`)
4. Check form grouping:
   - Related inputs grouped with `<fieldset>` and `<legend>` (e.g., radio groups, address fields)
   - Multi-step forms announce the current step

### Phase 5: Images and Media

1. Use `searchFiles` to find image and media elements:
   - Search for `<img`, `<Image`, `<svg`, `<video`, `<audio`, `<canvas`
2. Check alt text:
   - Informative images have descriptive `alt` text
   - Decorative images have `alt=""` or `aria-hidden="true"` — NOT missing alt attribute
   - Complex images (charts, diagrams) have extended descriptions
3. Check SVG accessibility:
   - Inline SVGs: `role="img"` with `aria-label`, or `<title>` element
   - Decorative SVGs: `aria-hidden="true"`
4. Check media:
   - Videos have captions or transcripts
   - Audio content has text alternatives
   - Auto-playing media has a visible pause/stop control

### Phase 6: Dynamic Content

1. Use `searchFiles` to find dynamic updates:
   - Search for `aria-live`, `role="alert"`, `role="status"`, `role="log"`
   - Search for toast/notification components
   - Search for loading states, skeleton screens, progress indicators
2. Check live region implementation:
   - Are toast notifications announced to screen readers? (`aria-live="polite"` or `role="status"`)
   - Are error alerts announced immediately? (`aria-live="assertive"` or `role="alert"`)
   - Are loading states communicated? (`aria-busy="true"`, progress announcements)
3. Check focus management for dynamic content:
   - When content updates, is focus moved appropriately?
   - When a route changes (SPA navigation), is the new page title announced?
   - When a modal/popover opens, does focus move to the new content?

### Phase 7: Color and Contrast

1. Use `searchFiles` to find color definitions:
   - Search for CSS variables, theme tokens, color utilities
   - Search for Tailwind color classes: `text-`, `bg-`, `border-`
2. Check contrast ratios against WCAG AA thresholds:
   - Normal text (< 18pt): contrast ratio ≥ 4.5:1
   - Large text (≥ 18pt or ≥ 14pt bold): contrast ratio ≥ 3:1
   - UI components and graphical objects: contrast ratio ≥ 3:1
3. Check that color is not the sole means of conveying information:
   - Error states use icons or text in addition to red color
   - Chart data uses patterns or labels in addition to colors
   - Link text is distinguished by underline or icon, not just color

**Verification**: In code-only audits, contrast ratios cannot be precisely measured without rendering. Flag potential concerns based on color token analysis but note that runtime testing with browser dev tools or axe is needed for exact ratio verification.

### Phase 8: Report

For each finding, report:

1. **Severity**: Critical / High / Medium / Low / Informational (use severity table below)
2. **Category**: Semantic HTML, ARIA, Keyboard, Forms, Media, Dynamic Content, or Color/Contrast
3. **Location**: Exact file path and component reference
4. **WCAG Criterion**: The specific success criterion violated (e.g., 1.1.1 Non-text Content)
5. **Description**: What the accessibility barrier is
6. **Affected Users**: Which user groups are impacted (screen reader, keyboard-only, low vision, cognitive)
7. **Remediation**: Specific code changes to fix the barrier

Provide an overall summary:

- Total findings by severity and category
- WCAG 2.2 AA compliance assessment
- Top 3 most impactful barriers to fix first
- Components that need keyboard navigation added
- Positive patterns: well-implemented a11y features
- Recommendation for automated testing tools (axe-core, Playwright a11y assertions)

## Severity Classification

| Severity | Criteria | Affected Users | Example |
| ---------- | ---------- | ---------------- | --------- |
| **Critical** | Interactive element not keyboard accessible, focus trap with no exit, form with no labels | Keyboard, screen reader — complete blocker | `<div onClick={submit}>Submit</div>` with no keyboard handler |
| **High** | Missing form labels, dialog without aria-label, no skip link, images without alt | Screen reader — major functionality loss | `<input type="email">` with no associated label |
| **Medium** | Improper heading hierarchy, missing live regions for updates, tabindex > 0 | Screen reader — degraded navigation | Heading jumps from `<h2>` to `<h5>` |
| **Low** | Decorative image with alt text instead of `alt=""`, redundant ARIA on native elements | Screen reader — minor annoyance | `<img alt="decorative line" src="divider.svg">` |
| **Informational** | Contrast concerns needing runtime verification, optimization suggestions | Varies — needs manual testing | Light gray text on white background — possible contrast issue |

## Example Output

````markdown
### Finding: Dialog Missing Accessible Label

- **Severity**: High
- **Category**: ARIA
- **WCAG Criterion**: 4.1.2 Name, Role, Value
- **Location**: `components/features/settings/settings-dialog.tsx` line 28
- **Description**: The settings dialog uses Radix UI's `Dialog.Content` but does not provide an accessible name via `aria-label` or `aria-labelledby`. Screen readers announce it as "dialog" with no description, making it difficult for users to understand what context they are in.
- **Affected Users**: Screen reader users cannot distinguish this dialog from other dialogs on the page.
- **Remediation**: Add an accessible label referencing the dialog title:
  ```tsx
  <Dialog.Content aria-labelledby="settings-dialog-title">
    <Dialog.Title id="settings-dialog-title">Settings</Dialog.Title>
    {/* dialog content */}
  </Dialog.Content>
  ```
  Alternatively, if no visible title exists, use `aria-label`:
  ```tsx
  <Dialog.Content aria-label="Application settings">
  ```
````

## Common False Positives

Skip or downgrade these patterns — they look like accessibility issues but are acceptable:

1. **Server-rendered components**: Components rendered on the server and tested via integration tests may have their a11y validated at a higher level — check test coverage before flagging
2. **`aria-hidden` on deliberately hidden elements**: Content hidden from assistive tech while an overlay is active is correct usage, not a violation
3. **`role="presentation"` on decorative wrappers**: Layout wrappers that add no semantic meaning can legitimately use this role to reduce screen reader noise
4. **Components wrapped in accessible parents**: A `<div onClick>` inside a `<button>` is redundant but not a blocker — the button handles keyboard and role
5. **Component library internals**: Radix UI, Headless UI, and shadcn/ui handle most ARIA patterns internally. Before flagging, read the component's rendered output, not just the JSX source
6. **Icon-only buttons with `sr-only` text**: A button showing only an icon is accessible if it has a `<span className="sr-only">` child or `aria-label` — check for these before flagging

## Related Skills

- For testing accessibility with automated tools and Playwright assertions, load `testing-quality`
- For identifying complex components that need a11y review, load `code-complexity`
- For API error response accessibility (screen reader announcements), load `error-handling-review`
