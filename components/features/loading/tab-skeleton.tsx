import { Skeleton } from "@/components/ui/skeleton"

/**
 * Skeleton fallback for the Issues tab.
 * Mimics the issues list: toolbar + rows with severity badge, title, and file path.
 */
export function IssuesTabSkeleton() {
  return (
    <div role="status" aria-label="Loading issues" className="flex h-full flex-col p-4 gap-3">
      {/* Toolbar area */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>
      {/* Issue rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border p-3">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-[60%]" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  )
}

/**
 * Skeleton fallback for the Docs tab.
 * Mimics the sidebar + content area layout.
 */
export function DocsTabSkeleton() {
  return (
    <div role="status" aria-label="Loading documentation" className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r p-4 flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-[80%]" />
        ))}
      </div>
      {/* Content area */}
      <div className="flex-1 p-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[75%]" />
        <Skeleton className="h-32 w-full mt-2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[85%]" />
      </div>
    </div>
  )
}

/**
 * Skeleton fallback for the Diagram tab.
 * Mimics the diagram toolbar + canvas area.
 */
export function DiagramTabSkeleton() {
  return (
    <div role="status" aria-label="Loading diagram" className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-md" />
        ))}
        <div className="flex-1" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center p-8">
        <Skeleton className="h-[60%] w-[70%] rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Skeleton fallback for the Code tab.
 * Mimics the file tree sidebar + code editor layout.
 */
export function CodeTabSkeleton() {
  return (
    <div role="status" aria-label="Loading code" className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-60 border-r p-3 flex flex-col gap-1.5">
        <Skeleton className="h-8 w-full mb-2" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2" style={{ paddingLeft: `${(i % 3) * 12}px` }}>
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
      {/* Editor area */}
      <div className="flex-1 p-4 flex flex-col gap-2">
        <Skeleton className="h-6 w-48 mb-2" />
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4" style={{ width: `${30 + ((i * 37) % 50)}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Skeleton fallback for the MermaidDiagram component inside diagram-viewer.
 * Mimics a loading diagram canvas.
 */
export function MermaidDiagramSkeleton() {
  return (
    <div role="status" aria-label="Loading diagram" className="flex min-h-[400px] items-center justify-center p-4">
      <Skeleton className="h-[300px] w-[80%] rounded-lg" />
    </div>
  )
}

/**
 * Skeleton fallback for the Changelog tab.
 * Mimics the sidebar + content area layout (matches DocsTabSkeleton).
 */
export function ChangelogTabSkeleton() {
  return (
    <div role="status" aria-label="Loading changelog" className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r p-4 flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-[80%]" />
        ))}
      </div>
      {/* Content area */}
      <div className="flex-1 p-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="flex flex-col gap-2 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton fallback for the Git History tab.
 * Mimics a toolbar row + scrollable commit timeline rows.
 */
export function GitHistoryTabSkeleton() {
  return (
    <div role="status" aria-label="Loading git history" className="flex h-full flex-col gap-3 p-4">
      {/* Toolbar area */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
        <div className="flex-1" />
        <Skeleton className="h-4 w-32" />
      </div>
      {/* Date header */}
      <Skeleton className="h-5 w-28" />
      {/* Commit rows */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4" style={{ width: `${40 + ((i * 23) % 40)}%` }} />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

/**
 * Skeleton fallback for the Deps tab.
 * Mimics the summary cards row + dependency table rows.
 */
export function DepsTabSkeleton() {
  return (
    <div role="status" aria-label="Loading dependencies" className="flex h-full flex-col gap-4 p-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-10" />
            </div>
          </div>
        ))}
      </div>
      {/* Table toolbar */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-28" />
        <div className="flex-1" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Table rows */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b pb-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-12 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
      ))}
    </div>
  )
}
