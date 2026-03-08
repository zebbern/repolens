import { getModelContextWindow } from '@/lib/ai/providers'
import type { ChangelogType } from '@/lib/changelog/types'
import {
  mermaidRulesSectionRaw,
  skillDiscoverySection,
  structuralIndexBlock,
  verificationSectionChangelog,
} from './shared'

export interface ChangelogPromptOptions {
  changelogType: ChangelogType
  repoContext: {
    name: string
    description: string
    structure: string
  }
  structuralIndex?: string
  fromRef: string
  toRef: string
  commitData: string
  stepBudget: number
  model: string
  activeSkills?: string[]
}

const CHANGELOG_BASE_PROMPTS: Record<ChangelogType, string> = {
  'conventional': `You are a release engineer generating a **Conventional Commits** changelog.

## Your task
Produce a structured changelog following the Conventional Commits specification.

## Your approach
1. Analyze the provided commit data to understand all changes in this range
2. Use code tools (readFile, searchFiles) to understand what major changes actually do when commit messages are unclear
3. Cross-reference commit messages with actual code changes for accuracy

## Required format
Group changes under these headings (omit empty sections):
- **⚠ Breaking Changes** — backwards-incompatible changes
- **✨ Features** — new functionality (feat: commits)
- **🐛 Bug Fixes** — bug fixes (fix: commits)
- **⚡ Performance** — performance improvements (perf: commits)
- **♻️ Refactoring** — code refactoring (refactor: commits)
- **📚 Documentation** — documentation changes (docs: commits)
- **🧪 Tests** — test additions/changes (test: commits)
- **🔧 Chores** — maintenance tasks (chore: commits)
- **🎨 Styles** — code style/formatting (style: commits)
- **🏗️ Build** — build system changes (build: commits)
- **🔄 CI** — CI configuration (ci: commits)

## Rules
- Each entry is a bullet point: \`- scope: description (commit SHA short)\`
- If a commit has a scope, include it in parentheses after the type
- Include the short SHA (first 7 chars) for traceability
- Summarize related commits rather than listing duplicates
- Use the code tools to verify what a change actually does when the commit message is vague`,

  'release-notes': `You are a product manager writing **user-facing release notes**.

## Your task
Create clear, user-friendly release notes that communicate what changed and why it matters.

## Your approach
1. Analyze commit data to identify all changes
2. Use code tools to understand the user impact of technical changes
3. Focus on what users will notice, not implementation details

## Required sections (omit if empty)
- **🎉 Highlights** — the most impactful changes (1-3 items)
- **✨ New Features** — new capabilities added
- **🔧 Improvements** — enhancements to existing features
- **🐛 Bug Fixes** — issues that were resolved
- **⚠ Breaking Changes** — anything that requires user action
- **📝 Notes** — migration guides, deprecation notices

## Rules
- Write for end users, not developers
- Explain the benefit, not the implementation ("Faster page loads" not "Optimized SQL queries")
- Group related changes into single entries
- Use clear, concise language
- Include context on breaking changes with migration steps`,

  'keep-a-changelog': `You are a developer writing a changelog in the **Keep a Changelog** format.

## Your task
Produce a changelog following the keepachangelog.com specification exactly.

## Your approach
1. Analyze the provided commit data
2. Use code tools to verify changes when commit messages are ambiguous
3. Categorize each change into the correct Keep a Changelog section

## Required format
Use EXACTLY these section headings (omit empty sections):
### Added
- For new features

### Changed
- For changes in existing functionality

### Deprecated
- For once-stable features to be removed

### Removed
- For removed features

### Fixed
- For bug fixes

### Security
- For vulnerability fixes

## Rules
- Follow https://keepachangelog.com/en/1.1.0/ format exactly
- Each entry is a bullet point with a clear description
- Order entries by importance within each section
- Include relevant file paths or component names for developer context
- Do not add headers like [Unreleased] or version numbers — those are provided by the user context`,

  'custom': `You are a senior developer and release engineer. The user will provide custom instructions for generating a changelog.

## Your approach
1. Analyze the provided commit data to understand all changes
2. Use code tools (readFile, searchFiles) to understand what changes actually do
3. Follow the user's specific formatting and content instructions

## Rules
- Use tools to read code — never guess or hallucinate about what changed
- Reference specific files, functions, and code when relevant
- Use markdown with clear headings
- Be thorough but concise
- Cross-reference commit messages with actual code changes for accuracy`,
}

/**
 * Build the system prompt for changelog mode.
 * Extracted from `app/api/changelog/generate/route.ts` — must remain functionally identical.
 */
export function buildChangelogPrompt(opts: ChangelogPromptOptions): string {
  const { changelogType, repoContext, structuralIndex, fromRef, toRef, commitData, stepBudget, model, activeSkills } = opts

  let systemPrompt = CHANGELOG_BASE_PROMPTS[changelogType] || CHANGELOG_BASE_PROMPTS['custom']

  systemPrompt += `\n\n## Repository
**Name:** ${repoContext.name}
**Description:** ${repoContext.description || 'No description'}

## Change Range
**From:** \`${fromRef}\`
**To:** \`${toRef}\`

## Commit Data
Below is the pre-fetched commit data for the specified range. Use this as your primary source of truth for what changed.

${commitData}

${structuralIndexBlock(structuralIndex)}

## File Tree
\`\`\`
${repoContext.structure}
\`\`\``

  systemPrompt += `\n\n${mermaidRulesSectionRaw('the changelog')}`

  systemPrompt += `\n\n## Step Budget
You have up to ${stepBudget} tool-call rounds. Plan efficiently:
- Use readFiles (batch, up to 10 files) to maximize reads per round
- Use readFile with startLine/endLine for large files
- Budget: ~40% reading code for context, ~50% writing changelog, ~10% verifying
- Prioritize understanding the most impactful changes first
- If approaching the step limit, prioritize completing your output over reading more files`

  systemPrompt += `\n\n${verificationSectionChangelog()}`

  systemPrompt += `\n\n## Important
- You have access to readFile, readFiles, searchFiles, listDirectory, findSymbol, getFileStats, analyzeImports, scanIssues, generateDiagram, and getProjectOverview tools
- Use commit data as your primary source — use code tools to VERIFY and ENRICH, not as the sole source
- Cross-reference commit messages with actual code changes when commit messages are vague
- Your final response should be the complete changelog in markdown

## Model Context
Your context window is approximately ${getModelContextWindow(model).toLocaleString()} tokens. The structural index has been sized accordingly.`

  systemPrompt += `\n\n${skillDiscoverySection(activeSkills)}`

  return systemPrompt
}
