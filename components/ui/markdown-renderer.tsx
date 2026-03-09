"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useTheme } from "next-themes"
import { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from "react"
import { cn } from "@/lib/utils"
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki"
import type { MermaidDiagramHandle } from "@/components/features/diagrams/mermaid-diagram"
import { Download, WrapText, Copy, Check, EyeOff } from "lucide-react"

const LazyMermaidDiagram = lazy(() =>
  import("@/components/features/diagrams/mermaid-diagram").then(m => ({ default: m.MermaidDiagram }))
)

// ---------------------------------------------------------------------------
// Singleton Mermaid loader (deferred to reduce initial bundle by ~2.8 MB)
// ---------------------------------------------------------------------------

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      m.default.initialize({ startOnLoad: false, theme: 'default' })
      return m.default
    })
  }
  return mermaidPromise
}

// ---------------------------------------------------------------------------
// Singleton Shiki highlighter (mirrors pattern in use-syntax-highlighting.ts)
// ---------------------------------------------------------------------------

type ShikiHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const DARK_THEME = "github-dark" satisfies BundledTheme
const LIGHT_THEME = "github-light" satisfies BundledTheme

let highlighterPromise: Promise<ShikiHighlighter> | null = null
const loadedLanguages = new Set<string>()

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [DARK_THEME, LIGHT_THEME],
        langs: [], // load on demand
      }),
    )
  }
  return highlighterPromise
}

async function ensureLanguageLoaded(
  hl: ShikiHighlighter,
  lang: string,
): Promise<boolean> {
  if (lang === "text" || loadedLanguages.has(lang)) return true
  try {
    await hl.loadLanguage(lang as BundledLanguage)
    loadedLanguages.add(lang)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Header bar action button for code blocks
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
          .catch(() => {
            console.warn('Failed to copy to clipboard')
          })
      }}
      className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-foreground/10 rounded transition-colors font-mono"
      aria-label="Copy code"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Code block header bar
// ---------------------------------------------------------------------------

