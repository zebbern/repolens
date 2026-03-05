import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildShareableUrl, parseShareableUrl } from './shareable-url'

// ---------------------------------------------------------------------------
// jsdom provides a window/location object; we control it via URL assignment.
// ---------------------------------------------------------------------------

describe('buildShareableUrl', () => {
  it('produces a path-based URL from a GitHub repo URL', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/repo',
    })

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/owner/repo')
    expect(parsed.searchParams.has('repo')).toBe(false)
  })

  it('includes a view param when view is not "repo"', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/repo',
      view: 'diagram',
    })

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/owner/repo')
    expect(parsed.searchParams.get('view')).toBe('diagram')
  })

  it('omits the view param when view is "repo" (default tab)', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/repo',
      view: 'repo',
    })

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/owner/repo')
    expect(parsed.searchParams.has('view')).toBe(false)
  })

  it('omits the view param when view is undefined', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/repo',
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.has('view')).toBe(false)
  })

  it('includes a view param for git-history', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/repo',
      view: 'git-history',
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.get('view')).toBe('git-history')
  })

  it('handles hyphenated repo names correctly', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://github.com/owner/my-repo',
      view: 'code',
    })

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/owner/my-repo')
    expect(parsed.searchParams.get('view')).toBe('code')
  })

  it('falls back to query-param format for non-GitHub URLs', () => {
    const url = buildShareableUrl({
      repoUrl: 'https://gitlab.com/owner/repo',
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.get('repo')).toBe('https://gitlab.com/owner/repo')
  })
})

describe('parseShareableUrl', () => {
  it('extracts repo from path-based URL', () => {
    const result = parseShareableUrl('', '/owner/repo')

    expect(result).not.toBeNull()
    expect(result!.repoUrl).toBe('https://github.com/owner/repo')
  })

  it('extracts view from query params in path-based URL', () => {
    const result = parseShareableUrl('?view=issues', '/owner/repo')

    expect(result).not.toBeNull()
    expect(result!.repoUrl).toBe('https://github.com/owner/repo')
    expect(result!.view).toBe('issues')
  })

  it('falls back to query-param format (legacy)', () => {
    const result = parseShareableUrl('?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo', '/')

    expect(result).not.toBeNull()
    expect(result!.repoUrl).toBe('https://github.com/owner/repo')
  })

  it('extracts the view param from legacy format', () => {
    const result = parseShareableUrl('?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&view=issues', '/')

    expect(result).not.toBeNull()
    expect(result!.view).toBe('issues')
  })

  it('returns undefined view when view param is absent', () => {
    const result = parseShareableUrl('', '/owner/repo')

    expect(result).not.toBeNull()
    expect(result!.view).toBeUndefined()
  })

  it('returns null when no repo info is present', () => {
    const result = parseShareableUrl('?view=diagram', '/')
    expect(result).toBeNull()
  })

  it('returns null for empty inputs at root', () => {
    const result = parseShareableUrl('', '/')
    expect(result).toBeNull()
  })

  it('path-based format takes priority over query-param', () => {
    const result = parseShareableUrl(
      '?repo=https%3A%2F%2Fgithub.com%2Fother%2Frepo',
      '/owner/repo',
    )

    expect(result).not.toBeNull()
    expect(result!.repoUrl).toBe('https://github.com/owner/repo')
  })

  it('round-trips with buildShareableUrl', () => {
    const original = {
      repoUrl: 'https://github.com/acme/project',
      view: 'docs' as const,
    }

    const url = buildShareableUrl(original)
    const parsedUrl = new URL(url)
    const parsed = parseShareableUrl(parsedUrl.search, parsedUrl.pathname)

    expect(parsed).not.toBeNull()
    expect(parsed!.repoUrl).toBe(original.repoUrl)
    expect(parsed!.view).toBe(original.view)
  })
})
