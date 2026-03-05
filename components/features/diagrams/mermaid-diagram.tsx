"use client"

import { useEffect, useRef, useState, useCallback, useImperativeHandle, type Ref } from 'react'
import mermaid from 'mermaid'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AlertTriangle, Code } from 'lucide-react'
import { MermaidToolbar } from './mermaid-toolbar'
import { MermaidFullscreenDialog } from './mermaid-fullscreen-dialog'

// ---------------------------------------------------------------------------
// Theme configurations
// ---------------------------------------------------------------------------

const DARK_THEME_CONFIG = {
  startOnLoad: false,
  theme: 'dark' as const,
  securityLevel: 'strict' as const,
  logLevel: 5 as const,
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#60a5fa',
    lineColor: '#64748b',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0f172a',
    background: '#0a0a0a',
    mainBkg: '#1e293b',
    nodeBorder: '#475569',
    clusterBkg: '#1e293b',
    titleColor: '#f8fafc',
    edgeLabelBackground: '#1e293b',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis' as const,
  },
}

const LIGHT_THEME_CONFIG = {
  startOnLoad: false,
  theme: 'default' as const,
  securityLevel: 'strict' as const,
  logLevel: 5 as const,
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryTextColor: '#1e293b',
    primaryBorderColor: '#2563eb',
    lineColor: '#94a3b8',
    secondaryColor: '#e2e8f0',
    tertiaryColor: '#f1f5f9',
    background: '#ffffff',
    mainBkg: '#f8fafc',
    nodeBorder: '#cbd5e1',
    clusterBkg: '#f1f5f9',
    titleColor: '#1e293b',
    edgeLabelBackground: '#f8fafc',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis' as const,
  },
}

// Initialize mermaid with dark theme
mermaid.initialize(DARK_THEME_CONFIG)

/** Lock to prevent concurrent theme-switches from corrupting global mermaid state. */
let themeRenderLock = false

// ---------------------------------------------------------------------------
// Error parsing utility — extracts structured info from mermaid error strings
// ---------------------------------------------------------------------------

export interface MermaidErrorDetail {
  /** Human-readable summary */
  message: string
  /** Line number where the error occurred, if available */
  line?: number
  /** Character/column position, if available */
  character?: number
  /** The raw error string before parsing */
  raw: string
}

/** Parse a mermaid error message into structured detail. */
export function parseMermaidError(error: string): MermaidErrorDetail {
  const detail: MermaidErrorDetail = { message: error, raw: error }

  // Mermaid often includes "Parse error on line N" or "Error: ... at line N"
  const lineMatch = /(?:line\s+|line:?\s*)(\d+)/i.exec(error)
  if (lineMatch) {
    detail.line = parseInt(lineMatch[1], 10)
  }

  // Check for character/column info: "character N" or "col N" or "column N"
  const charMatch = /(?:character|col(?:umn)?)\s*:?\s*(\d+)/i.exec(error)
  if (charMatch) {
    detail.character = parseInt(charMatch[1], 10)
  }

  // Clean up the message: strip redundant "Error:" prefix, trim whitespace
  let cleaned = error
    .replace(/^Error:\s*/i, '')
    .replace(/\n+/g, ' ')
    .trim()

  // Truncate overly long messages
  if (cleaned.length > 200) {
    cleaned = cleaned.slice(0, 197) + '...'
  }

  detail.message = cleaned
  return detail
}

export interface MermaidDiagramHandle {
  /** Returns the raw SVG element for export, or null if not rendered. */
  getSvgElement: () => SVGSVGElement | null
}

interface MermaidDiagramProps {
  chart: string
  className?: string
  /** Called when a user clicks a node. Receives the node's element id. */
  onNodeClick?: (nodeId: string) => void
  /** Called when the user wants to view the raw mermaid source in an error state. */
  onShowRawCode?: () => void
}

/**
 * Sanitize LLM-generated Mermaid syntax to fix common parsing issues.
 * Applied automatically before any render attempt.
 */
