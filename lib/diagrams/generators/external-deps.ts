// Generator — External Dependencies (language-aware)

import type { FullAnalysis } from '@/lib/code/import-parser'
import type { MermaidDiagramResult } from '../types'
import { sanitizeId } from '../helpers'

const JS_CATEGORIES: Record<string, string[]> = {
  'UI Framework': ['react', 'react-dom', 'next', 'vue', 'svelte', 'angular', 'solid-js', 'preact', 'nuxt'],
  'Styling': ['tailwindcss', 'styled-components', '@emotion', 'sass', 'postcss', 'clsx', 'class-variance-authority', 'tailwind-merge'],
  'UI Components': ['@radix-ui', '@headlessui', '@shadcn', 'lucide-react', '@heroicons', 'framer-motion', 'recharts', 'mermaid'],
  'State & Data': ['zustand', 'redux', '@tanstack', 'swr', 'axios', 'graphql', '@apollo', 'immer', 'jotai'],
  'Auth & Backend': ['@supabase', '@prisma', 'drizzle-orm', '@auth', 'next-auth', 'firebase', 'mongoose', 'pg', 'bcrypt', 'jsonwebtoken'],
  'AI & ML': ['ai', '@ai-sdk', 'openai', '@anthropic-ai', 'langchain'],
  'Validation': ['zod', 'yup', 'joi', 'ajv', 'valibot'],
  'Tooling': ['typescript', 'eslint', 'prettier', 'vitest', 'jest', '@testing-library', 'vite', 'esbuild'],
}

const PYTHON_CATEGORIES: Record<string, string[]> = {
  'Web Framework': ['flask', 'django', 'fastapi', 'starlette', 'tornado', 'aiohttp'],
  'Data Science': ['numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'plotly'],
  'AI & ML': ['torch', 'tensorflow', 'transformers', 'sklearn', 'openai', 'langchain'],
  'Database': ['sqlalchemy', 'psycopg2', 'pymongo', 'redis', 'alembic'],
  'HTTP & API': ['requests', 'httpx', 'pydantic', 'marshmallow'],
  'Testing': ['pytest', 'unittest', 'mock', 'coverage'],
  'Utilities': ['click', 'typer', 'rich', 'tqdm', 'python-dotenv'],
}

const GO_CATEGORIES: Record<string, string[]> = {
  'Web': ['net/http', 'github.com/gin-gonic', 'github.com/gorilla', 'github.com/labstack/echo', 'github.com/gofiber'],
  'Database': ['database/sql', 'github.com/lib/pq', 'gorm.io', 'go.mongodb.org'],
  'Std Library': ['fmt', 'os', 'io', 'strings', 'strconv', 'encoding', 'context', 'sync', 'time', 'log', 'errors', 'path'],
  'Testing': ['testing', 'github.com/stretchr/testify'],
}

function getCategoryMap(primaryLang: string): Record<string, string[]> {
  switch (primaryLang) {
    case 'python': return PYTHON_CATEGORIES
    case 'go': return GO_CATEGORIES
    default: return JS_CATEGORIES
  }
}

export function generateExternalDeps(analysis: FullAnalysis): MermaidDiagramResult {
  const { graph } = analysis
  const nodePathMap = new Map<string, string>()
  const categoryMap = getCategoryMap(analysis.primaryLanguage)

  const pkgToCategory = new Map<string, string>()
  for (const [cat, pkgs] of Object.entries(categoryMap)) {
    for (const pkg of pkgs) pkgToCategory.set(pkg, cat)
  }
  function getCategory(pkg: string): string {
    if (pkgToCategory.has(pkg)) return pkgToCategory.get(pkg)!
    for (const [prefix, cat] of pkgToCategory) {
      if (pkg.startsWith(prefix)) return cat
    }
    return 'Other'
  }

  let chart = 'flowchart LR\n'
  let nodeCount = 0
  const byCat = new Map<string, { pkg: string; importers: number }[]>()
  for (const [pkg, importers] of graph.externalDeps) {
    const cat = getCategory(pkg)
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push({ pkg, importers: importers.size })
  }

  if (byCat.size === 0) {
    chart += '  empty["No external dependencies detected"]\n'
    return { type: 'externals', title: 'External Dependencies', chart, stats: { totalNodes: 0, totalEdges: 0 }, nodePathMap }
  }

  chart += `  project["Project (${analysis.files.size} files)"]\n`
  const sortedCats = Array.from(byCat.entries()).sort((a, b) => b[1].reduce((s, p) => s + p.importers, 0) - a[1].reduce((s, p) => s + p.importers, 0))

  for (const [cat, pkgs] of sortedCats) {
    const catId = sanitizeId(cat)
    chart += `  subgraph ${catId}["${cat}"]\n`
    pkgs.sort((a, b) => b.importers - a.importers)
    for (const { pkg, importers } of pkgs.slice(0, 15)) {
      const pkgId = sanitizeId(pkg)
      chart += `    ${pkgId}["${pkg} (${importers})"]\n`
      nodePathMap.set(pkgId, pkg)
      nodeCount++
    }
    if (pkgs.length > 15) chart += `    ${sanitizeId(`${cat}_more`)}["... +${pkgs.length - 15} more"]\n`
    chart += '  end\n'
    const totalImports = pkgs.reduce((s, p) => s + p.importers, 0)
    chart += `  project -->|"${totalImports} imports"| ${catId}\n`
  }

  return {
    type: 'externals',
    title: `External Dependencies (${graph.externalDeps.size} packages)`,
    chart,
    stats: { totalNodes: nodeCount, totalEdges: graph.externalDeps.size },
    nodePathMap,
  }
}
