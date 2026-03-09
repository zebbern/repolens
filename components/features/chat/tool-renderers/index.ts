import { lazy } from "react"
import type { ComponentType } from "react"

export interface ToolRendererProps {
  result: unknown
  args: Record<string, unknown>
  toolName: string
}

type LazyRenderer = React.LazyExoticComponent<ComponentType<ToolRendererProps>>

export const TOOL_RENDERERS: Record<string, LazyRenderer> = {
  readFile: lazy(() => import("./read-file-renderer")),
  readFiles: lazy(() => import("./read-files-renderer")),
  searchFiles: lazy(() => import("./search-files-renderer")),
  listDirectory: lazy(() => import("./list-directory-renderer")),
  scanIssues: lazy(() => import("./scan-issues-renderer")),
  generateDiagram: lazy(() => import("./diagram-renderer")),
  getProjectOverview: lazy(() => import("./project-overview-renderer")),
  findSymbol: lazy(() => import("./find-symbol-renderer")),
  getFileStats: lazy(() => import("./file-stats-renderer")),
  analyzeImports: lazy(() => import("./imports-renderer")),
}
