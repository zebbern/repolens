import type { Page } from '@playwright/test'

export const FIXTURE_OWNER = 'repolens-fixtures'
export const FIXTURE_REPO = 'sample-repository'
export const FIXTURE_REPOSITORY_URL = `https://github.com/${FIXTURE_OWNER}/${FIXTURE_REPO}`

const FILE_CONTENTS: Record<string, string> = {
  'README.md': '# Sample Repository\n\nA deterministic RepoLens browser-test fixture.\n',
  'LICENSE': 'MIT License\n\nCopyright RepoLens fixtures\n',
  'src/index.ts': "export const greeting = 'hello from the fixture'\n",
}

interface FixtureOptions {
  metadataDelayMs?: number
}

export async function installGitHubRepositoryFixture(
  page: Page,
  { metadataDelayMs = 0 }: FixtureOptions = {},
): Promise<void> {
  await page.route('**/api/github/**', async (route) => {
    const url = new URL(route.request().url())
    const owner = url.searchParams.get('owner') ?? FIXTURE_OWNER
    const name = url.searchParams.get('name') ?? FIXTURE_REPO

    if (url.pathname === '/api/github/repo') {
      if (name === 'missing-repository') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Repository not found' } }),
        })
        return
      }

      if (metadataDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, metadataDelayMs))
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          owner,
          name,
          fullName: `${owner}/${name}`,
          description: 'Controlled browser-test repository',
          defaultBranch: 'main',
          stars: 42,
          forks: 3,
          language: 'TypeScript',
          topics: ['testing'],
          isPrivate: false,
          url: `https://github.com/${owner}/${name}`,
          openIssuesCount: 0,
          pushedAt: '2026-01-01T00:00:00Z',
          license: 'MIT',
        }),
      })
      return
    }

    if (url.pathname === '/api/github/tree') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sha: 'fixture-tree-sha',
          truncated: false,
          tree: [
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readme-sha', size: FILE_CONTENTS['README.md'].length },
            { path: 'LICENSE', mode: '100644', type: 'blob', sha: 'license-sha', size: FILE_CONTENTS.LICENSE.length },
            { path: 'src', mode: '040000', type: 'tree', sha: 'src-sha' },
            { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'index-sha', size: FILE_CONTENTS['src/index.ts'].length },
          ],
        }),
      })
      return
    }

    if (url.pathname === '/api/github/file') {
      const path = url.searchParams.get('path') ?? ''
      const content = FILE_CONTENTS[path]
      await route.fulfill({
        status: content === undefined ? 404 : 200,
        contentType: 'application/json',
        body: JSON.stringify(content === undefined
          ? { error: { message: 'Fixture file not found' } }
          : { content }),
      })
      return
    }

    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: `No fixture for ${url.pathname}` } }),
    })
  })
}
