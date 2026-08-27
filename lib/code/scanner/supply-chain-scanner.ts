// Supply chain scanner — detects vulnerabilities in package.json, lockfiles,
// GitHub Actions workflows, and Python dependency files.

import type { CodeIndex } from '../code-index'
import { getFileLines } from '../code-index'
import type { CodeIssue } from './types'

// ---------------------------------------------------------------------------
// Suspicious patterns in lifecycle scripts
// ---------------------------------------------------------------------------
const SUSPICIOUS_SCRIPT_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bhttp:\/\//i,
  /\bhttps:\/\//i,
  /\beval\b/,
  /\bexec\b/,
  /\bchild_process\b/,
  /\bBuffer\.from\b/,
  /\batob\b/,
  /\bbtoa\b/,
  // Base64-encoded strings (40+ chars of base64 alphabet)
  /[A-Za-z0-9+/]{40,}={0,2}/,
]

const LIFECYCLE_SCRIPTS = ['postinstall', 'preinstall', 'install'] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the 1-based line number of `needle` in `content`, starting search at `startLine` (0-based index). */
function findLine(lines: string[], needle: string, startLine = 0): number {
  for (let i = startLine; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1
  }
  return 1
}

/** Check whether any lockfile exists alongside a package.json in the code index. */
function hasLockfile(codeIndex: CodeIndex, pkgPath: string): boolean {
  const dir = pkgPath.includes('/') ? pkgPath.substring(0, pkgPath.lastIndexOf('/') + 1) : ''
  return (
    codeIndex.files.has(`${dir}package-lock.json`) ||
    codeIndex.files.has(`${dir}pnpm-lock.yaml`) ||
    codeIndex.files.has(`${dir}yarn.lock`)
  )
}

/** Determine if a path is a GitHub Actions workflow file. */
function isWorkflowFile(path: string): boolean {
  return /\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)
}

// ---------------------------------------------------------------------------
// Package.json checks
// ---------------------------------------------------------------------------

