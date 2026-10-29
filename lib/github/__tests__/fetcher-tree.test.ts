import { describe, expect, it } from 'vitest'
import type { CompleteRepoTree, FileNode, RepoTreeItem } from '@/types/repository'
import { flattenFiles } from '@/lib/code/code-index'
import { buildFileTree, buildFileTreeString } from '../fetcher'

function treeOf(items: RepoTreeItem[]): CompleteRepoTree {
  return { status: 'complete', sha: 'root', truncated: false, requestCount: 1, tree: items }
}

function dir(path: string): RepoTreeItem {
  return { path, mode: '040000', type: 'tree', sha: `sha-${path}` }
}

function blob(path: string): RepoTreeItem {
  return { path, mode: '100644', type: 'blob', sha: `sha-${path}`, size: 1 }
}

function allPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap(node => [node.path, ...allPaths(node.children ?? [])])
}

describe('buildFileTree missing parent directories', () => {
  it('synthesizes a missing intermediate directory instead of dropping its children', () => {
    const nodes = buildFileTree(treeOf([
      dir('src'),
      blob('src/lib/util.ts'),
      blob('src/index.ts'),
    ]))

    const src = nodes.find(node => node.path === 'src')
    expect(src?.children?.map(node => node.path)).toEqual(['src/lib', 'src/index.ts'])
    expect(src?.children?.[0]).toEqual({
      name: 'lib',
      path: 'src/lib',
      type: 'directory',
      gitType: 'tree',
      size: undefined,
      language: undefined,
      children: [expect.objectContaining({ path: 'src/lib/util.ts', type: 'file', language: 'typescript' })],
    })
  })

  it('synthesizes the whole ancestor chain of a deeply nested orphan', () => {
    const nodes = buildFileTree(treeOf([blob('a/b/c/d/e.ts')]))

    expect(allPaths(nodes)).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e.ts'])
    expect(flattenFiles(nodes).map(node => node.path)).toEqual(['a/b/c/d/e.ts'])
  })

  it('places synthesized directories in the same sorted position as real ones for any entry order', () => {
    const complete = [
      dir('alpha'),
      dir('alpha/nested'),
      blob('alpha/nested/deep.ts'),
      blob('alpha/x.ts'),
      dir('zeta'),
      blob('zeta/z.ts'),
      blob('README.md'),
    ]
    const missingDirectories = [
      blob('README.md'),
      blob('alpha/nested/deep.ts'),
      blob('zeta/z.ts'),
      blob('alpha/x.ts'),
      dir('zeta'),
    ]

    const expected = buildFileTree(treeOf(complete))
    const rebuilt = buildFileTree(treeOf(missingDirectories))

    expect(rebuilt).toEqual(expected)
    expect(rebuilt.map(node => node.path)).toEqual(['alpha', 'zeta', 'README.md'])
    expect(allPaths(rebuilt)).toHaveLength(complete.length)
  })
})

describe('buildFileTree submodules', () => {
  it('keeps commit entries visible as submodules but excludes them from generic files', () => {
    const tree: CompleteRepoTree = {
      status: 'complete', sha: 'root', truncated: false, requestCount: 1,
      tree: [
        { path: 'src', mode: '040000', type: 'tree', sha: 'src' },
        { path: 'src/app.ts', mode: '100644', type: 'blob', sha: 'file', size: 10 },
        { path: 'vendor', mode: '040000', type: 'tree', sha: 'vendor' },
        { path: 'vendor/sdk', mode: '160000', type: 'commit', sha: 'submodule' },
      ],
    }

    const nodes = buildFileTree(tree)
    expect(nodes.find(node => node.path === 'vendor')?.children).toContainEqual(
      expect.objectContaining({ path: 'vendor/sdk', type: 'submodule' }),
    )
    expect(flattenFiles(nodes).map(node => node.path)).toEqual(['src/app.ts'])
    expect(buildFileTreeString(nodes)).toContain('sdk [submodule]')
  })
})
