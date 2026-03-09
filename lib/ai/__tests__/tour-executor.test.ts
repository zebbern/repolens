import { describe, it, expect } from 'vitest'
import { createEmptyIndex, indexFile } from '@/lib/code/code-index'
import { executeToolLocally } from '../client-tool-executor'
import type { CodeIndex } from '@/lib/code/code-index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockIndex(): CodeIndex {
  let index = createEmptyIndex()

  index = indexFile(
    index,
    'src/index.ts',
    [
      "import { App } from './app'",
      "import { config } from './config'",
      '',
      'export function main() {',
      '  const app = new App(config)',
      '  app.start()',
      '}',
      '',
      'main()',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'src/app.ts',
    [
      "import { Router } from './router'",
      "import { Database } from './db'",
      '',
      'export class App {',
      '  private router: Router',
      '  private db: Database',
      '',
      '  constructor(config: any) {',
      '    this.router = new Router()',
      '    this.db = new Database(config.dbUrl)',
      '  }',
      '',
      '  start() {',
      '    this.router.listen(3000)',
      '  }',
      '}',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'src/router.ts',
    [
      "import { handleAuth } from './auth'",
      '',
      'export class Router {',
      '  private routes = new Map<string, Function>()',
      '',
      '  addRoute(path: string, handler: Function) {',
      '    this.routes.set(path, handler)',
      '  }',
      '',
      '  listen(port: number) {',
      '    console.log(`Listening on ${port}`)',
      '  }',
      '}',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'src/auth.ts',
    [
      'export function handleAuth(req: any, res: any) {',
      "  const token = req.headers['authorization']",
      '  if (!token) {',
      '    res.status(401).json({ error: "Unauthorized" })',
      '    return',
      '  }',
      '  // Verify token',
      '  return { userId: "user-1" }',
      '}',
      '',
      'export function createToken(userId: string): string {',
      '  return `token-${userId}`',
      '}',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'src/config.ts',
    [
      'export const config = {',
      '  dbUrl: "postgres://localhost:5432/app",',
      '  port: 3000,',
      '  secret: "dev-secret",',
      '}',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'src/db.ts',
    [
      'export class Database {',
      '  private url: string',
      '',
      '  constructor(url: string) {',
      '    this.url = url',
      '  }',
      '',
      '  async query(sql: string): Promise<any[]> {',
      '    return []',
      '  }',
      '}',
    ].join('\n'),
    'typescript',
  )

  index = indexFile(
    index,
    'README.md',
    [
      '# My App',
      '',
      'A sample application for tour testing.',
    ].join('\n'),
    'markdown',
  )

  return index
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeToolLocally — generateTour', () => {
  it('returns error JSON for null codeIndex', async () => {
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, null)
    const result = JSON.parse(raw)
    expect(result).toHaveProperty('error')
  })

  it('returns error JSON for codeIndex with 0 files', async () => {
    const empty = createEmptyIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, empty)
    const result = JSON.parse(raw)
    expect(result).toHaveProperty('error')
  })

  it('returns error JSON for invalid input (missing repoKey)', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', {}, index)
    const result = JSON.parse(raw)
    expect(result).toHaveProperty('error')
  })

  it('returns a valid Tour-shaped object with all required fields', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const result = JSON.parse(raw)

    expect(result).toHaveProperty('tour')
    const tour = result.tour

    expect(tour).toHaveProperty('id')
    expect(tour).toHaveProperty('name')
    expect(tour).toHaveProperty('description')
    expect(tour).toHaveProperty('repoKey', 'owner/repo')
    expect(tour).toHaveProperty('stops')
    expect(tour).toHaveProperty('createdAt')
    expect(tour).toHaveProperty('updatedAt')
    expect(Array.isArray(tour.stops)).toBe(true)
    expect(tour.stops.length).toBeGreaterThan(0)
  })

  it('returned tour has stops that reference real files from the mock codeIndex', async () => {
    const index = buildMockIndex()
    const knownPaths = Array.from(index.files.keys())
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    for (const stop of tour.stops) {
      expect(knownPaths).toContain(stop.filePath)
    }
  })

  it('respects maxStops limit', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally(
      'generateTour',
      { repoKey: 'owner/repo', maxStops: 3 },
      index,
    )
    const { tour } = JSON.parse(raw)

    expect(tour.stops.length).toBeLessThanOrEqual(3)
  })

  it('each stop has valid startLine and endLine (positive integers, startLine <= endLine)', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    for (const stop of tour.stops) {
      expect(stop.startLine).toBeGreaterThan(0)
      expect(stop.endLine).toBeGreaterThan(0)
      expect(Number.isInteger(stop.startLine)).toBe(true)
      expect(Number.isInteger(stop.endLine)).toBe(true)
      expect(stop.startLine).toBeLessThanOrEqual(stop.endLine)
    }
  })

  it('each stop has a non-empty annotation string', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    for (const stop of tour.stops) {
      expect(typeof stop.annotation).toBe('string')
      expect(stop.annotation.length).toBeGreaterThan(0)
    }
  })

  it('each stop has a non-empty id', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    for (const stop of tour.stops) {
      expect(typeof stop.id).toBe('string')
      expect(stop.id.length).toBeGreaterThan(0)
    }
  })

  it('returned tour id is a valid UUID string', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    // UUID v4 regex
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(tour.id).toMatch(uuidRegex)
  })

  it('general tour (no theme) has name "Architecture Tour"', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    expect(tour.name).toBe('Architecture Tour')
  })

  it('themed tour includes the theme in the tour name', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally(
      'generateTour',
      { repoKey: 'owner/repo', theme: 'authentication' },
      index,
    )
    const { tour } = JSON.parse(raw)

    expect(tour.name.toLowerCase()).toContain('authentication')
  })

  it('also returns stopCount alongside tour', async () => {
    const index = buildMockIndex()
    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const result = JSON.parse(raw)

    expect(result).toHaveProperty('stopCount')
    expect(result.stopCount).toBe(result.tour.stops.length)
  })

  it('excludes test files from generated tour stops', async () => {
    let index = buildMockIndex()
    // Add a test file
    index = indexFile(
      index,
      'src/__tests__/app.test.ts',
      [
        'import { App } from "../app"',
        'describe("App", () => {',
        '  it("starts", () => {})',
        '})',
      ].join('\n'),
      'typescript',
    )

    const raw = await executeToolLocally('generateTour', { repoKey: 'owner/repo' }, index)
    const { tour } = JSON.parse(raw)

    for (const stop of tour.stops) {
      expect(stop.filePath).not.toContain('__tests__')
      expect(stop.filePath).not.toContain('.test.')
    }
  })
})
