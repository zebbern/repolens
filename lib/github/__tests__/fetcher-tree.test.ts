import { describe, expect, it } from 'vitest'
import type { CompleteRepoTree } from '@/types/repository'
import { flattenFiles } from '@/lib/code/code-index'
import { buildFileTree, buildFileTreeString } from '../fetcher'

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
