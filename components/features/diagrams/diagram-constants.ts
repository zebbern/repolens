import {
  Network, GitBranch, Boxes, Route, Component, SquareStack, Package, Layers,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Language colors for treemap
// ---------------------------------------------------------------------------

export const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6', tsx: '#3178c6',
  javascript: '#f7df1e', jsx: '#f7df1e',
  css: '#264de4', scss: '#cf649a', html: '#e34c26',
  json: '#292929', markdown: '#083fa1',
  python: '#3776ab', rust: '#dea584', go: '#00add8',
  yaml: '#cb171e', toml: '#9c4121', sql: '#e38c00',
  graphql: '#e535ab', prisma: '#2d3748',
  csharp: '#68217a', java: '#b07219', kotlin: '#A97BFF',
  ruby: '#CC342D', php: '#4F5D95', swift: '#FA7343', dart: '#00B4AB',
}

export const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript',
  python: 'Python', go: 'Go', rust: 'Rust', php: 'PHP',
  ruby: 'Ruby', java: 'Java', kotlin: 'Kotlin',
  csharp: 'C#', swift: 'Swift', dart: 'Dart',
  css: 'CSS', html: 'HTML', json: 'JSON', yaml: 'YAML',
  unknown: 'Other',
}

export function getLangColor(lang?: string): string {
  if (!lang) return '#475569'
  return LANGUAGE_COLORS[lang.toLowerCase()] || '#475569'
}

// ---------------------------------------------------------------------------
// Icon map for diagram types
// ---------------------------------------------------------------------------

export const ICON_MAP: Record<string, typeof Network> = {
  topology: Boxes,
  imports: GitBranch,
  classes: SquareStack,
  entrypoints: Route,
  modules: Component,
  treemap: Layers,
  externals: Package,
}
