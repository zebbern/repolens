"use client"

import { Code2 } from "lucide-react"

export function DefaultContent() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Code2 className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-medium text-muted-foreground">Preview</h2>
      </div>
    </div>
  )
}