function scanPackageJson(
  path: string,
  content: string,
  lines: string[],
  codeIndex: CodeIndex,
  issues: CodeIssue[],
): void {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(content) as Record<string, unknown>
  } catch {
    // Malformed JSON — nothing to scan
    return
  }

  const scripts = pkg.scripts as Record<string, string> | undefined

  // 1. Suspicious lifecycle scripts
  if (scripts && typeof scripts === 'object') {
    for (const hook of LIFECYCLE_SCRIPTS) {
      const value = scripts[hook]
      if (typeof value !== 'string') continue

      for (const pattern of SUSPICIOUS_SCRIPT_PATTERNS) {
        if (pattern.test(value)) {
          const line = findLine(lines, `"${hook}"`)
          issues.push({
            id: `supply-chain-suspicious-script-${path}-${line}`,
            ruleId: 'supply-chain-suspicious-script',
            category: 'security',
            severity: 'critical',
            title: 'Suspicious Lifecycle Script',
            description: `The "${hook}" script contains a suspicious pattern (${pattern.source}). Malicious packages commonly abuse lifecycle scripts to execute arbitrary code during installation.`,
            file: path,
            line,
            column: 0,
            snippet: `"${hook}": "${value}"`,
            suggestion: 'Review the script carefully. Remove or replace with a safe alternative. Use --ignore-scripts during installation if untrusted.',
            cwe: 'CWE-506',
            confidence: 'high',
          })
          break // one issue per hook is enough
        }
      }
    }
  }

  // 2. Missing lockfile
  if (!hasLockfile(codeIndex, path)) {
    issues.push({
      id: `supply-chain-no-lockfile-${path}`,
      ruleId: 'supply-chain-no-lockfile',
      category: 'security',
      severity: 'warning',
      title: 'Missing Lockfile',
      description: 'No package-lock.json, pnpm-lock.yaml, or yarn.lock found alongside this package.json. Without a lockfile, dependency versions are non-deterministic and vulnerable to substitution attacks.',
      file: path,
      line: 1,
      column: 0,
      snippet: 'package.json without lockfile',
      suggestion: 'Run `npm install`, `pnpm install`, or `yarn install` to generate a lockfile and commit it to version control.',
      cwe: 'CWE-353',
      confidence: 'medium',
    })
  }

  // 3. Star version ranges
  const depSections = ['dependencies', 'devDependencies'] as const
  for (const section of depSections) {
    const deps = pkg[section] as Record<string, string> | undefined
    if (!deps || typeof deps !== 'object') continue
    for (const [name, version] of Object.entries(deps)) {
      if (version === '*') {
        const line = findLine(lines, `"${name}"`)
        issues.push({
          id: `supply-chain-star-version-${path}-${name}`,
          ruleId: 'supply-chain-star-version',
          category: 'security',
          severity: 'warning',
          title: 'Wildcard Dependency Version',
          description: `"${name}" uses version "*", which accepts any version including potentially malicious ones. An attacker who publishes a compromised version will have it automatically installed.`,
          file: path,
          line,
          column: 0,
          snippet: `"${name}": "*"`,
          suggestion: 'Pin to a specific version range (e.g., "^1.0.0") and use a lockfile.',
          cwe: 'CWE-1104',
          confidence: 'high',
        })
      }
    }
  }

  // 4. Git dependencies
  for (const section of depSections) {
    const deps = pkg[section] as Record<string, string> | undefined
    if (!deps || typeof deps !== 'object') continue
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && /git(\+https?)?:\/\//i.test(version)) {
        const line = findLine(lines, `"${name}"`)
        issues.push({
          id: `supply-chain-git-dependency-${path}-${name}`,
          ruleId: 'supply-chain-git-dependency',
          category: 'security',
          severity: 'info',
          title: 'Git-Based Dependency',
          description: `"${name}" is installed from a git URL (${version}). Git dependencies bypass the npm registry's integrity checks and may point to mutable references.`,
          file: path,
          line,
          column: 0,
          snippet: `"${name}": "${version}"`,
          suggestion: 'Prefer installing from npm with a pinned version. If a git source is required, pin to a specific commit SHA.',
          cwe: 'CWE-829',
          confidence: 'medium',
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lockfile checks
// ---------------------------------------------------------------------------

function scanLockfile(
  path: string,
  content: string,
  lines: string[],
  issues: CodeIssue[],
): void {
  const isPackageLock = path.endsWith('package-lock.json')

  // 5. Missing integrity in package-lock.json
  if (isPackageLock) {
    try {
      const lock = JSON.parse(content) as Record<string, unknown>
      const packages = (lock.packages ?? lock.dependencies) as Record<string, Record<string, unknown>> | undefined
      if (packages && typeof packages === 'object') {
        let missingCount = 0
        let firstMissingPkg = ''
        let firstMissingLine = 1
        for (const [pkgName, pkgInfo] of Object.entries(packages)) {
          if (!pkgName || pkgName === '') continue // root entry
          if (typeof pkgInfo !== 'object' || pkgInfo === null) continue
          if (!('integrity' in pkgInfo) || !pkgInfo.integrity) {
            missingCount++
            if (missingCount === 1) {
              firstMissingPkg = pkgName
              firstMissingLine = findLine(lines, `"${pkgName}"`)
            }
          }
        }
        if (missingCount > 0) {
          issues.push({
            id: `supply-chain-lockfile-no-integrity-${path}`,
            ruleId: 'supply-chain-lockfile-no-integrity',
            category: 'security',
            severity: 'warning',
            title: 'Lockfile Missing Integrity Hashes',
            description: `${missingCount} package(s) in this lockfile lack integrity hashes (first: ${firstMissingPkg}). Without integrity verification, tampered packages can be installed silently.`,
            file: path,
            line: firstMissingLine,
            column: 0,
            snippet: `Missing "integrity" for ${firstMissingPkg}`,
            suggestion: 'Delete the lockfile and regenerate it with a current npm version (npm i --package-lock-only).',
            cwe: 'CWE-353',
            confidence: 'high',
          })
        }
      }
    } catch {
      // Malformed lockfile
    }
  }

  // 6. HTTP (non-HTTPS) registry URLs in lockfiles
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match resolved URLs that use plain http
    if (/["']?resolved["']?\s*[:=]\s*["']?http:\/\//i.test(line) || /http:\/\/registry\./i.test(line)) {
      issues.push({
        id: `supply-chain-http-registry-${path}-${i + 1}`,
        ruleId: 'supply-chain-http-registry',
        category: 'security',
        severity: 'critical',
        title: 'HTTP Registry URL in Lockfile',
        description: 'This lockfile references a package registry over plain HTTP instead of HTTPS. An attacker on the network can intercept and replace packages (man-in-the-middle).',
        file: path,
        line: i + 1,
        column: 0,
        snippet: line.trim(),
        suggestion: 'Ensure the npm/yarn registry is configured to use HTTPS. Regenerate the lockfile after fixing the registry URL.',
        cwe: 'CWE-319',
        confidence: 'high',
      })
      break // one issue per lockfile is sufficient
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub Actions workflow checks
// ---------------------------------------------------------------------------

/** Match action references: `uses: owner/action@ref` */
const ACTION_USES_RE = /uses:\s*([^#\s]+)/

/** Detect `@main`, `@master`, or other branch-style refs (not SHA, not vN tags). */
function isUnpinnedRef(ref: string): boolean {
  // Pinned SHA (40-char hex) — safe
  if (/^[a-f0-9]{40}$/i.test(ref)) return false
  // Version tag like v1, v2.3, v3.1.2 — acceptable
  if (/^v\d+/i.test(ref)) return false
  // Everything else (main, master, latest, develop) — unpinned
  return true
}

const GITHUB_EVENT_EXPRESSION_RE = /\$\{\{\s*github\.event((?:\.|\s*\[)[^}]+)\}\}/gi
const UNTRUSTED_GITHUB_EVENT_FIELDS = new Set([
  'body',
  'default_branch',
  'email',
  'head_ref',
  'label',
  'message',
  'name',
  'page_name',
  'ref',
  'title',
])

/** Return the indentation of a YAML mapping key, including a list-item marker. */
function yamlEntryIndent(line: string, key?: string): number | null {
  const keyPattern = key ? key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[A-Za-z_][\\w-]*'
  const match = line.match(new RegExp(`^(\\s*)(?:(-\\s+))?${keyPattern}\\s*:`, 'i'))
  if (!match) return null
  return match[1].length + (match[2]?.length ?? 0)
}

/** Detect only documented untrusted fields, such as issue titles and PR bodies. */
function containsUntrustedGitHubEventExpression(line: string): boolean {
  for (const match of line.matchAll(GITHUB_EVENT_EXPRESSION_RE)) {
    const normalizedPath = match[1]
      .trim()
      .replace(/\[\s*["']([A-Za-z_][\w-]*)["']\s*\]/g, '.$1')
      .replace(/^\./, '')
    const path = normalizedPath.match(/^[A-Za-z_][\w-]*(?:(?:\.[A-Za-z_][\w-]*)|(?:\[\d+\]))*/)?.[0]
    if (!path) continue
    const segments = path.split('.')
    const field = segments[segments.length - 1]?.replace(/\[\d+\]$/, '')
    if (path.toLowerCase() === 'repository.name') continue
    if (field && UNTRUSTED_GITHUB_EVENT_FIELDS.has(field.toLowerCase())) return true
  }
  return false
}

const CHECKOUT_ACTION_RE = /^\s*(?:-\s+)?uses:\s*["']?actions\/checkout(?:@[^"'#\s]+)?["']?(?:\s*(?:#.*)?)$/i

/** Check whether a checkout step explicitly selects untrusted pull request code. */
function checkoutUsesPullRequestHead(lines: string[], startLine: number): boolean {
  const stepIndent = yamlEntryIndent(lines[startLine], 'uses')
  if (stepIndent === null) return false

  let withIndent: number | null = null
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]
    const entryIndent = yamlEntryIndent(line)
    const listItem = line.match(/^(\s*)-\s+/)
    if ((listItem && (entryIndent ?? listItem[1].length) <= stepIndent) ||
      (!listItem && entryIndent !== null && entryIndent < stepIndent)) {
      break
    }

    const lineWithIndent = yamlEntryIndent(line, 'with')
    if (lineWithIndent !== null) {
      withIndent = lineWithIndent
      continue
    }
    if (withIndent === null) continue
    if (entryIndent !== null && entryIndent <= withIndent) {
      withIndent = null
      continue
    }

    const option = line.match(/^\s*(ref|repository)\s*:\s*(.*)$/i)
    if (!option) continue
    const value = option[2]
    if (/\$\{\{\s*github\.event\.pull_request\.(?:head\.(?:sha|ref)|merge_commit_sha)\b/i.test(value) ||
      /\$\{\{\s*github\.head_ref\b/i.test(value) ||
      /\brefs\/pull\/(?:\d+|\$\{\{[^}]+\}\})\/(?:head|merge)\b/i.test(value) ||
      (option[1].toLowerCase() === 'repository' &&
        /\$\{\{\s*github\.event\.pull_request\.head\.repo\./i.test(value))) {
      return true
    }
  }
  return false
}

/** Find the trigger line for a real pull_request_target declaration. */
function findPullRequestTargetTriggerLine(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)["']?on["']?\s*:\s*(.*)$/i)
    if (!match || match[1].length !== 0 || /^\s*#/.test(lines[i])) continue
    const inlineValue = match[2].replace(/\s+#.*$/, '').trim()
    if (/\bpull_request_target\b/i.test(inlineValue)) return i + 1
    if (inlineValue !== '') continue

    const onIndent = match[1].length
    let directChildIndent: number | null = null
    for (let j = i + 1; j < lines.length; j++) {
      const child = lines[j]
      if (/^\s*$/.test(child) || /^\s*#/.test(child)) continue
      const childIndent = child.match(/^\s*/)?.[0].length ?? 0
      const indentationlessListItem = childIndent === onIndent && /^\s*-\s+/.test(child)
      if (childIndent < onIndent || (childIndent === onIndent && !indentationlessListItem)) break
      directChildIndent ??= childIndent
      if (childIndent !== directChildIndent) continue
      const uncommentedChild = child.replace(/\s+#.*$/, '')
      if (/^\s*(?:-\s*)?["']?pull_request_target["']?\s*(?::(?:\s|$)|$)/i.test(uncommentedChild)) {
        return j + 1
      }
    }
  }
  return null
}

/** Return true only for a direct `run` property of a workflow step. */
function isWorkflowStepRunKey(lines: string[], index: number): boolean {
  const runMatch = lines[index].match(/^(\s*)(?:(-\s+))?run\s*:/i)
  if (!runMatch) return false

  const listIndent = runMatch[2] ? runMatch[1].length : runMatch[1].length - 2
  if (listIndent < 0) return false

  let stepStart = index
  if (!runMatch[2]) {
    stepStart = -1
    for (let i = index - 1; i >= 0; i--) {
      const line = lines[i]
      if (/^\s*(?:#.*)?$/.test(line)) continue
      const listItem = line.match(/^(\s*)-\s+\S/)
      if (listItem?.[1].length === listIndent) {
        stepStart = i
        break
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0
      if (indent < listIndent) return false
    }
    if (stepStart < 0) return false
  }

  for (let i = stepStart - 1; i >= 0; i--) {
    const line = lines[i]
    if (/^\s*(?:#.*)?$/.test(line)) continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    if (indent === listIndent && /^\s*steps\s*:/i.test(line)) return true
    if (indent >= listIndent) continue
    return /^\s*steps\s*:/i.test(line)
  }
  return false
}

function scanGitHubActions(
  path: string,
  lines: string[],
  issues: CodeIssue[],
): void {
  const pullRequestTargetLine = findPullRequestTargetTriggerLine(lines)

  // 7. Unpinned actions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const usesMatch = line.match(ACTION_USES_RE)
    if (!usesMatch) continue
    const actionRef = usesMatch[1]
    if (!actionRef.includes('@')) continue
    // Only check third-party actions (not local actions like ./)
    if (actionRef.startsWith('./') || actionRef.startsWith('docker://')) continue

    const [, ref] = actionRef.split('@')
    if (ref && isUnpinnedRef(ref)) {
      issues.push({
        id: `gha-unpinned-action-${path}-${i + 1}`,
        ruleId: 'gha-unpinned-action',
        category: 'security',
        severity: 'warning',
        title: 'Unpinned GitHub Action',
        description: `Action "${actionRef}" uses a mutable reference (@${ref}). A compromised or force-pushed tag/branch can inject malicious code into your CI pipeline.`,
        file: path,
        line: i + 1,
        column: 0,
        snippet: line.trim(),
        suggestion: 'Pin the action to a full commit SHA (e.g., uses: owner/action@abc123...).',
        cwe: 'CWE-829',
        confidence: 'medium',
      })
    }
  }

  // 8. Dangerous trigger: pull_request_target + checkout
  const hasUntrustedCheckout = lines.some((line, index) =>
    CHECKOUT_ACTION_RE.test(line) && checkoutUsesPullRequestHead(lines, index))
  if (pullRequestTargetLine !== null && hasUntrustedCheckout) {
    issues.push({
      id: `gha-dangerous-trigger-${path}`,
      ruleId: 'gha-dangerous-trigger',
      category: 'security',
      severity: 'critical',
      title: 'Dangerous pull_request_target + Checkout',
      description: 'This workflow uses `pull_request_target` and explicitly checks out untrusted pull request code. A malicious PR can then run in a privileged context with access to secrets and a potentially write-capable GITHUB_TOKEN.',
      file: path,
      line: pullRequestTargetLine,
      column: 0,
      snippet: 'pull_request_target with PR-head checkout',
      suggestion: 'Avoid checking out PR code in pull_request_target workflows. If needed, use a separate unprivileged workflow for building/testing PR code.',
      cwe: 'CWE-94',
      confidence: 'high',
    })
  }

  // 9. Script injection via expression interpolation
  let inRunBlock = false
  let runIndent: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineRunIndent = isWorkflowStepRunKey(lines, i) ? yamlEntryIndent(line, 'run') : null
    if (lineRunIndent !== null) {
      inRunBlock = true
      runIndent = lineRunIndent
    } else if (inRunBlock && runIndent !== null) {
      // A sibling mapping key or step at the run key's indentation ends its range.
      const entryIndent = yamlEntryIndent(line)
      if (entryIndent !== null && entryIndent <= runIndent) {
        inRunBlock = false
        runIndent = null
      }
    }

    if (inRunBlock && containsUntrustedGitHubEventExpression(line)) {
      issues.push({
        id: `gha-script-injection-${path}-${i + 1}`,
        ruleId: 'gha-script-injection',
        category: 'security',
        severity: 'critical',
        title: 'GitHub Actions Script Injection',
        description: 'Interpolating untrusted `github.event` fields directly in a `run:` step allows an attacker to inject arbitrary shell commands via crafted issue titles, PR bodies, or commit messages.',
        file: path,
        line: i + 1,
        column: 0,
        snippet: line.trim(),
        suggestion: 'Pass the value through an environment variable instead, then quote that variable when the script uses it.',
        cwe: 'CWE-94',
        confidence: 'high',
      })
    }
  }

  // 10. Overly permissive permissions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*permissions:\s*write-all\s*$/i.test(line)) {
      issues.push({
        id: `gha-permissions-write-all-${path}-${i + 1}`,
        ruleId: 'gha-permissions-write-all',
        category: 'security',
        severity: 'warning',
        title: 'Overly Permissive Workflow Token',
        description: '`permissions: write-all` gives the GITHUB_TOKEN full write access to all scopes. If the workflow is compromised (e.g., via a supply chain attack on an action), the attacker gains excessive privileges.',
        file: path,
        line: i + 1,
        column: 0,
        snippet: line.trim(),
        suggestion: 'Apply the principle of least privilege — declare only the specific permissions needed (e.g., contents: read, issues: write).',
        cwe: 'CWE-250',
        confidence: 'high',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Python dependency checks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// .npmrc auth token check
// ---------------------------------------------------------------------------

const NPMRC_CREDENTIAL_REFERENCE = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\??\}|\$[A-Za-z_][A-Za-z0-9_]*)$/

function isNpmrcCredentialReference(value: string): boolean {
  let normalized = value.trim()
  const first = normalized[0]
  if ((first === '"' || first === "'") && normalized.endsWith(first)) {
    normalized = normalized.slice(1, -1).trim()
  }
  return NPMRC_CREDENTIAL_REFERENCE.test(normalized)
}

function scanNpmrc(
  path: string,
  content: string,
  lines: string[],
  issues: CodeIssue[],
): void {
  const AUTH_PATTERNS = [
    /_authToken\s*=/i,
    /_password\s*=/i,
    /\/\/registry\.npmjs\.org\/:_authToken=/i,
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('#') || !line) continue

    for (const pattern of AUTH_PATTERNS) {
      if (pattern.test(line)) {
        // Check that there's an actual value (not just the key)
        const eqIdx = line.indexOf('=')
        const value = eqIdx !== -1 ? line.substring(eqIdx + 1).trim() : ''
        if (value && !isNpmrcCredentialReference(value) && value !== '""' && value !== "''") {
          issues.push({
            id: `supply-chain-npmrc-auth-${path}-${i + 1}`,
            ruleId: 'supply-chain-npmrc-auth',
            category: 'security',
            severity: 'critical',
            title: 'Auth Token in .npmrc',
            description: 'This .npmrc file contains a hardcoded authentication token. Committing credentials to version control exposes them to anyone with repository access.',
            file: path,
            line: i + 1,
            column: 0,
            snippet: line.replace(/=.*/, '=<REDACTED>'),
            suggestion: 'Use environment variable interpolation (e.g., `${NPM_TOKEN}`) or configure auth tokens outside of version control.',
            cwe: 'CWE-798',
            confidence: 'high',
          })
          return // one issue per .npmrc is sufficient
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Package.json extended checks (overrides, private registry, deprecated)
// ---------------------------------------------------------------------------

const DEPRECATED_PACKAGES: Record<string, { replacement: string; severity: 'warning' | 'info'; reason: string }> = {
  'request': { replacement: 'node-fetch or axios', severity: 'info', reason: 'deprecated and unmaintained' },
  'moment': { replacement: 'dayjs or date-fns', severity: 'info', reason: 'functionally deprecated; large bundle size' },
  'node-uuid': { replacement: 'uuid', severity: 'info', reason: 'deprecated; renamed to uuid' },
  'vm2': { replacement: 'isolated-vm', severity: 'warning', reason: 'deprecated due to unfixable security vulnerabilities' },
  'node-serialize': { replacement: 'safe serialization (JSON.stringify)', severity: 'warning', reason: 'known remote code execution vulnerability' },
}

function scanPackageJsonExtended(
  path: string,
  content: string,
  lines: string[],
  issues: CodeIssue[],
): void {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(content) as Record<string, unknown>
  } catch {
    return
  }

  // supply-chain-overrides: check for overrides / resolutions keys
  if (pkg.overrides || pkg.resolutions) {
    const key = pkg.overrides ? 'overrides' : 'resolutions'
    const line = findLine(lines, `"${key}"`)
    issues.push({
      id: `supply-chain-overrides-${path}`,
      ruleId: 'supply-chain-overrides',
      category: 'security',
      severity: 'info',
      title: 'Package Overrides/Resolutions Detected',
      description: `package.json uses "${key}" to override transitive dependency versions. This can mask dependency issues or be used for dependency confusion attacks.`,
      file: path,
      line,
      column: 0,
      snippet: `"${key}": { ... }`,
      suggestion: 'Review overrides carefully. Document why each override exists and remove them when no longer needed.',
      confidence: 'low',
    })
  }

  // supply-chain-private-registry: publishConfig.registry without scope
  const publishConfig = pkg.publishConfig as Record<string, unknown> | undefined
  if (publishConfig && typeof publishConfig === 'object' && publishConfig.registry) {
    const registry = String(publishConfig.registry)
    // Flag if it's a private registry (not npmjs.org) without scope restriction
    if (!registry.includes('registry.npmjs.org')) {
      const name = typeof pkg.name === 'string' ? pkg.name : ''
      const hasScope = name.startsWith('@')
      if (!hasScope) {
        const line = findLine(lines, '"publishConfig"')
        issues.push({
          id: `supply-chain-private-registry-${path}`,
          ruleId: 'supply-chain-private-registry',
          category: 'security',
          severity: 'info',
          title: 'Private Registry Without Scope',
          description: `publishConfig.registry points to a private registry (${registry}) but the package name is not scoped. Unscoped packages published to private registries can be squatted on the public npm registry.`,
          file: path,
          line,
          column: 0,
          snippet: `"registry": "${registry}"`,
          suggestion: 'Use a scoped package name (e.g., @org/package-name) to prevent public registry squatting.',
          confidence: 'low',
        })
      }
    }
  }

  // supply-chain-deprecated-packages: check for known deprecated packages
  const depSections = ['dependencies', 'devDependencies'] as const
  for (const section of depSections) {
    const deps = pkg[section] as Record<string, string> | undefined
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      const deprecated = DEPRECATED_PACKAGES[name]
      if (!deprecated) continue
      const line = findLine(lines, `"${name}"`)
      issues.push({
        id: `supply-chain-deprecated-package-${path}-${name}`,
        ruleId: 'supply-chain-deprecated-package',
        category: 'security',
        severity: deprecated.severity,
        title: 'Deprecated Package',
        description: `"${name}" is ${deprecated.reason}. Deprecated packages may contain known vulnerabilities and no longer receive security patches.`,
        file: path,
        line,
        column: 0,
        snippet: `"${name}": "${deps[name]}"`,
        suggestion: `Replace with ${deprecated.replacement}.`,
        confidence: 'high',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Python dependency checks
// ---------------------------------------------------------------------------

function scanPythonRequirements(
  path: string,
  lines: string[],
  issues: CodeIssue[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // Skip empty lines, comments, and options
    if (!line || line.startsWith('#') || line.startsWith('-')) continue
    // A pinned dependency uses == (e.g., requests==2.28.0)
    if (!line.includes('==')) {
      issues.push({
        id: `supply-chain-unpinned-python-${path}-${i + 1}`,
        ruleId: 'supply-chain-unpinned-python',
        category: 'security',
        severity: 'info',
        title: 'Unpinned Python Dependency',
        description: `"${line}" is not pinned to an exact version with ==. Unpinned dependencies may resolve to different (potentially compromised) versions across installs.`,
        file: path,
        line: i + 1,
        column: 0,
        snippet: line,
        suggestion: 'Pin to an exact version (e.g., requests==2.28.0) and use pip freeze or pip-compile for reproducible installs.',
        cwe: 'CWE-1104',
        confidence: 'low',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function scanSupplyChain(codeIndex: CodeIndex): CodeIssue[] {
  const issues: CodeIssue[] = []

  for (const [path, file] of codeIndex.files) {
    const content = file.content
    if (!content) continue
    const lines = getFileLines(file)
    const filename = path.split('/').pop() || ''

    if (filename === 'package.json') {
      scanPackageJson(path, content, lines, codeIndex, issues)
      scanPackageJsonExtended(path, content, lines, issues)
    }

    if (filename === 'package-lock.json' || filename === 'yarn.lock' || filename === 'pnpm-lock.yaml') {
      scanLockfile(path, content, lines, issues)
    }

    if (isWorkflowFile(path)) {
      scanGitHubActions(path, lines, issues)
    }

    if (filename === 'requirements.txt') {
      scanPythonRequirements(path, lines, issues)
    }

    if (filename === '.npmrc') {
      scanNpmrc(path, content, lines, issues)
    }
  }

  return issues
}