function CodeBlockHeader({
  language,
  text,
  wordWrap,
  onToggleWordWrap,
}: {
  language?: string
  text: string
  wordWrap: boolean
  onToggleWordWrap: () => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-foreground/8 border-b border-foreground/6 rounded-t-lg">
      <span className="text-xs font-mono text-text-muted select-none">
        {language || "text"}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleWordWrap}
          className={cn(
            "flex items-center px-1.5 py-1 rounded transition-colors",
            wordWrap
              ? "text-text-primary bg-foreground/10"
              : "text-text-muted hover:text-text-primary hover:bg-foreground/10",
          )}
          aria-label="Toggle word wrap"
          aria-pressed={wordWrap}
        >
          <WrapText className="h-3 w-3" />
        </button>
        <CopyButton text={text} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line numbers gutter (only rendered for blocks with ≥5 lines)
// ---------------------------------------------------------------------------

function LineNumbers({ count }: { count: number }) {
  return (
    <div
      className="select-none text-right pr-3 border-r border-foreground/6 text-text-muted text-xs font-mono leading-[1.7142857] pt-4 pb-4 pl-3 shrink-0"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Code block with Shiki highlighting
// ---------------------------------------------------------------------------

function CodeBlock({
  language,
  children,
}: {
  language?: string
  children: string
}) {
  const { resolvedTheme } = useTheme()
  const [html, setHtml] = useState<string>("")
  const [wordWrap, setWordWrap] = useState(false)
  const isDark = resolvedTheme === "dark"
  const lang = language || "text"
  const theme = isDark ? DARK_THEME : LIGHT_THEME

  const trimmedCode = children.trim()
  const lineCount = trimmedCode.split("\n").length
  const showLineNumbers = lineCount >= 5

  useEffect(() => {
    let cancelled = false

    getHighlighter().then(async (hl) => {
      if (cancelled) return

      const loaded = await ensureLanguageLoaded(hl, lang)
      if (cancelled) return

      const effectiveLang = loaded ? lang : "text"
      try {
        const result = hl.codeToHtml(trimmedCode, {
          lang: effectiveLang as BundledLanguage,
          theme,
        })
        if (!cancelled) setHtml(result)
      } catch {
        // Final fallback — render as plain text HTML
        if (!cancelled) setHtml("")
      }
    })

    return () => {
      cancelled = true
    }
  }, [trimmedCode, lang, theme])

  const wrapClasses = wordWrap
    ? "[&_pre]:whitespace-pre-wrap [&_pre]:wrap-break-word"
    : "[&_pre]:overflow-x-auto [&_pre]:whitespace-pre"

  // Fallback: Shiki hasn't loaded yet
  if (!html) {
    return (
      <div className="rounded-lg overflow-hidden my-3 border border-foreground/6 shadow-xs">
        <CodeBlockHeader
          language={language}
          text={trimmedCode}
          wordWrap={wordWrap}
          onToggleWordWrap={() => setWordWrap((w) => !w)}
        />
        <div className="flex">
          {showLineNumbers && <LineNumbers count={lineCount} />}
          <pre
            className={cn(
              "flex-1 p-4 text-sm font-mono bg-surface-elevated min-w-0",
              wordWrap ? "whitespace-pre-wrap wrap-break-word" : "overflow-x-auto whitespace-pre",
            )}
          >
            <code>{trimmedCode}</code>
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg overflow-hidden my-3 border border-foreground/6 shadow-xs">
      <CodeBlockHeader
        language={language}
        text={trimmedCode}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
      />
      <div className="flex">
        {showLineNumbers && <LineNumbers count={lineCount} />}
        <div
          className={cn(
            "flex-1 min-w-0",
            "[&>pre]:rounded-none! [&>pre]:p-4! [&>pre]:m-0! [&>pre]:text-sm",
            wrapClasses,
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline code
// ---------------------------------------------------------------------------

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/10 px-1.5 py-0.5 text-[0.875em] font-mono text-text-accent">
      {children}
    </code>
  )
}

// ---------------------------------------------------------------------------
// Mermaid diagram block — theme-aware wrapper for MermaidDiagram
// ---------------------------------------------------------------------------

function MermaidDiagramBlock({ children }: { children: string }) {
  const { resolvedTheme } = useTheme()
  const mermaidRef = useRef<MermaidDiagramHandle>(null)
  const [showRawCode, setShowRawCode] = useState(false)

  // Re-initialize mermaid with correct theme variables when theme changes
  useEffect(() => {
    const isDark = resolvedTheme === "dark"
    let cancelled = false

    getMermaid().then((m) => {
      if (cancelled) return
      m.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
        themeVariables: isDark
          ? {
              primaryColor: "#3b82f6",
              primaryTextColor: "#f8fafc",
              primaryBorderColor: "#60a5fa",
              lineColor: "#64748b",
              secondaryColor: "#1e293b",
              tertiaryColor: "#0f172a",
              background: "#0a0a0a",
              mainBkg: "#1e293b",
              nodeBorder: "#475569",
              clusterBkg: "#1e293b",
              titleColor: "#f8fafc",
              edgeLabelBackground: "#1e293b",
            }
          : {
              primaryColor: "#3b82f6",
              primaryTextColor: "#1e293b",
              primaryBorderColor: "#3b82f6",
              lineColor: "#94a3b8",
              secondaryColor: "#f1f5f9",
              tertiaryColor: "#e2e8f0",
              background: "#ffffff",
              mainBkg: "#f1f5f9",
              nodeBorder: "#94a3b8",
              clusterBkg: "#f8fafc",
              titleColor: "#1e293b",
              edgeLabelBackground: "#f8fafc",
            },
        flowchart: {
          htmlLabels: true,
          curve: "basis",
        },
      })
    })

    return () => { cancelled = true }
  }, [resolvedTheme])

  // Reset raw code panel when chart content changes
  useEffect(() => { setShowRawCode(false) }, [children])

  const handleDownloadSvg = useCallback(() => {
    const svgEl = mermaidRef.current?.getSvgElement()
    if (!svgEl) return
    const blob = new Blob(
      [new XMLSerializer().serializeToString(svgEl)],
      { type: "image/svg+xml" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "mermaid-diagram.svg"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const handleToggleRawCode = useCallback(() => {
    setShowRawCode((prev) => !prev)
  }, [])

  return (
    <div className="relative group my-3 rounded-lg border border-foreground/6 shadow-xs overflow-hidden">
      <div className="absolute top-0 right-0 flex items-center gap-1 z-10">
        <button
          onClick={handleDownloadSvg}
          className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-1 text-text-muted hover:text-text-primary bg-foreground/5 hover:bg-foreground/10"
          aria-label="Download SVG"
        >
          <Download className="h-3 w-3" />
        </button>
        <div className="px-2 py-1 text-[10px] text-text-muted bg-foreground/5 rounded-bl font-mono">
          mermaid
        </div>
      </div>
      <div className="p-4">
        <Suspense fallback={<div className="animate-pulse h-48 bg-muted rounded" />}>
          <LazyMermaidDiagram
            ref={mermaidRef}
            chart={children}
            onShowRawCode={handleToggleRawCode}
          />
        </Suspense>
      </div>
      {showRawCode && (
        <div className="border-t border-foreground/6">
          <div className="flex items-center justify-between px-3 py-1.5 bg-foreground/4">
            <span className="text-xs text-text-muted font-mono">Raw mermaid source</span>
            <button
              onClick={handleToggleRawCode}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-foreground/10 rounded transition-colors"
              aria-label="Hide raw code"
            >
              <EyeOff className="h-3 w-3" />
              <span>Hide</span>
            </button>
          </div>
          <CodeBlock language="mermaid">{children}</CodeBlock>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stable props for ReactMarkdown — defined at module level to prevent
// cascading re-renders during streaming when these objects are re-created.
// ---------------------------------------------------------------------------

const REMARK_PLUGINS = [remarkGfm]

const MARKDOWN_COMPONENTS: Components = {
  code({ className: codeClassName, children }) {
    const match = /language-(\w+)/.exec(codeClassName || "")

    if (match?.[1] === "mermaid") {
      return (
        <MermaidDiagramBlock>
          {String(children).replace(/\n$/, "")}
        </MermaidDiagramBlock>
      )
    }

    const isBlock = Boolean(match || codeClassName || String(children).includes('\n'))

    if (isBlock) {
      return (
        <CodeBlock language={match?.[1]}>
          {String(children).replace(/\n$/, "")}
        </CodeBlock>
      )
    }

    return <InlineCode>{children}</InlineCode>
  },
  pre({ children }) {
    // react-markdown wraps code blocks in <pre>. CodeBlock handles its own <pre>.
    return <>{children}</>
  },
}

// ---------------------------------------------------------------------------
// MarkdownRenderer — shared by Chat and Docs
// ---------------------------------------------------------------------------

interface MarkdownRendererProps {
  /** Raw markdown content to render */
  content: string
  /** Additional CSS classes */
  className?: string
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        // Manual styling (no @tailwindcss/typography needed)
        "max-w-none text-text-primary",
        // Strip default margins from first/last children
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Headings
        "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-text-primary",
        "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-text-primary",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-text-primary",
        "[&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-text-primary",
        // Paragraphs
        "[&_p]:text-sm [&_p]:leading-relaxed [&_p]:my-1.5",
        // Lists
        "[&_ul]:text-sm [&_ul]:my-1.5 [&_ul]:pl-5 [&_ul]:list-disc",
        "[&_ol]:text-sm [&_ol]:my-1.5 [&_ol]:pl-5 [&_ol]:list-decimal",
        "[&_li]:my-0.5 [&_li]:leading-relaxed",
        // Tables
        "[&_table]:text-sm [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:border-b [&_th]:border-foreground/10 [&_th]:text-text-secondary",
        "[&_td]:px-3 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-foreground/5",
        // Blockquotes
        "[&_blockquote]:border-l-2 [&_blockquote]:border-text-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-text-secondary [&_blockquote]:my-2",
        // Links
        "[&_a]:text-status-info [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-status-info/80",
        // Horizontal rules
        "[&_hr]:border-foreground/10 [&_hr]:my-3",
        // Strong & emphasis
        "[&_strong]:font-semibold [&_em]:italic",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
