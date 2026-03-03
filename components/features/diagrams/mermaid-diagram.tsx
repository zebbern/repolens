"use client"

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import mermaid from 'mermaid'
import { cn } from '@/lib/utils'

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
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
    curve: 'basis',
  },
})

export interface MermaidDiagramHandle {
  /** Returns the raw SVG element for export, or null if not rendered. */
  getSvgElement: () => SVGSVGElement | null
}

interface MermaidDiagramProps {
  chart: string
  className?: string
  /** Called when a user clicks a node. Receives the node's element id. */
  onNodeClick?: (nodeId: string) => void
}

export const MermaidDiagram = forwardRef<MermaidDiagramHandle, MermaidDiagramProps>(
  function MermaidDiagram({ chart, className, onNodeClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [error, setError] = useState<string | null>(null)
    const [svgContent, setSvgContent] = useState<string>('')
    const renderIdRef = useRef(0)

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
          const { svg } = await mermaid.render(id, chart)
          // Guard against stale renders
          if (currentRender !== renderIdRef.current) return
          setSvgContent(svg)
        } catch (err) {
          if (currentRender !== renderIdRef.current) return
          console.error('Mermaid render error:', err)
          setError(err instanceof Error ? err.message : 'Failed to render diagram')
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

    if (error) {
      return (
        <div className={cn('flex items-center justify-center p-8 text-status-error', className)}>
          <div className="text-center">
            <p className="text-sm font-medium">Failed to render diagram</p>
            <p className="text-xs text-text-muted mt-1 max-w-md break-words">{error}</p>
          </div>
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={cn('flex items-center justify-center mermaid-container', className)}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    )
  }
)
