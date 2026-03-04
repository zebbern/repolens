/**
 * Tests for 4 newly added supply chain scanner checks.
 *
 * Rules: supply-chain-npmrc-auth, supply-chain-overrides,
 *        supply-chain-private-registry, supply-chain-deprecated-package.
 */

import { describe, it, expect } from 'vitest'
import { scanSupplyChain } from './supply-chain-scanner'
import { createEmptyIndex, indexFile } from '../code-index'
import type { CodeIssue } from './types'

// ============================================================================
// Helpers
// ============================================================================

function scanWithFiles(files: Array<{ path: string; content: string; lang?: string }>) {
  let index = createEmptyIndex()
  for (const f of files) {
    index = indexFile(index, f.path, f.content, f.lang)
  }
  return scanSupplyChain(index)
}

function issuesForRule(issues: CodeIssue[], ruleId: string) {
  return issues.filter(i => i.ruleId === ruleId)
}

// ============================================================================
// supply-chain-npmrc-auth
// ============================================================================

describe('supply-chain-npmrc-auth', () => {
  it('detects _authToken in .npmrc', () => {
    const issues = scanWithFiles([
      { path: '.npmrc', content: '//registry.npmjs.org/:_authToken=npm_1234567890abcdefghijklmnop' },
    ])
    const hits = issuesForRule(issues, 'supply-chain-npmrc-auth')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects _password in .npmrc', () => {
    const issues = scanWithFiles([
      { path: '.npmrc', content: '_password=c3VwZXJzZWNyZXQ=' },
    ])
    const hits = issuesForRule(issues, 'supply-chain-npmrc-auth')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag .npmrc without credentials', () => {
    const issues = scanWithFiles([
      { path: '.npmrc', content: 'registry=https://registry.npmjs.org/\nsave-exact=true' },
    ])
    const hits = issuesForRule(issues, 'supply-chain-npmrc-auth')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// supply-chain-overrides
// ============================================================================

describe('supply-chain-overrides', () => {
  it('detects overrides in package.json', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      overrides: {
        'lodash': '4.17.21',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-overrides')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects resolutions in package.json', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      resolutions: {
        'minimist': '1.2.8',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-overrides')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag package.json without overrides', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: { 'react': '^18.0.0' },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-overrides')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// supply-chain-private-registry
// ============================================================================

describe('supply-chain-private-registry', () => {
  it('detects non-scoped package with private registry', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      publishConfig: {
        registry: 'https://internal.company.com/npm/',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-private-registry')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('does not flag scoped package with private registry', () => {
    const pkg = JSON.stringify({
      name: '@company/my-lib',
      version: '1.0.0',
      publishConfig: {
        registry: 'https://internal.company.com/npm/',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-private-registry')
    expect(hits).toHaveLength(0)
  })

  it('does not flag package using npmjs registry', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      publishConfig: {
        registry: 'https://registry.npmjs.org/',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-private-registry')
    expect(hits).toHaveLength(0)
  })
})

// ============================================================================
// supply-chain-deprecated-package
// ============================================================================

describe('supply-chain-deprecated-package', () => {
  it('detects request package (deprecated)', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: {
        'request': '^2.88.0',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].severity).toBe('info')
  })

  it('detects moment package (deprecated)', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: {
        'moment': '^2.29.0',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects vm2 in devDependencies (deprecated)', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      devDependencies: {
        'vm2': '^3.9.0',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects node-serialize (deprecated)', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: {
        'node-serialize': '^0.0.4',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('detects node-uuid (deprecated, use uuid)', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: {
        'node-uuid': '^1.4.0',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag non-deprecated packages', () => {
    const pkg = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: {
        'react': '^18.0.0',
        'next': '^14.0.0',
        'uuid': '^9.0.0',
      },
    }, null, 2)
    const issues = scanWithFiles([
      { path: 'package.json', content: pkg },
    ])
    const hits = issuesForRule(issues, 'supply-chain-deprecated-package')
    expect(hits).toHaveLength(0)
  })
})
