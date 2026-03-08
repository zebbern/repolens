/**
 * Mermaid diagram rules for chat mode (uses markdown fencing).
 */
export function mermaidRulesSectionChat(): string {
  return `## Mermaid Diagram Guidelines
Valid diagram types: flowchart, sequenceDiagram, classDiagram, erDiagram, gantt, pie, gitgraph, mindmap.

Syntax rules:
- Use \`-->\` for flowchart arrows, never \`->\`
- Wrap labels containing special characters in quotes: \`A["Label with (parens)"]\`
- ALWAYS quote node labels containing file paths or slashes: \`A["components/features/chat"]\` NOT \`A[components/features/chat]\`
- Unquoted \`[/text]\` is trapezoid syntax in mermaid — always quote labels with paths to avoid parse errors
- Every \`subgraph\` must have a matching \`end\`
- Sequence diagram arrows: \`->>\` (solid), \`-->>\` (dashed)
- Never use empty node labels or HTML entities in labels
- Node IDs must be alphanumeric (no spaces or punctuation)

Before outputting a diagram, mentally verify:
1. All subgraphs are closed with \`end\`
2. Arrow syntax is consistent throughout
3. The diagram type keyword is on the first line with no extra text`
}

/**
 * Mermaid diagram rules for docs/changelog mode (raw syntax, no fencing).
 */
export function mermaidRulesSectionRaw(context: 'documentation' | 'the changelog'): string {
  return `## Mermaid Diagram Syntax Rules
When generating Mermaid diagrams in ${context}:
1. ALWAYS use double-quoted labels for text with special characters: A["Label (with parens)"] not A(Label (with parens))
2. Use entity codes for special chars inside labels: #quot; for quotes, #amp; for &, #35; for #
3. Output raw Mermaid syntax WITHOUT markdown fencing (no \`\`\`mermaid wrappers)
4. Always start with the diagram type: flowchart TD, sequenceDiagram, classDiagram, etc.
5. Use simple alphanumeric node IDs (nodeA, auth_flow) — no special chars in IDs
6. Close all subgraph blocks with 'end'
7. Use 'flowchart' not 'graph' keyword
8. Keep labels under 60 characters
9. For line breaks in labels use <br/>`
}

/**
 * Self-verification protocol for chat/docs modes.
 */
export function verificationSectionDefault(): string {
  return `## Self-Verification Protocol
After generating documentation or making claims about code:
1. Re-read the key files you referenced to verify accuracy
2. Cross-check function signatures, type definitions, and import chains
3. If you find a discrepancy, correct your output and note the correction`
}

/**
 * Self-verification protocol for changelog mode.
 */
export function verificationSectionChangelog(): string {
  return `## Self-Verification Protocol
After generating the changelog:
1. Cross-reference each changelog entry against the commit data
2. Verify that breaking changes are clearly called out
3. Ensure no significant commits are omitted
4. Check that entries accurately describe what changed (not just restate commit messages)`
}

/**
 * Structural index introduction block shared by all prompt builders.
 */
export function structuralIndexBlock(structuralIndex?: string): string {
  return `## Structural Index
Below is a JSON index of every file in the codebase with metadata including exports, imports, and symbol signatures.

**Use this index BEFORE making tool calls:**
- Scan \`exports\` to find where functions, classes, and types are defined
- Trace \`imports\` to understand dependency chains between files
- Read \`symbols\` to see function signatures — parameters and return types tell you what code does without reading the file
- Only call readFile when you need the full implementation, not just the API surface

This index saves you tool calls and makes your answers more accurate. Start here, then drill into specific files.

${structuralIndex || 'Not available'}`
}

/**
 * Skill discovery instructions, informing the agent about available skills.
 */
export function skillDiscoverySection(activeSkills?: string[]): string {
  let section = `## Skill System
You can call \`discoverSkills\` to see available specialized methodologies, then \`loadSkill\` to load one. Only load skills when you need expert guidance for a specific task type (e.g., security auditing, architecture analysis). Skills provide structured step-by-step methodologies that improve the quality of complex analysis tasks.`

  if (activeSkills && activeSkills.length > 0) {
    section += `\n\nThe user has activated these skills: ${activeSkills.join(', ')}. Use the loadSkill tool to load each of them at the start of your response before performing the task.`
  }

  return section
}