export function sanitizeMermaidSource(source: string): string {
  let s = source.trim()

  // 1. Strip markdown fencing
  s = s.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')

  // 2. Normalize line endings & replace tabs with spaces
  s = s.replace(/\r\n/g, '\n').replace(/\t/g, '  ')

  // 3. Replace smart quotes and em-dashes with ASCII equivalents
  s = s.replace(/[\u2018\u2019]/g, "'")   // smart single quotes
  s = s.replace(/[\u201C\u201D]/g, '"')   // smart double quotes
  s = s.replace(/[\u2013\u2014]/g, '-')   // en-dash, em-dash

  // 4. Replace <br> tags with Mermaid line breaks
  s = s.replace(/<br\s*\/?>/gi, '<br/>')

  // 5. Strip other HTML tags (but preserve <br/>)
  s = s.replace(/<(?!\/?br\s*\/?>)[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, '')
  s = s.replace(/<\/(?!br)[a-z][a-z0-9]*>/gi, '')

  // 6. Fix broken arrow syntax
  s = s.replace(/- ->/g, '-->')
  s = s.replace(/<- -/g, '<--')

  // 7. Remove orphan arrows (line ending with arrow and no target)
  s = s.replace(/-->\s*$/gm, '')
  s = s.replace(/<--\s*$/gm, '')

  // 8. Collapse 3+ consecutive blank lines to 2
  s = s.replace(/\n{3,}/g, '\n\n')

  // 9. Quote labels containing special characters
  // Match node definitions: ID[label] — only quote if label has problematic chars
  s = s.replace(
    /(\b\w+)\[([^\]"]+)\]/g,
    (match, id, label) => {
      if (/[<>(){}|;&#\/]/.test(label)) {
        return `${id}["${label.replace(/"/g, '#quot;')}"]`
      }
      return match
    }
  )

  // Handle round brackets: ID(label with (parens))
  s = s.replace(
    /(\b\w+)\(([^)]*\([^)]*\)[^)]*)\)/g,
    (_, id, label) => `${id}["${label.replace(/"/g, '#quot;')}"]`
  )

  // 10. Fix escaped inner quotes in already-quoted labels
  // NOTE: \n excluded from character classes to prevent cross-line matching
  // that would merge consecutive node definitions and break :::style syntax.
  s = s.replace(
    /\["([^"\n]*)"([^"\n]+)"([^"\n]*)"\]/g,
    (_, before, middle, after) => `["${before}${middle}${after}"]`
  )

  // 11. Replace colons in node IDs with underscores (colons break Mermaid)
  s = s.replace(/^(\s*)(\w+):(\w+)/gm, '$1$2_$3')

  return s
}

/**
 * Force-quote ALL node labels, regardless of content.
 * This is the aggressive fallback used when normal sanitization fails.
 */
