import { describe, expect, it, vi } from 'vitest'
import {
  collectGitHubPages,
  getNextPageLink,
  GITHUB_LIST_MAX_PAGES,
  GITHUB_LIST_PAGE_SIZE,
} from '../pagination'

const API = 'https://api.github.com/repositories/42/tags'

function link(rels: Record<string, number>): string {
  return Object.entries(rels)
    .map(([rel, page]) => `<${API}?per_page=100&page=${page}>; rel="${rel}"`)
    .join(', ')
}

describe('getNextPageLink', () => {
  it('returns the rel="next" target wherever it appears in the Link header', () => {
    expect(getNextPageLink(link({ prev: 1, next: 3, last: 9 }))).toBe(`${API}?per_page=100&page=3`)
  })

  it('returns null when GitHub advertises no next page', () => {
    expect(getNextPageLink(link({ prev: 8, first: 1 }))).toBeNull()
    expect(getNextPageLink(null)).toBeNull()
    expect(getNextPageLink('')).toBeNull()
  })
})

describe('collectGitHubPages', () => {
  it('uses GitHub list defaults of 100 items per page and a 10-page cap', () => {
    expect(GITHUB_LIST_PAGE_SIZE).toBe(100)
    expect(GITHUB_LIST_MAX_PAGES).toBe(10)
  })

  it('follows next links in order until GitHub stops advertising one', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return { items: [`item-${page}`], linkHeader: page < 3 ? link({ next: page + 1, last: 3 }) : link({ first: 1 }) }
    })

    const result = await collectGitHubPages(`${API}?per_page=100&page=1`, fetchPage)

    expect(result).toEqual({ items: ['item-1', 'item-2', 'item-3'], truncated: false })
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
      `${API}?per_page=100&page=1`,
      `${API}?per_page=100&page=2`,
      `${API}?per_page=100&page=3`,
    ])
  })

  it('stops at the page cap and marks the result truncated when more pages remain', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return { items: [page], linkHeader: link({ next: page + 1 }) }
    })

    const result = await collectGitHubPages(`${API}?page=1`, fetchPage, 4)

    expect(fetchPage).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ items: [1, 2, 3, 4], truncated: true })
  })

  it('applies the default 10-page cap', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return { items: [page], linkHeader: link({ next: page + 1 }) }
    })

    const result = await collectGitHubPages(`${API}?page=1`, fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(GITHUB_LIST_MAX_PAGES)
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(GITHUB_LIST_MAX_PAGES)
  })

  it('does not follow a next link off api.github.com and reports the list as truncated', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a'], linkHeader: '<https://evil.example/steal?page=2>; rel="next"' })

    const result = await collectGitHubPages(`${API}?page=1`, fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ items: ['a'], truncated: true })
  })

  it('does not follow a plain-http next link', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a'], linkHeader: '<http://api.github.com/repositories/42/tags?page=2>; rel="next"' })

    const result = await collectGitHubPages(`${API}?page=1`, fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result.truncated).toBe(true)
  })

  it('propagates page failures instead of returning a partial list', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a'], linkHeader: link({ next: 2 }) })
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))

    await expect(collectGitHubPages(`${API}?page=1`, fetchPage)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})
