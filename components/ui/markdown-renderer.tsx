"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useTheme } from "next-themes"
import { useState, useEffect, useRef, useCallback, memo } from "react"
import { cn } from "@/lib/utils"
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki"
import mermaid from "mermaid"
import { MermaidDiagram, type MermaidDiagramHandle } from "@/components/features/diagrams/mermaid-diagram"
import { Download } from "lucide-react"

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
// Copy button for code blocks
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
      className="absolute top-1.5 right-8 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary bg-foreground/5 hover:bg-foreground/10 rounded font-mono"
      aria-label="Copy code"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
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
  const isDark = resolvedTheme === "dark"
  const lang = language || "text"
  const theme = isDark ? DARK_THEME : LIGHT_THEME

  useEffect(() => {
    let cancelled = false

    getHighlighter().then(async (hl) => {
      if (cancelled) return

      const loaded = await ensureLanguageLoaded(hl, lang)
      if (cancelled) return

      const effectiveLang = loaded ? lang : "text"
      try {
        const result = hl.codeToHtml(children.trim(), {
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
  }, [children, lang, theme])

  if (!html) {
    return (
      <pre className="rounded-lg bg-surface-elevated p-4 overflow-x-auto text-sm font-mono border border-foreground/[0.06]">
        <code>{children}</code>
      </pre>
    )
  }

  return (
    <div className="relative group rounded-lg overflow-hidden my-3 border border-foreground/[0.06]">
      {language && (
        <div className="absolute top-0 right-0 px-2 py-1 text-[10px] text-text-muted bg-foreground/5 rounded-bl font-mono">
          {language}
        </div>
      )}
      <CopyButton text={children.trim()} />
      <div
        className="[&>pre]:!rounded-lg [&>pre]:!p-4 [&>pre]:!m-0 [&>pre]:overflow-x-auto [&>pre]:text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
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

  // Re-initialize mermaid with correct theme variables when theme changes
  useEffect(() => {
    const isDark = resolvedTheme === "dark"
    mermaid.initialize({
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
  }, [resolvedTheme])

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

  return (
    <div className="relative group my-3 rounded-lg border border-foreground/[0.06] overflow-hidden">
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
        <MermaidDiagram ref={mermaidRef} chart={children} />
      </div>
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

    const isBlock = Boolean(match || codeClassName)

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
        "[&_a]:text-status-info [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-status-info/80",
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
