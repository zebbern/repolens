import { generateClassDiagram } from '@/lib/diagrams/generators/class-diagram'
import { createRealisticAnalysis, createMinimalAnalysis, createEmptyAnalysis, createComplexTypesAnalysis, createConcatenatedPropsAnalysis, createCompositionAnalysis } from '@/lib/diagrams/__fixtures__/mock-analysis'

describe('generateClassDiagram', () => {
  it('produces a classDiagram with types for realistic analysis', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    expect(result.type).toBe('classes')
    expect(result.chart).toContain('classDiagram')
    // Should include the interface and class from mock data
    expect(result.chart).toContain('ButtonProps')
    expect(result.chart).toContain('<<interface>>')
    expect(result.chart).toContain('ApiClient')
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(3)
  })

  it('renders enum types with <<enumeration>> stereotype', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    expect(result.chart).toContain('Theme')
    expect(result.chart).toContain('<<enumeration>>')
  })

  it('renders extends/implements relationships', () => {
    const result = generateClassDiagram(createRealisticAnalysis())

    // ApiClient extends BaseClient
    expect(result.chart).toContain('BaseClient <|-- ApiClient')
    // ApiClient implements HttpClient
    expect(result.chart).toContain('HttpClient <|.. ApiClient')
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
    // All type names should map to their source file paths
    expect(result.nodePathMap.get('ButtonProps')).toBe('src/types.ts')
    expect(result.nodePathMap.get('ApiClient')).toBe('src/services/api.ts')
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
      const nullableBlock = result.chart.split('Nullable')[1]?.split('}')[0] || ''
      // The block should have <<type>> and some simplified text, not multiple property lines
      expect(nullableBlock).toContain('<<type>>')
    })

    it('filters garbage properties from types with leaked file context', () => {
      const result = generateClassDiagram(createComplexTypesAnalysis())

      // Config has 2/6 clean properties (<50%) — should render empty class box
      expect(result.chart).toContain('Config')
      const configBlock = result.chart.split('Config')[1]?.split('}')[0] || ''
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
      const leakyBlock = result.chart.split('LeakyInterface')[1]?.split('}')[0] || ''
      expect(leakyBlock).not.toContain('export')
      expect(leakyBlock).not.toContain('import')
      expect(leakyBlock).not.toContain('comment')
    })
  })

  describe('composition edges', () => {
    it('generates composition edges when properties reference other rendered types', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // User has address: Address and orders: Order[]
      expect(result.chart).toContain('User *-- Address')
      expect(result.chart).toContain('User *-- Order')
      // Order has items: OrderItem[] and status: Status
      expect(result.chart).toContain('Order *-- OrderItem')
      expect(result.chart).toContain('Order *-- Status')
      // OrderItem has product: Product
      expect(result.chart).toContain('OrderItem *-- Product')
    })

    it('extracts type references from generic type arguments', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // User has metadata: Map<string, Product> — should extract Product from generics
      expect(result.chart).toContain('User *-- Product')
    })

    it('deduplicates composition edges per type pair', () => {
      const result = generateClassDiagram(createCompositionAnalysis())

      // Order has both items: OrderItem[] and mainItem: OrderItem
      // Should only emit one edge
      const orderItemEdges = result.chart.split('\n').filter(l => l.includes('Order *-- OrderItem'))
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
      expect(result.chart).toContain('BaseClient <|-- ApiClient')
      expect(result.chart).toContain('HttpClient <|.. ApiClient')
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
