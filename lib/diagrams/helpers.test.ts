import { sanitizeId, escapeMermaidLabel, shortenPath, getTopDir, computeCommonStats, getAvailableDiagrams } from '@/lib/diagrams/helpers'
import { createRealisticAnalysis, createEmptyAnalysis, createMinimalAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'

describe('sanitizeId', () => {
  it('encodes non-alphanumeric characters with Mermaid-safe ids', () => {
    expect(sanitizeId('src/components/Button.tsx')).toBe('id_src_2f_components_2f_Button_2e_tsx')
  })

  it('preserves distinctions between repeated punctuation', () => {
    expect(sanitizeId('a--b..c')).toBe('id_a_2d__2d_b_2e__2e_c')
  })

  it('encodes leading and trailing punctuation', () => {
    expect(sanitizeId('/path/to/')).toBe('id__2f_path_2f_to_2f_')
  })

  it('handles empty string', () => {
    expect(sanitizeId('')).toBe('id_')
  })

  it('preserves already-clean identifiers', () => {
    expect(sanitizeId('myComponent123')).toBe('id_myComponent123')
  })

  it('handles paths with special regex characters', () => {
    expect(sanitizeId('file[0].test(1)+2')).toBe('id_file_5b_0_5d__2e_test_28_1_29__2b_2')
  })

  it('keeps lossy path sanitization collision-free', () => {
    expect(sanitizeId('src/a-b.ts')).not.toBe(sanitizeId('src/a_b.ts'))
    expect(sanitizeId('src/a-b.ts')).toBe(sanitizeId('src/a-b.ts'))

    const first = 'src_part/part/part-part/part_part.part_part/part.part_part/part_file.ts'
    const second = 'src/part/part-part/part.part.part/part-part/part_part-part-part-file.ts'
    expect(sanitizeId(first)).not.toBe(sanitizeId(second))
  })

  it('avoids Mermaid reserved token ids', () => {
    expect(sanitizeId('end')).not.toBe('end')
    expect(sanitizeId('end')).toBe('id_end')
  })
})

describe('escapeMermaidLabel', () => {
  it('encodes Mermaid label delimiters and removes newlines', () => {
    expect(escapeMermaidLabel('a"b & c\n<d>')).toBe('a&quot;b &amp; c &lt;d&gt;')
  })
})

describe('shortenPath', () => {
  it('returns path unchanged if 2 or fewer segments', () => {
    expect(shortenPath('src/file.ts')).toBe('src/file.ts')
  })

  it('shortens long paths with ellipsis', () => {
    expect(shortenPath('src/components/deep/Button.tsx')).toBe('src/.../Button.tsx')
  })

  it('handles single segment', () => {
    expect(shortenPath('index.ts')).toBe('index.ts')
  })

  it('handles exactly 3 segments', () => {
    expect(shortenPath('a/b/c')).toBe('a/.../c')
  })

  it('handles empty string', () => {
    expect(shortenPath('')).toBe('')
  })
})

describe('getTopDir', () => {
  it('returns first path segment', () => {
    expect(getTopDir('src/components/Button.tsx')).toBe('src')
  })

  it('returns the whole path if no slashes', () => {
    expect(getTopDir('index.ts')).toBe('index.ts')
  })

  it('handles empty string', () => {
    expect(getTopDir('')).toBe('')
  })
})

describe('computeCommonStats', () => {
  it('computes stats for a realistic analysis', () => {
    const analysis = createRealisticAnalysis()
    const stats = computeCommonStats(analysis)

    expect(stats.totalEdges).toBeGreaterThan(0)
    expect(stats.circularDeps).toBeDefined()
    expect(stats.circularDeps).toHaveLength(1)
    expect(stats.mostImported).toBeDefined()
    expect(stats.mostImported!.path).toBe('src/types.ts')
    expect(stats.avgDepsPerFile).toBeGreaterThan(0)
  })

  it('returns zeros for an empty analysis', () => {
    const analysis = createEmptyAnalysis()
    const stats = computeCommonStats(analysis)

    expect(stats.totalEdges).toBe(0)
    expect(stats.avgDepsPerFile).toBe(0)
    expect(stats.circularDeps).toBeUndefined()
    expect(stats.mostImported).toBeUndefined()
    expect(stats.mostDependent).toBeUndefined()
  })

  it('identifies most dependent file correctly', () => {
    const analysis = createRealisticAnalysis()
    const stats = computeCommonStats(analysis)

    expect(stats.mostDependent).toBeDefined()
    // src/app.tsx has 2 deps; src/services/api.ts also has 2 deps — either is valid
    expect(stats.mostDependent!.count).toBeGreaterThanOrEqual(2)
  })
})

describe('getAvailableDiagrams', () => {
  it('returns correct diagram list for a realistic analysis', () => {
    const analysis = createRealisticAnalysis()
    const diagrams = getAvailableDiagrams(analysis)

    const ids = diagrams.map(d => d.id)
    expect(ids).toContain('topology')
    expect(ids).toContain('classes')
    expect(ids).toContain('entrypoints')
    expect(ids).toContain('treemap')
    // imports and externals are no longer listed
    expect(ids).not.toContain('imports')
    expect(ids).not.toContain('externals')

    // types.ts has types, so 'classes' should be present and available
    const classesDiagram = diagrams.find(d => d.id === 'classes')
    expect(classesDiagram?.available).toBe(true)
  })

  it('orders Treemap immediately before Architecture', () => {
    const diagrams = getAvailableDiagrams(createRealisticAnalysis())

    expect(diagrams.slice(0, 2).map(diagram => diagram.id)).toEqual(['treemap', 'topology'])
  })

  it('excludes classes from list when no types/classes exist', () => {
    const analysis = createMinimalAnalysis()
    const diagrams = getAvailableDiagrams(analysis)
    const classesDiagram = diagrams.find(d => d.id === 'classes')
    expect(classesDiagram).toBeUndefined()
  })

  it('labels entrypoints as Routes when a framework is detected', () => {
    const analysis = createRealisticAnalysis()
    analysis.detectedFramework = 'Next.js'
    const diagrams = getAvailableDiagrams(analysis)
    const ep = diagrams.find(d => d.id === 'entrypoints')
    expect(ep?.label).toBe('Routes')
  })

  it('labels modules tab as Components when JSX components exist', () => {
    const analysis = createRealisticAnalysis()
    const diagrams = getAvailableDiagrams(analysis)
    const modules = diagrams.find(d => d.id === 'modules')
    expect(modules?.label).toBe('Components')
  })

  it('returns all diagrams unavailable/minimal for empty analysis', () => {
    const analysis = createEmptyAnalysis()
    const diagrams = getAvailableDiagrams(analysis)

    const topology = diagrams.find(d => d.id === 'topology')
    expect(topology?.available).toBe(false)

    // classes should be excluded entirely (no types in empty analysis)
    const classes = diagrams.find(d => d.id === 'classes')
    expect(classes).toBeUndefined()

    // imports and externals are no longer listed
    expect(diagrams.find(d => d.id === 'imports')).toBeUndefined()
    expect(diagrams.find(d => d.id === 'externals')).toBeUndefined()

    const modules = diagrams.find(d => d.id === 'modules')
    expect(modules?.available).toBe(false)

    // These are always available
    const entrypoints = diagrams.find(d => d.id === 'entrypoints')
    expect(entrypoints?.available).toBe(true)

    const treemap = diagrams.find(d => d.id === 'treemap')
    expect(treemap?.available).toBe(true)
  })

  it('computeCommonStats handles minimal analysis (1 file, no deps)', () => {
    const analysis = createMinimalAnalysis()
    const stats = computeCommonStats(analysis)

    expect(stats.totalEdges).toBe(0)
    expect(stats.avgDepsPerFile).toBe(0)
    expect(stats.circularDeps).toBeUndefined()
    expect(stats.mostImported).toBeUndefined()
    expect(stats.mostDependent).toBeUndefined()
  })
})
