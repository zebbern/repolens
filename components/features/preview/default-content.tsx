"use client"

import { Code2 } from "lucide-react"

export function DefaultContent() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center bg-background">
      <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/4 border border-foreground/6">
          <Code2 className="h-6 w-6 text-text-secondary" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-medium text-text-secondary">Select a tab to get started</p>
          <p className="text-xs text-text-muted">Browse code, scan for issues, generate docs, or view diagrams</p>
        </div>
      </div>
    </div>
  )
}
