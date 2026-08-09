import { describe, it, expect } from 'vitest'
import { computeFileRenames, buildTreeFromFiles } from './rename-files'
import type { FileNode } from '@/types/repository'

// ---------------------------------------------------------------------------
// computeFileRenames
// ---------------------------------------------------------------------------

describe('computeFileRenames', () => {
  const paths = ['src/foo.ts', 'src/foo.test.ts', 'src/bar.ts', 'docs/foo.md']

  it('replaces every occurrence of the find term in matching paths', () => {
    const { renames } = computeFileRenames(paths, 'foo', 'baz')
    expect(renames).toContainEqual({ from: 'src/foo.ts', to: 'src/baz.ts' })
    expect(renames).toContainEqual({ from: 'src/foo.test.ts', to: 'src/baz.test.ts' })
    expect(renames).toContainEqual({ from: 'docs/foo.md', to: 'docs/baz.md' })
  })

  it('ignores paths that do not contain the find term', () => {
    const { renames } = computeFileRenames(paths, 'foo', 'baz')
    expect(renames.find(r => r.from === 'src/bar.ts')).toBeUndefined()
  })

  it('returns nothing for an empty find term', () => {
    expect(computeFileRenames(paths, '', 'x')).toEqual({ renames: [], conflicts: [] })
  })

  it('skips a rename whose target collides with an existing file', () => {
    // renaming bar.ts -> foo.ts would collide with the existing src/foo.ts
    const { renames, conflicts } = computeFileRenames(['src/foo.ts', 'src/bar.ts'], 'bar', 'foo')
    expect(renames).toEqual([])
    expect(conflicts).toContainEqual({ from: 'src/bar.ts', to: 'src/foo.ts' })
  })

  it('flags duplicate targets (two sources → one path) as conflicts', () => {
    // regex "one|two" makes both files map to dir/same.ts
    const { renames, conflicts } = computeFileRenames(['dir/one.ts', 'dir/two.ts'], 'one|two', 'same', { regex: true })
    expect(renames).toEqual([])
    expect(conflicts).toHaveLength(2)
    expect(conflicts.every(c => c.to === 'dir/same.ts')).toBe(true)
  })

  it('flags malformed targets (empty segment / trailing slash) as conflicts', () => {
    const { renames, conflicts } = computeFileRenames(['src/foo.ts'], 'foo.ts', '')
    expect(renames).toEqual([])
    expect(conflicts).toContainEqual({ from: 'src/foo.ts', to: 'src/' })
  })

  it('is case-insensitive by default and case-sensitive when requested', () => {
    const insensitive = computeFileRenames(['src/Foo.ts'], 'foo', 'bar')
    expect(insensitive.renames).toContainEqual({ from: 'src/Foo.ts', to: 'src/bar.ts' })

    const sensitive = computeFileRenames(['src/Foo.ts'], 'foo', 'bar', { caseSensitive: true })
    expect(sensitive.renames).toEqual([])
  })

  it('returns nothing for an invalid regex', () => {
    expect(computeFileRenames(['a.ts'], '(', 'x', { regex: true })).toEqual({ renames: [], conflicts: [] })
  })
})

// ---------------------------------------------------------------------------
// buildTreeFromFiles
// ---------------------------------------------------------------------------

function fileNode(path: string, extra: Partial<FileNode> = {}): FileNode {
  return { name: path.split('/').pop() ?? path, path, type: 'file', ...extra }
}

describe('buildTreeFromFiles', () => {
  it('reconstructs a nested tree with synthesized directories', () => {
    const tree = buildTreeFromFiles([fileNode('src/app.ts'), fileNode('src/lib/util.ts'), fileNode('readme.md')])

    const top = tree.map(n => n.path)
    expect(top).toContain('src')
    expect(top).toContain('readme.md')

    const src = tree.find(n => n.path === 'src')!
    expect(src.type).toBe('directory')
    expect(src.children!.map(c => c.path)).toEqual(expect.arrayContaining(['src/lib', 'src/app.ts']))

    const lib = src.children!.find(n => n.path === 'src/lib')!
    expect(lib.children!.map(c => c.path)).toEqual(['src/lib/util.ts'])
  })

  it('orders directories before files and alphabetically within a level', () => {
    const tree = buildTreeFromFiles([fileNode('z.ts'), fileNode('a/b.ts'), fileNode('a.ts')])
    expect(tree.map(n => ({ path: n.path, type: n.type }))).toEqual([
      { path: 'a', type: 'directory' },
      { path: 'a.ts', type: 'file' },
      { path: 'z.ts', type: 'file' },
    ])
  })

  it('preserves size and language on file nodes', () => {
    const tree = buildTreeFromFiles([fileNode('src/app.ts', { size: 1234, language: 'typescript' })])
    const file = tree.find(n => n.path === 'src')!.children!.find(c => c.path === 'src/app.ts')!
    expect(file.size).toBe(1234)
    expect(file.language).toBe('typescript')
  })

  it('preserves a visible submodule leaf without converting it to a file', () => {
    const tree = buildTreeFromFiles([{
      name: 'vendor', path: 'vendor', type: 'submodule', gitType: 'commit',
    }])
    expect(tree).toEqual([expect.objectContaining({ path: 'vendor', type: 'submodule', gitType: 'commit' })])
  })
})
