import { generateClassDiagram } from '@/lib/diagrams/generators/class-diagram'
import { createRealisticAnalysis, createMinimalAnalysis, createEmptyAnalysis, createComplexTypesAnalysis, createConcatenatedPropsAnalysis, createCompositionAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'
import type { FullAnalysis } from '@/lib/code/import-parser'
import type { FileAnalysis } from '@/lib/code/parser/types'
import mermaid from 'mermaid'

describe('generateClassDiagram', () => {
  it('bounds a deeply linked type diagram and reports omissions', () => {
    const files = new Map<string, FileAnalysis>()
    for (let i = 0; i < 600; i++) {
      const path = `src/models/Model${i}.ts`
      files.set(path, {
        path, language: 'typescript', imports: [], exports: [], types: [], jsxComponents: [],
        classes: [{ name: `Model${i}`, methods: [], properties: Array.from({ length: i >= 560 ? 10 : 1 }, (_, n) => `field${n}: string`), extends: i > 0 ? `Model${i - 1}` : undefined, exported: true }],
      })
    }
    const analysis = createRealisticAnalysis()
    analysis.files = files
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)
    const relationshipLines = result.chart.split('\n').filter(line => line.includes('<|--') || line.includes('<|..'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalEdges).toBe(relationshipLines.length)
    expect(result.stats.totalEdges).toBeLessThan(500)
    expect(result.stats.omittedNodes).toBeGreaterThan(0)
    expect(result.stats.omittedEdges).toBeGreaterThan(0)
  })

  it('reports independent types omitted by the fallback limit', () => {
    const files = new Map<string, FileAnalysis>()
    for (let i = 0; i < 100; i++) {
      const path = `src/models/Independent${i}.ts`
      files.set(path, {
        path, language: 'typescript', imports: [], exports: [], types: [], jsxComponents: [],
        classes: [{ name: `Independent${i}`, methods: [], properties: [], exported: true }],
      })
    }
    const analysis = createRealisticAnalysis()
    analysis.files = files
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)

    expect(result.stats.totalNodes).toBe(10)
    expect(result.stats.omittedNodes).toBe(90)
    expect(result.title).toBe('Type & Class Diagram (10 of 100 types)')
  })

  it('reports relationships omitted with types outside the connected-type limit', () => {
    const files = new Map<string, FileAnalysis>()
    for (let i = 0; i < 50; i++) {
      const path = `src/pairs/Pair${i}.ts`
      files.set(path, {
        path, language: 'typescript', imports: [], exports: [], types: [], jsxComponents: [],
        classes: [
          { name: `Child${i}`, methods: [], properties: [], extends: `Parent${i}`, exported: true },
          { name: `Parent${i}`, methods: [], properties: [], exported: true },
        ],
      })
    }
    const analysis = createRealisticAnalysis()
    analysis.files = files
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)

    expect(result.stats.totalNodes).toBe(80)
    expect(result.stats.omittedNodes).toBe(20)
    expect(result.stats.totalEdges).toBe(40)
    expect(result.stats.omittedEdges).toBe(10)
  })

  it('prefixes Mermaid-reserved namespace names', async () => {
    const analysis = createRealisticAnalysis()
    analysis.files = new Map<string, FileAnalysis>([
      ['src/namespace/Thing.ts', {
        path: 'src/namespace/Thing.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'Thing', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['src/click/Other.ts', {
        path: 'src/click/Other.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'click', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ...['note', 'callback', 'link'].map((name): [string, FileAnalysis] => [`src/${name}/${name}.ts`, {
        path: `src/${name}/${name}.ts`, language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name, methods: [], properties: [], exported: true }], jsxComponents: [],
      }]),
    ])
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)

    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_namespace["src/namespace"] {')
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_click["src/click"] {')
    expect(result.chart).not.toContain('namespace namespace {')
    expect(result.chart).toContain('class type_click["click"]')
    expect(result.chart).toContain('class type_note["note"]')
    expect(result.chart).toContain('class type_callback["callback"]')
    expect(result.chart).toContain('class type_link["link"]')
    await expect(mermaid.parse(result.chart)).resolves.toMatchObject({ diagramType: 'classDiagram' })
  })

  it('keeps namespace and class ids separate while preserving distinct module paths', async () => {
    const analysis = createRealisticAnalysis()
    analysis.files = new Map([
      ['src/services/services.ts', {
        path: 'src/services/services.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'services', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['src/a-b/One.ts', {
        path: 'src/a-b/One.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'One', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['src/a_b/Two.ts', {
        path: 'src/a_b/Two.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'Two', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['Thing.ts', {
        path: 'Thing.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'Thing', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['src/root/Other.ts', {
        path: 'src/root/Other.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'Other', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['src/foo/SrcFoo.ts', {
        path: 'src/foo/SrcFoo.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'SrcFoo', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
      ['lib/foo/LibFoo.ts', {
        path: 'lib/foo/LibFoo.ts', language: 'typescript', imports: [], exports: [],
        types: [], classes: [{ name: 'LibFoo', methods: [], properties: [], exported: true }], jsxComponents: [],
      }],
    ])
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)

    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_services["src/services"] {')
    expect(result.chart).toContain('class type_services["services"]')
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_a_2d_b["src/a-b"] {')
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_a_5f_b["src/a_b"] {')
    expect(result.chart).toContain('namespace module_id_repository_2d_root_3a_["root"] {')
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_root["src/root"] {')
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_foo["src/foo"] {')
    expect(result.chart).toContain('namespace module_id_directory_3a_lib_2f_foo["lib/foo"] {')
    const originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox')
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
    })
    try {
      const rendered = await mermaid.render(`class_namespace_domain_${Date.now()}`, result.chart)
      expect(rendered.svg).toContain('<svg')
    } finally {
      if (originalGetBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', originalGetBBox)
      else delete (SVGElement.prototype as SVGElement & { getBBox?: () => DOMRect }).getBBox
    }
  })

  it('retains complete relationships when many independent type chains exceed the source budget', () => {
    const files = new Map<string, FileAnalysis>()
    for (let chain = 0; chain < 40; chain++) {
      for (let depth = 0; depth < 60; depth++) {
        const prefix = depth % 2 === 0 ? 'A' : 'Z'
        const name = `${prefix}_C${chain.toString().padStart(2, '0')}_D${depth.toString().padStart(2, '0')}`
        const parentPrefix = (depth - 1) % 2 === 0 ? 'A' : 'Z'
        const parent = depth > 0 ? `${parentPrefix}_C${chain.toString().padStart(2, '0')}_D${(depth - 1).toString().padStart(2, '0')}` : undefined
        const path = `src/chains/${name}.ts`
        files.set(path, {
          path, language: 'typescript', imports: [], exports: [], types: [], jsxComponents: [],
          classes: [{
            name,
            methods: [],
            properties: Array.from({ length: depth === 59 ? 10 : 1 }, (_, index) => `field${index}: string`),
            extends: parent,
            exported: true,
          }],
        })
      }
    }
    const analysis = createRealisticAnalysis()
    analysis.files = files
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)
    const relationshipLines = result.chart.split('\n').filter(line => line.includes('<|--'))

    expect(result.chart.length).toBeLessThanOrEqual(45_000)
    expect(result.stats.totalNodes + (result.stats.omittedNodes ?? 0)).toBe(2_400)
    expect(result.stats.totalEdges).toBe(relationshipLines.length)
    expect(result.stats.totalEdges).toBeGreaterThan(0)
    expect(result.stats.totalEdges + (result.stats.omittedEdges ?? 0)).toBe(2_360)
    expect(generateClassDiagram(analysis)).toEqual(result)
    for (const line of relationshipLines) {
      const match = /^\s*(\S+) <\|-- (\S+)$/.exec(line)
      expect(match).not.toBeNull()
      expect(result.nodePathMap.has(match![1])).toBe(true)
      expect(result.nodePathMap.has(match![2])).toBe(true)
    }
  })

  it('preserves duplicate type names with path-based Mermaid ids and relationships', () => {
    const analysis: FullAnalysis = {
      files: new Map([
        ['src/one.ts', {
          path: 'src/one.ts', language: 'typescript',
          imports: [], exports: [],
          types: [{ name: 'Config', kind: 'interface', properties: ['one: string'], exported: true }], classes: [], jsxComponents: [],
        }],
        ['src/two.ts', {
          path: 'src/two.ts', language: 'typescript',
          imports: [], exports: [],
          types: [{ name: 'Config', kind: 'interface', properties: ['two: string'], exported: true }], classes: [], jsxComponents: [],
        }],
        ['src/consumer-one.ts', {
          path: 'src/consumer-one.ts', language: 'typescript',
          imports: [{ source: './one', resolvedPath: 'src/one.ts', specifiers: ['Config'], isExternal: false, isDefault: false }], exports: [], types: [],
          classes: [{ name: 'OneConsumer', methods: [], properties: [], extends: 'Config', exported: true }], jsxComponents: [],
        }],
        ['src/consumer-two.ts', {
          path: 'src/consumer-two.ts', language: 'typescript',
          imports: [{ source: './two', resolvedPath: 'src/two.ts', specifiers: ['Config'], isExternal: false, isDefault: false }], exports: [], types: [],
          classes: [{ name: 'TwoConsumer', methods: [], properties: [], extends: 'Config', exported: true }], jsxComponents: [],
        }],
      ]),
      graph: { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() },
      topology: { entryPoints: [], hubs: [], orphans: [], leafNodes: [], connectors: [], clusters: [], depthMap: new Map(), maxDepth: 0 },
      detectedFramework: null, primaryLanguage: 'typescript',
    }

    const result = generateClassDiagram(analysis)
    const classDeclarations = result.chart.split('\n').filter(line => line.trim().startsWith('class '))

    expect(result.nodePathMap.size).toBe(4)
    expect([...result.nodePathMap.values()]).toEqual(expect.arrayContaining(['src/one.ts', 'src/two.ts']))
    expect(classDeclarations.filter(line => line.includes('["Config"]'))).toHaveLength(2)
    expect(result.chart.match(/<\|--/g)).toHaveLength(2)
  })

  it('resolves same-file type names that collide only after sanitization', () => {
    const analysis = createRealisticAnalysis()
    analysis.files = new Map([['src/models.ts', {
      path: 'src/models.ts', language: 'typescript', imports: [], exports: [], types: [], jsxComponents: [],
      classes: [
        { name: 'A_B', methods: [], properties: [], extends: 'A$B', exported: true },
        { name: 'A$B', methods: [], properties: [], exported: true },
      ],
    }]])
    analysis.graph = { edges: new Map(), reverseEdges: new Map(), circular: [], externalDeps: new Map() }

    const result = generateClassDiagram(analysis)

    expect(result.nodePathMap.size).toBe(2)
    expect(result.chart).toContain('["A_B"]')
    expect(result.chart).toContain('["A$B"]')
    expect(result.chart.match(/<\|--/g)).toHaveLength(1)
    expect(result.stats.totalEdges).toBe(1)
  })

  it('produces a classDiagram with types for realistic analysis', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    expect(result.type).toBe('classes')
    expect(result.chart).toContain('classDiagram')
    // Only connected types (via inheritance/implements) should be rendered
    expect(result.chart).toContain('ApiClient')
    expect(result.chart).toContain('BaseClient')
    expect(result.chart).toContain('HttpClient')
    expect(result.chart).toContain('<<interface>>')
    // Types should be grouped in module namespaces
    expect(result.chart).toContain('namespace module_id_directory_3a_src_2f_services["src/services"]')
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(3)
  })

  it('renders enum types with <<enumeration>> stereotype', () => {
    const result = generateClassDiagram(createCompositionAnalysis())

    expect(result.chart).toContain('Status')
    expect(result.chart).toContain('<<enumeration>>')
  })

  it('renders extends/implements relationships', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    // ApiClient extends BaseClient
    expect(result.chart).toContain('type_BaseClient <|-- type_ApiClient')
    // ApiClient implements HttpClient
    expect(result.chart).toContain('type_HttpClient <|.. type_ApiClient')
    expect(result.stats.totalEdges).toBeGreaterThanOrEqual(2)
  })

  it('shows fallback message when no types exist', () => {
    const result = generateClassDiagram(createMinimalAnalysis())

    expect(result.chart).toContain('No classes, interfaces, or types found')
    expect(result.stats.totalNodes).toBe(0)
  })

  it('handles empty analysis without crashing', () => {
    const result = generateClassDiagram(createEmptyAnalysis())

    expect(result.type).toBe('classes')
    expect(result.stats.totalNodes).toBe(0)
  })

  it('includes parent types referenced by extends even if not in top N', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    // BaseClient and HttpClient are referenced via extends/implements
    // They should be pulled in even if they wouldn't be in the top 40
    expect(result.chart).toContain('BaseClient')
    expect(result.chart).toContain('HttpClient')
  })

  it('populates nodePathMap', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    expect(result.nodePathMap.size).toBeGreaterThan(0)
    // Connected types should map to their source file paths
    expect(result.nodePathMap.get('type_ApiClient')).toBe('src/services/api.ts')
    expect(result.nodePathMap.get('type_BaseClient')).toBe('src/services/auth.ts')
  })

  describe('complex type handling', () => {
    it('renders utility types without garbage property extraction', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // Write is a utility type (Omit<T, keyof U> & U) — should NOT show individual
      // fragments as separate properties like "Omit" or "U export function"
      expect(result.chart).toContain('Write')
      expect(result.chart).toContain('<<type>>')
      // Should NOT have "+Omit" as a property line
      expect(result.chart).not.toMatch(/\+Omit/)
    })

    it('renders union string literal types cleanly', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      expect(result.chart).toContain('Status')
      // Union members should be shown as a signature, not as individual property lines
      expect(result.chart).not.toMatch(/\+'active'/)
    })

    it('renders object-like type aliases with real properties', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // UserConfig has real properties (name: string, age: number)
      expect(result.chart).toContain('UserConfig')
      expect(result.chart).toContain('name : string')
      expect(result.chart).toContain('age : number')
    })

    it('renders interfaces with real properties normally', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      expect(result.chart).toContain('UserProps')
      expect(result.chart).toContain('<<interface>>')
      expect(result.chart).toContain('id : number')
      expect(result.chart).toContain('name : string')
    })

    it('shows a compact type signature for non-object types', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // Nullable type (T | null) should show a cleaned-up signature
      expect(result.chart).toContain('Nullable')
      // Should contain the signature as a single readable line, not as separate props
      const nullableBlock = result.chart.split('class type_Nullable')[1]?.split('}')[0] || ''
      // The block should have <<type>> and some simplified text, not multiple property lines
      expect(nullableBlock).toContain('<<type>>')
    })

    it('filters garbage properties from types with leaked file context', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // Config has 2/6 clean properties (<50%) — should render empty class box
      expect(result.chart).toContain('Config')
      const configBlock = result.chart.split('class type_Config')[1]?.split('}')[0] || ''
      expect(configBlock).toContain('<<type>>')
      // Should not contain any properties or garbage — just the stereotype
      expect(configBlock).not.toContain('name')
      expect(configBlock).not.toContain('export')
      expect(configBlock).not.toContain('import')
      expect(configBlock).not.toContain('declare')
    })

    it('shows empty class box for interfaces with all garbage properties', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // LeakyInterface has 0/4 clean properties — should render empty box
      expect(result.chart).toContain('LeakyInterface')
      expect(result.chart).toContain('<<interface>>')
      // Should NOT contain any garbage content as properties
      const leakyBlock = result.chart.split('class type_LeakyInterface')[1]?.split('}')[0] || ''
      expect(leakyBlock).not.toContain('export')
      expect(leakyBlock).not.toContain('import')
      expect(leakyBlock).not.toContain('comment')
    })
  })

  describe('composition edges', () => {
    it('generates composition edges when properties reference other rendered types', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // User has address: Address and orders: Order[]
      expect(result.chart).toContain('type_User *-- type_Address')
      expect(result.chart).toContain('type_User *-- type_Order')
      // Order has items: OrderItem[] and status: Status
      expect(result.chart).toContain('type_Order *-- type_OrderItem')
      expect(result.chart).toContain('type_Order *-- type_Status')
      // OrderItem has product: Product
      expect(result.chart).toContain('type_OrderItem *-- type_Product')
    })

    it('extracts type references from generic type arguments', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // User has metadata: Map<string, Product> — should extract Product from generics
      expect(result.chart).toContain('type_User *-- type_Product')
    })

    it('deduplicates composition edges per type pair', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // Order has both items: OrderItem[] and mainItem: OrderItem
      // Should only emit one edge
      const orderItemEdges = result.chart.split('\n').filter(l => l.includes('type_Order *-- type_OrderItem'))
      expect(orderItemEdges).toHaveLength(1)
    })

    it('does not generate composition edges for built-in types', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // No edges to Map, Promise, Array, Record, etc.
      expect(result.chart).not.toContain('*-- Map')
      expect(result.chart).not.toContain('*-- Promise')
      expect(result.chart).not.toContain('*-- Array')
    })

    it('includes composition edges in totalEdges count', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // At least 5 composition edges: User->Address, User->Order, User->Product,
      // Order->OrderItem, Order->Status, OrderItem->Product
      expect(result.stats.totalEdges).toBeGreaterThanOrEqual(5)
    })

    it('does not create self-referencing composition edges', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      const selfEdges = result.chart.split('\n').filter(l => {
        const match = l.match(/(\w+) \*-- (\w+)/)
        return match && match[1] === match[2]
      })
      expect(selfEdges).toHaveLength(0)
    })

    it('preserves inheritance edges alongside composition edges', () => {
      const result = generateClassDiagram(createRealisticAnalysis())

      // Existing inheritance edges should still be present
      expect(result.chart).toContain('type_BaseClient <|-- type_ApiClient')
      expect(result.chart).toContain('type_HttpClient <|.. type_ApiClient')
    })
  })

  describe('concatenated property splitting', () => {
    it('splits concatenated properties into individual declarations', () => {
      const result = generateClassDiagram(createConcatenatedPropsAnalysis())

      // StorageValue had "state: S version: number export interface PersistOptions<S>"
      // After splitting: ["state: S", "version: number", "export interface PersistOptions<S>"]
      // "export interface..." is filtered as garbage, leaving 2 clean props
      expect(result.chart).toContain('StorageValue')
      expect(result.chart).toContain('+state : S')
      expect(result.chart).toContain('+version : number')
      // Should NOT contain the garbage fragment
      expect(result.chart).not.toContain('PersistOptions')
    })

    it('splits multiple properties jammed into one string', () => {
      const result = generateClassDiagram(createConcatenatedPropsAnalysis())

      // ExampleState had "num: number numGet: number numGetState: number"
      // After splitting: ["num: number", "numGet: number", "numGetState: number"]
      expect(result.chart).toContain('ExampleState')
      expect(result.chart).toContain('+num : number')
      expect(result.chart).toContain('+numGet : number')
      expect(result.chart).toContain('+numGetState : number')
    })

    it('preserves already-clean properties unchanged', () => {
      const result = generateClassDiagram(createConcatenatedPropsAnalysis())

      // CleanInterface already had separate property strings
      expect(result.chart).toContain('CleanInterface')
      expect(result.chart).toContain('+id : number')
      expect(result.chart).toContain('+name : string')
      expect(result.chart).toContain('+active : boolean')
    })
  })
})
