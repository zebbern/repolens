import { useState, useEffect, useRef, useMemo } from "react"
import { useTheme } from "next-themes"
import type { HighlighterGeneric, ThemedToken, BundledLanguage, BundledTheme } from "shiki"

/** Tokens for a single line — each token has text content and an optional color. */
export interface SyntaxToken {
  content: string
  color?: string
}

// ---------------------------------------------------------------------------
// Language mapping
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  mdx: "mdx",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  env: "dotenv",
}

const KNOWN_LANGUAGES = new Set(Object.values(EXTENSION_TO_LANGUAGE))

/** Resolve a filename (e.g. `page.tsx`) or extension to a Shiki language ID. */
export function getShikiLanguage(filenameOrLang: string): string {
  if (!filenameOrLang) return "text"

  // Already a known language id?
  const lower = filenameOrLang.toLowerCase()
  if (KNOWN_LANGUAGES.has(lower)) return lower

  // Extract extension
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower
  return EXTENSION_TO_LANGUAGE[ext] ?? "text"
}

// ---------------------------------------------------------------------------
// Singleton highlighter (lazy loaded)
// ---------------------------------------------------------------------------

const DARK_THEME = "github-dark" as const
const LIGHT_THEME = "github-light" as const

type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

let highlighterPromise: Promise<ShikiHighlighter> | null = null
const loadedLanguages = new Set<string>()

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [DARK_THEME, LIGHT_THEME],
        langs: [], // load languages on demand
      }),
    )
  }
  return highlighterPromise
}

async function ensureLanguageLoaded(
  hl: ShikiHighlighter,
  lang: string,
): Promise<boolean> {
  if (lang === "text" || loadedLanguages.has(lang)) return lang !== "text"
  try {
    await hl.loadLanguage(lang as BundledLanguage)
    loadedLanguages.add(lang)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Tokenize `content` using Shiki for syntax highlighting.
 *
 * Returns `lines` — an array (one per line) of `SyntaxToken[]`.
 * While the highlighter is loading, each line is a single token with no color.
 */
export function useSyntaxHighlighting(
  content: string,
  language: string | undefined,
) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const themeName = isDark ? DARK_THEME : LIGHT_THEME
  const lang = getShikiLanguage(language ?? "")

  const plainLines = useMemo<SyntaxToken[][]>(() => {
    return content.split("\n").map((line) => [{ content: line || " " }])
  }, [content])

  const [tokenizedLines, setTokenizedLines] = useState<SyntaxToken[][] | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (lang === "text") {
      setTokenizedLines(null)
      return
    }

    const requestId = ++requestIdRef.current

    ;(async () => {
      try {
        const hl = await getHighlighter()
        const loaded = await ensureLanguageLoaded(hl, lang)
        if (!loaded || requestId !== requestIdRef.current) return

        const { tokens } = hl.codeToTokens(content, {
          lang: lang as BundledLanguage,
          theme: themeName,
        })

        if (requestId !== requestIdRef.current) return

        const mapped: SyntaxToken[][] = tokens.map((lineTokens: ThemedToken[]) =>
          lineTokens.map((t) => ({ content: t.content, color: t.color })),
        )

        setTokenizedLines(mapped)
      } catch {
        // Fallback to plain text on error
        if (requestId === requestIdRef.current) {
          setTokenizedLines(null)
        }
      }
    })()
  }, [content, lang, themeName])

  return tokenizedLines ?? plainLines
}
