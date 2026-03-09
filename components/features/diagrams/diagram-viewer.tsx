"use client"

import { useState, useMemo, useRef, useCallback, useEffect, useTransition, lazy, Suspense } from 'react'
import type { MermaidDiagramHandle } from './mermaid-diagram'
import { MermaidDiagramSkeleton } from '@/components/features/loading/tab-skeleton'
import {
  generateDiagram,
  generateDiagramAsync,
  getAvailableDiagrams,
  generateProjectSummary,
  type DiagramType,
  type DiagramViewMode,
  type AnyDiagramResult,
  type TreemapDiagramResult,
  type AvailableDiagram,
} from '@/lib/diagrams/diagram-data'
import type { CodeIndex } from '@/lib/code/code-index'
import { useRepositoryData } from '@/providers'
import { Network, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/types/repository'
import { TreemapChart } from './treemap-chart'
import { DiagramOverview } from './diagram-overview'
import { StatsBar } from './stats-bar'
import { DiagramFloatingControls } from './diagram-floating-controls'
import { DiagramToolbar } from './diagram-toolbar'
import { exportSvg, exportPng } from './diagram-export'

// Lazy-load MermaidDiagram — it pulls in ~2.7 MB of Mermaid.js
const MermaidDiagram = lazy(() =>
  import('./mermaid-diagram').then(m => ({ default: m.MermaidDiagram }))
)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiagramViewerProps {
  files: FileNode[]
  codeIndex: CodeIndex
  className?: string
  onNavigateToFile?: (path: string) => void
}

// ---------------------------------------------------------------------------
// Main DiagramViewer
// ---------------------------------------------------------------------------

export function DiagramViewer({ files, codeIndex, className, onNavigateToFile }: DiagramViewerProps) {
  const [viewMode, setViewMode] = useState<DiagramViewMode>('overview')
  const { codebaseAnalysis: analysis } = useRepositoryData()
  const mermaidRef = useRef<MermaidDiagramHandle>(null)
  const treemapRef = useRef<SVGSVGElement>(null)
  const [isPending, startTransition] = useTransition()

  // Focus mode
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusQuery, setFocusQuery] = useState('')
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [focusHops, setFocusHops] = useState<1 | 2>(1)

  // Pan + zoom
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 })

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Dynamic available tabs
  const availableDiagrams = useMemo<AvailableDiagram[]>(() => {
    if (!analysis) return [{ id: 'topology' as DiagramType, label: 'Architecture', available: true }]
    return getAvailableDiagrams(analysis)
  }, [analysis])

  // Summary data for Overview
  const summaryData = useMemo(() => {
    if (!analysis) return null
    try {
      const result = generateProjectSummary(analysis, codeIndex)
      return result.data
    } catch {
      return null
    }
  }, [analysis, codeIndex])

  // Focus mode file search
  const focusSuggestions = useMemo(() => {
    if (!focusQuery || !analysis) return []
    const q = focusQuery.toLowerCase()
    return Array.from(analysis.files.keys())
      .filter(p => p.toLowerCase().includes(q))
      .slice(0, 8)
  }, [focusQuery, analysis])

  // Generate diagram (async — resolves content from store)
  const selectedType = viewMode === 'overview' ? null : viewMode
  const activeDiagramType = focusTarget ? 'focus' as DiagramType : selectedType
  const [diagram, setDiagram] = useState<AnyDiagramResult | null>(null)
  useEffect(() => {
    if (!activeDiagramType) { setDiagram(null); return }
    if (!files || files.length === 0 || codeIndex.totalFiles === 0) { setDiagram(null); return }
    if (!analysis && activeDiagramType !== 'treemap') { setDiagram(null); return }
    let cancelled = false
    generateDiagram(activeDiagramType, codeIndex, files, analysis || undefined, focusTarget || undefined, focusHops)
      .then(result => { if (!cancelled) setDiagram(result) })
      .catch(err => {
        console.error(`Diagram generation failed for type "${activeDiagramType}":`, err)
        if (!cancelled) setDiagram(null)
      })
    return () => { cancelled = true }
  }, [files, codeIndex, activeDiagramType, analysis, focusTarget, focusHops])

  // Async enhancement for class diagrams (Tree-sitter for non-JS/TS)
  const [asyncDiagram, setAsyncDiagram] = useState<AnyDiagramResult | null>(null)
  useEffect(() => {
    if (activeDiagramType !== 'classes' || !files || files.length === 0 || codeIndex.totalFiles === 0) {
      setAsyncDiagram(null)
      return
    }
    let cancelled = false
    generateDiagramAsync('classes', codeIndex, files).then(result => {
      if (!cancelled) setAsyncDiagram(result)
    }).catch(() => { /* sync fallback is already showing */ })
    return () => { cancelled = true }
  }, [activeDiagramType, files, codeIndex])

  // Use async-enhanced diagram for classes if available, otherwise sync
  const activeDiagram = (activeDiagramType === 'classes' && asyncDiagram) ? asyncDiagram : diagram

  // Reset pan/zoom on change
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [viewMode, focusTarget])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.2, Math.min(4, z + (e.deltaY > 0 ? -0.08 : 0.08))))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 2) return // right-click only for panning
    e.preventDefault()
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault() // suppress context menu on diagram area
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    setPan({ x: panStart.current.panX + e.clientX - panStart.current.x, y: panStart.current.panY + e.clientY - panStart.current.y })
  }, [])

  const handleMouseUp = useCallback(() => { isPanning.current = false }, [])
  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  const handleExportSvg = useCallback(() => {
    const svgEl = activeDiagramType === 'treemap'
      ? treemapRef.current
      : mermaidRef.current?.getSvgElement()
    if (svgEl && activeDiagramType) exportSvg(svgEl, activeDiagramType)
  }, [activeDiagramType])

  const handleExportPng = useCallback(() => {
    const svgEl = activeDiagramType === 'treemap'
      ? treemapRef.current
      : mermaidRef.current?.getSvgElement()
    if (svgEl && activeDiagramType) exportPng(svgEl, activeDiagramType)
  }, [activeDiagramType])

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!activeDiagram || activeDiagram.type === 'treemap') return
    const pathMap = (activeDiagram as { nodePathMap: Map<string, string> }).nodePathMap
    const filePath = pathMap.get(nodeId)
    if (filePath && onNavigateToFile) onNavigateToFile(filePath)
  }, [activeDiagram, onNavigateToFile])

  const handleTreemapClick = useCallback((path: string) => { onNavigateToFile?.(path) }, [onNavigateToFile])

  const handleFocusSelect = useCallback((path: string) => {
    startTransition(() => {
      setViewMode('focus' as DiagramType)
      setFocusTarget(path)
    })
    setFocusQuery(path.split('/').pop() || path)
  }, [startTransition])

  const clearFocus = useCallback(() => {
    setFocusTarget(null)
    setFocusQuery('')
    setFocusOpen(false)
    setViewMode('overview')
  }, [])

  if (!files || files.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <div className="flex flex-col items-center gap-4 text-text-muted animate-in fade-in duration-300">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
            <Network className="h-6 w-6 text-text-secondary" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-text-secondary">No repository connected</p>
            <p className="text-xs text-center max-w-[260px]">Connect a GitHub repository to generate architecture, dependency, and topology diagrams</p>
          </div>
        </div>
      </div>
    )
  }

  const isOverview = viewMode === 'overview' && !focusTarget
  const isTreemap = activeDiagramType === 'treemap'
  const isMermaid = !isOverview && !isTreemap && activeDiagram && activeDiagram.type !== 'treemap'
  const canExport = !!isMermaid || isTreemap

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Toolbar: diagram tabs + export */}
      <DiagramToolbar
        availableDiagrams={availableDiagrams}
        viewMode={viewMode}
        onSelectType={(type) => { startTransition(() => { setViewMode(type) }); setFocusTarget(null); setFocusQuery('') }}
        onSelectOverview={() => { startTransition(() => { setViewMode('overview') }); setFocusTarget(null); setFocusQuery('') }}
        focusTarget={focusTarget}
        onClearFocus={clearFocus}
        canExport={canExport}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
      />

      {/* Title bar */}
      {activeDiagram && (
        <div className="px-4 py-1.5 border-b border-foreground/[0.06] bg-background">
          <h3 className="text-xs font-medium text-text-secondary">{activeDiagram.title}</h3>
        </div>
      )}

      {/* Content */}
      {!analysis && codeIndex.totalFiles > 0 && !activeDiagram ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
            <p className="text-sm text-text-muted">Analyzing codebase...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          {/* Pannable / zoomable diagram area */}
          {/* Pending overlay for transitions */}
          {isPending && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px] transition-opacity">
              <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
            </div>
          )}
          {isOverview && analysis && summaryData ? (
            <div ref={containerRef} className={cn('w-full h-full overflow-auto', isPending && 'opacity-60 transition-opacity')}>
              <DiagramOverview
                analysis={analysis}
                availableDiagrams={availableDiagrams}
                onSelectDiagram={(type) => { startTransition(() => { setViewMode(type) }) }}
                onFocusFile={handleFocusSelect}
                summaryData={summaryData}
              />
            </div>
          ) : (
            <div
              ref={containerRef}
              className={cn('w-full h-full overflow-hidden', isPending && 'opacity-60 transition-opacity')}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
            >
              <div className="w-full h-full" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}>
                {activeDiagram ? (
                  isTreemap && activeDiagram.type === 'treemap' ? (
                    <TreemapChart ref={treemapRef} data={(activeDiagram as TreemapDiagramResult).data} width={containerSize.width} height={containerSize.height} onNodeClick={handleTreemapClick} />
                  ) : activeDiagram.type !== 'treemap' && activeDiagram.type !== 'summary' ? (
                    <Suspense fallback={<MermaidDiagramSkeleton />}>
                      <MermaidDiagram ref={mermaidRef} chart={activeDiagram.chart} className="min-h-[400px] p-4" onNodeClick={handleNodeClick} />
                    </Suspense>
                  ) : null
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
                      <Network className="h-8 w-8 text-text-muted" />
                      <p className="text-sm text-text-muted">No diagram data available for this view</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Floating controls -- bottom-right corner */}
          <DiagramFloatingControls
            analysis={analysis}
            focusOpen={focusOpen}
            setFocusOpen={setFocusOpen}
            focusQuery={focusQuery}
            setFocusQuery={setFocusQuery}
            focusTarget={focusTarget}
            setFocusTarget={setFocusTarget}
            focusHops={focusHops}
            setFocusHops={setFocusHops}
            focusSuggestions={focusSuggestions}
            onFocusSelect={handleFocusSelect}
            onClearFocus={clearFocus}
            zoom={zoom}
            setZoom={setZoom}
            onResetView={resetView}
          />
        </div>
      )}

      {/* Stats bar */}
      {activeDiagram && activeDiagram.stats && (
        <StatsBar
          stats={activeDiagram.stats}
          topology={analysis ? {
            clusters: analysis.topology.clusters.length,
            maxDepth: analysis.topology.maxDepth,
            orphans: analysis.topology.orphans.length,
            connectors: analysis.topology.connectors.length,
          } : undefined}
        />
      )}
    </div>
  )
}
