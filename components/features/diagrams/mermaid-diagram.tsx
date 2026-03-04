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
 * Sanitize mermaid source to fix common AI-generated syntax issues.
 * Handles markdown fencing, special-char labels, invalid arrows, HTML tags,
 * and other patterns that frequently appear in LLM output.
 */
function sanitizeMermaidSource(source: string): string {
  let sanitized = source.trim()

  // 1. Remove markdown fencing that AI might include
  sanitized = sanitized.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')

  // 2. Fix labels containing special characters that break Mermaid
  //    NodeId[Label with (parens) or <brackets>] → NodeId["Label..."]
  sanitized = sanitized.replace(
    /(\w+)\[([^\]"]*[<>(){}][^\]"]*)\]/g,
    (_, id: string, label: string) => `${id}["${label.replace(/"/g, '#quot;')}"]`,
  )

  // 3. Fix labels with slashes (original pattern, improved)
  sanitized = sanitized.replace(
    /(\w+)\[([^\]"]*\/[^\]"]*)\](?!\()/g,
    (_match, id: string, content: string) => {
      if (content.startsWith('/') && content.endsWith('\\')) return _match
      return `${id}["${content}"]`
    },
  )

  // 4. Fix double-quoted labels that contain unescaped inner quotes
  sanitized = sanitized.replace(
    /\["([^"]*)"([^"]+)"([^"]*)"\]/g,
    (_, before: string, middle: string, after: string) => `["${before}${middle}${after}"]`,
  )

  // 5. Replace HTML-like tags that AI sometimes generates in node labels
  sanitized = sanitized.replace(/<br\s*\/?>/gi, '\\n')
  sanitized = sanitized.replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, '')

  // 6. Fix invalid arrow syntax: "- ->" → "-->" and "<- -" → "<--"
  sanitized = sanitized.replace(/- ->/g, '-->')
  sanitized = sanitized.replace(/<- -/g, '<--')

  // 7. Normalize line endings
  sanitized = sanitized.replace(/\r\n/g, '\n')

  // 8. Collapse runs of 3+ blank lines to avoid parse errors
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n')

  return sanitized
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
          const sanitizedChart = sanitizeMermaidSource(chart)
          const { svg } = await mermaid.render(id, sanitizedChart)
          // Guard against stale renders
          if (currentRender !== renderIdRef.current) return
          setSvgContent(svg)
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
          const sanitizedChart = sanitizeMermaidSource(chart)
          const { svg } = await mermaid.render(id, sanitizedChart)
          setLightSvg(svg)
          // Clean up orphaned render element
          document.getElementById(id)?.remove()
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
