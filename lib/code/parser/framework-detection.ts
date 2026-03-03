// Framework detection — identifies the primary framework from file patterns and dependencies.

import type { FileAnalysis, DependencyGraph } from './types'

export function detectFramework(files: Map<string, FileAnalysis>, graph: DependencyGraph): string | null {
  const paths = new Set(files.keys())
  const externalPkgs = new Set(graph.externalDeps.keys())

  // Next.js
  if (externalPkgs.has('next') || [...paths].some(p => /app\/.*\/page\.(tsx?|jsx?)$/.test(p) || p === 'next.config.mjs' || p === 'next.config.js' || p === 'next.config.ts')) return 'Next.js'
  // Nuxt
  if (externalPkgs.has('nuxt') || [...paths].some(p => p === 'nuxt.config.ts' || p === 'nuxt.config.js')) return 'Nuxt'
  // SvelteKit
  if (externalPkgs.has('@sveltejs/kit') || [...paths].some(p => p === 'svelte.config.js')) return 'SvelteKit'
  // Vue
  if (externalPkgs.has('vue')) return 'Vue'
  // Svelte
  if (externalPkgs.has('svelte')) return 'Svelte'
  // React (generic)
  if (externalPkgs.has('react')) return 'React'
  // Express
  if (externalPkgs.has('express')) return 'Express'
  // Fastify
  if (externalPkgs.has('fastify')) return 'Fastify'
  // Django
  if ([...paths].some(p => p.endsWith('manage.py') || p.endsWith('settings.py') || p.includes('django'))) return 'Django'
  // Flask
  if (externalPkgs.has('flask') || [...paths].some(p => p.endsWith('app.py') && files.get(p)?.imports.some(i => i.source === 'flask'))) return 'Flask'
  // FastAPI
  if (externalPkgs.has('fastapi')) return 'FastAPI'
  // Go (check for main.go)
  if ([...paths].some(p => p.endsWith('main.go'))) return 'Go'
  // Rust (Cargo)
  if ([...paths].some(p => p === 'Cargo.toml')) return 'Rust/Cargo'
  // Laravel
  if ([...paths].some(p => p === 'artisan' || p.includes('laravel'))) return 'Laravel'

  return null
}
