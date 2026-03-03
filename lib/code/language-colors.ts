/** Maps file extensions to their conventional language colors. */
export const LANGUAGE_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  mjs: '#f7df1e',
  cjs: '#f7df1e',
  py: '#3776ab',
  css: '#264de4',
  scss: '#cc6699',
  sass: '#cc6699',
  less: '#1d365d',
  html: '#e34c26',
  json: '#5B5B5B',
  md: '#083fa1',
  mdx: '#083fa1',
  yaml: '#cb171e',
  yml: '#cb171e',
  go: '#00add8',
  rs: '#dea584',
  java: '#b07219',
  kt: '#A97BFF',
  swift: '#F05138',
  rb: '#cc342d',
  sh: '#89e051',
  bash: '#89e051',
  zsh: '#89e051',
  php: '#4F5D95',
  cs: '#178600',
  cpp: '#f34b7d',
  c: '#555555',
  h: '#555555',
  hpp: '#f34b7d',
  vue: '#41b883',
  svelte: '#ff3e00',
  astro: '#ff5a03',
  sql: '#e38c00',
  graphql: '#e10098',
  dockerfile: '#384d54',
}

/** Returns the language color for a filename, or undefined if unrecognized. */
export function getLanguageColor(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext ? LANGUAGE_COLORS[ext] : undefined
}