function forceQuoteAllLabels(source: string): string {
  let s = source

  // Quote all square bracket labels: ID[text] → ID["text"]
  s = s.replace(
    /(\b\w+)\[(?!")([^\]]+)\]/g,
    (_, id, label) => `${id}["${label.replace(/"/g, '#quot;')}"]`
  )

  // Quote all round bracket labels with problematic chars: ID(text) → ID["text"]
  s = s.replace(
    /(\b\w+)\((?!")([^)]*[<>(){}|;&#][^)]*)\)/g,
    (_, id, label) => `${id}["${label.replace(/"/g, '#quot;')}"]`
  )

  // Quote all curly bracket labels: ID{text} → ID{"text"}
  s = s.replace(
    /(\b\w+)\{(?!")([^}]+)\}/g,
    (_, id, label) => `${id}{"${label.replace(/"/g, '#quot;')}"}`
  )

  return s
}

/**
 * Clean up orphaned Mermaid DOM elements to prevent firstChild null errors.
 * Call before each render.
 */
function cleanupMermaidDOM(renderId: string): void {
  document.getElementById(renderId)?.remove()
  document.getElementById(`d${renderId}`)?.remove()
}

export function MermaidDiagram({ chart, className, onNodeClick, onShowRawCode, ref }: MermaidDiagramProps & { ref?: Ref<MermaidDiagramHandle> }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [error, setError] = useState<string | null>(null)
    const [svgContent, setSvgContent] = useState<string>('')
    const renderIdRef = useRef(0)

    // Feature state
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark')
    const [darkSvg, setDarkSvg] = useState('')
    const [lightSvg, setLightSvg] = useState('')

    // Keep darkSvg in sync with the primary svgContent
    useEffect(() => {
      setDarkSvg(svgContent)
      // Invalidate cached light SVG when source changes
      setLightSvg('')
      setPreviewTheme('dark')
    }, [svgContent])

    // Expose SVG element to parent via ref
    useImperativeHandle(ref, () => ({
      getSvgElement: () => containerRef.current?.querySelector('svg') ?? null,
    }), [])

    useEffect(() => {
      const renderDiagram = async () => {
        if (!containerRef.current || !chart.trim()) {
          setSvgContent('')
          setError(null)
          return
        }
        renderIdRef.current++
        const currentRender = renderIdRef.current

        try {
          setError(null)
          const id = `mermaid_${currentRender}_${Date.now()}`

          // Clean up DOM before rendering
          cleanupMermaidDOM(id)

          // Sanitize
          const sanitized = sanitizeMermaidSource(chart)

          // Pre-validate with mermaid.parse before attempting render
          let sourceToRender = sanitized
          const isValid = await mermaid.parse(sanitized, { suppressErrors: true })

          if (!isValid) {
            // Try aggressive sanitization: force-quote all labels
            const aggressive = forceQuoteAllLabels(sanitized)
            const retryValid = await mermaid.parse(aggressive, { suppressErrors: true })

            if (!retryValid) {
              // All sanitization failed — show error with raw code fallback
              if (currentRender !== renderIdRef.current) return
              setError('Diagram syntax could not be parsed')
              return
            }

            sourceToRender = aggressive
          }

          const { svg, bindFunctions } = await mermaid.render(id, sourceToRender)
          // Guard against stale renders
          if (currentRender !== renderIdRef.current) return
          setSvgContent(svg)
          if (containerRef.current) {
            bindFunctions?.(containerRef.current)
          }
        } catch (err) {
          if (currentRender !== renderIdRef.current) return
          console.error('Mermaid render error:', err)
          setError(err instanceof Error ? err.message : 'Failed to render diagram')

          // Clean up orphaned mermaid error elements from the DOM
          document.querySelectorAll('[id^="dmermaid_"]').forEach((el) => el.remove())
        }
      }

      // Debounce: wait 300ms after last chart change before attempting render.
      // This prevents flash of error states during streaming when chart prop
      // updates rapidly with incomplete mermaid syntax.
      const timer = setTimeout(renderDiagram, 300)
      return () => clearTimeout(timer)
    }, [chart])

    // Attach click handlers to Mermaid nodes after render
    const attachClickHandlers = useCallback(() => {
      if (!containerRef.current || !onNodeClick) return

      const nodes = containerRef.current.querySelectorAll('.node, .nodeLabel')
      nodes.forEach((node) => {
        const el = node as HTMLElement
        el.style.cursor = 'pointer'

        // Find the node id from the closest .node element
        const nodeEl = el.closest('.node') as HTMLElement | null
        if (!nodeEl) return

        const nodeId = nodeEl.id?.replace(/^flowchart-/, '').replace(/-\d+$/, '') || ''
        if (!nodeId) return

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onNodeClick(nodeId)
        })
      })
    }, [onNodeClick])

    // Re-attach click handlers whenever SVG content changes
    useEffect(() => {
      if (svgContent) {
        // Small delay to ensure DOM is updated after dangerouslySetInnerHTML
        const timer = setTimeout(attachClickHandlers, 50)
        return () => clearTimeout(timer)
      }
    }, [svgContent, attachClickHandlers])

    // Trim excessive whitespace in rendered SVGs by tightening the viewBox
    // to the actual bounding box of the diagram content.
    useEffect(() => {
      if (!containerRef.current) return
      const timer = setTimeout(() => {
        const svg = containerRef.current?.querySelector('svg') as SVGSVGElement | null
        if (!svg) return
        try {
          const bbox = svg.getBBox()
          if (bbox.width <= 0 || bbox.height <= 0) return
          const pad = 16
          svg.setAttribute('viewBox',
            `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`)
          svg.removeAttribute('height')
        } catch {
          // getBBox can fail if SVG is not visible or detached
        }
      }, 150)
      return () => clearTimeout(timer)
    }, [darkSvg, lightSvg, previewTheme])

    // -------------------------------------------------------------------
    // Feature handlers
    // -------------------------------------------------------------------

    const handleToggleTheme = useCallback(async () => {
      if (themeRenderLock) return
      const newTheme = previewTheme === 'dark' ? 'light' : 'dark'

      if (newTheme === 'light' && !lightSvg) {
        try {
          themeRenderLock = true
          mermaid.initialize(LIGHT_THEME_CONFIG)
          const id = `mermaid_light_${Date.now()}`
          cleanupMermaidDOM(id)
          const sanitizedChart = sanitizeMermaidSource(chart)

          // Pre-validate, then try aggressive sanitization
          let sourceToRender = sanitizedChart
          const isValid = await mermaid.parse(sanitizedChart, { suppressErrors: true })
          if (!isValid) {
            const aggressive = forceQuoteAllLabels(sanitizedChart)
            const retryValid = await mermaid.parse(aggressive, { suppressErrors: true })
            if (!retryValid) {
              toast.error('Failed to render light theme preview')
              return
            }
            sourceToRender = aggressive
          }

          const { svg } = await mermaid.render(id, sourceToRender)
          setLightSvg(svg)
          // Clean up orphaned render element
          cleanupMermaidDOM(id)
        } catch (err) {
          console.error('Failed to render light theme:', err)
          toast.error('Failed to render light theme preview')
          return
        } finally {
          // Always restore dark theme for future renders
          mermaid.initialize(DARK_THEME_CONFIG)
          themeRenderLock = false
        }
      }

      setPreviewTheme(newTheme)
    }, [previewTheme, lightSvg, chart])

    const handleCopyImage = useCallback(async () => {
      const activeSvg = previewTheme === 'dark' ? darkSvg : lightSvg
      if (!activeSvg) return

      try {
        // Parse the SVG string to ensure proper namespace attributes
        const parser = new DOMParser()
        const doc = parser.parseFromString(activeSvg, 'image/svg+xml')
        const svgElement = doc.querySelector('svg')
        if (!svgElement) throw new Error('No SVG element found')

        // Ensure xmlns is present to avoid rendering issues in Image
        if (!svgElement.getAttribute('xmlns')) {
          svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        }

        const svgData = new XMLSerializer().serializeToString(svgElement)

        // Encode as base64 data URL to avoid cross-origin canvas tainting.
        // Blob URLs can taint the canvas when the SVG contains foreignObject
        // elements, but data URLs are treated as same-origin.
        const svgBase64 = btoa(unescape(encodeURIComponent(svgData)))
        const dataUrl = `data:image/svg+xml;base64,${svgBase64}`

        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas')
              const scale = 2
              canvas.width = img.naturalWidth * scale
              canvas.height = img.naturalHeight * scale
              const ctx = canvas.getContext('2d')
              if (!ctx) throw new Error('Could not get canvas context')
              ctx.scale(scale, scale)
              ctx.drawImage(img, 0, 0)

              canvas.toBlob(async (blob) => {
                if (!blob) {
                  reject(new Error('Failed to create image blob'))
                  return
                }
                try {
                  await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob }),
                  ])
                  resolve()
                } catch (clipErr) {
                  reject(clipErr)
                }
              }, 'image/png')
            } catch (drawErr) {
              reject(drawErr)
            }
          }
          img.onerror = () => reject(new Error('Failed to load SVG as image'))
          img.src = dataUrl
        })
      } catch (err) {
        console.error('Failed to copy image:', err)
        toast.error('Failed to copy diagram as image')
      }
    }, [previewTheme, darkSvg, lightSvg])

    const handleCopySource = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(chart)
      } catch (err) {
        console.error('Failed to copy source:', err)
        toast.error('Failed to copy diagram source')
      }
    }, [chart])

    const activeSvgContent = previewTheme === 'dark' ? darkSvg : (lightSvg || darkSvg)

    if (error) {
      const parsed = parseMermaidError(error)

      return (
        <div className={cn('flex flex-col items-center justify-center gap-3 p-8', className)}>
          <div className="flex items-center gap-2 text-status-error">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-sm font-medium">Failed to render diagram</p>
          </div>
          <p className="text-xs text-text-muted max-w-md break-words text-center">
            {parsed.message}
          </p>
          {(parsed.line != null || parsed.character != null) && (
            <p className="text-xs text-text-muted font-mono">
              {parsed.line != null && `Line ${parsed.line}`}
              {parsed.line != null && parsed.character != null && ', '}
              {parsed.character != null && `Column ${parsed.character}`}
            </p>
          )}
          {onShowRawCode && (
            <button
              onClick={onShowRawCode}
              className="flex items-center gap-1.5 mt-1 px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary bg-foreground/5 hover:bg-foreground/10 rounded transition-colors"
              aria-label="Show raw code"
            >
              <Code className="h-3 w-3" />
              Show raw code
            </button>
          )}
        </div>
      )
    }

    return (
      <>
        <div className={cn('group relative', className)}>
          {activeSvgContent && (
            <MermaidToolbar
              onFullscreen={() => setIsFullscreen(true)}
              onToggleTheme={handleToggleTheme}
              onCopyImage={handleCopyImage}
              onCopySource={handleCopySource}
              isDarkPreview={previewTheme === 'dark'}
            />
          )}
          <div
            ref={containerRef}
            className={cn('flex items-center justify-center mermaid-container',
              previewTheme === 'light' && 'bg-white rounded-md'
            )}
            dangerouslySetInnerHTML={{ __html: activeSvgContent }}
          />
        </div>
        <MermaidFullscreenDialog
          isOpen={isFullscreen}
          onOpenChange={setIsFullscreen}
          svgContent={activeSvgContent}
          isDarkPreview={previewTheme === 'dark'}
          onToggleTheme={handleToggleTheme}
          onCopyImage={handleCopyImage}
          onCopySource={handleCopySource}
        />
      </>
    )
  }
