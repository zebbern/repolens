"use client"

import { useState } from "react"
import { Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

interface TourGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (theme: string, maxStops: number) => void
  isGenerating: boolean
  error?: string | null
}

export function TourGenerateDialog({
  open,
  onOpenChange,
  onGenerate,
  isGenerating,
  error,
}: TourGenerateDialogProps) {
  const [theme, setTheme] = useState("")
  const [maxStops, setMaxStops] = useState(8)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onGenerate(theme.trim(), maxStops)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            Build Code Tour
          </DialogTitle>
          <DialogDescription>
            Build a local, deterministic tour from the repository index. Optionally prioritize a path or topic.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          {error && (
            <div className="rounded-md border border-status-error/20 bg-status-error/10 p-3 text-xs text-status-error" role="alert">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tour-theme">Focus path or topic (optional)</Label>
            <Input
              id="tour-theme"
              placeholder="e.g. src/auth, error handling, API design"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground">
              This prioritizes matching paths and topics; it is not an AI prompt.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="tour-stops">Max stops</Label>
              <span className="text-sm font-medium tabular-nums">{maxStops}</span>
            </div>
            <Slider
              id="tour-stops"
              min={2}
              max={30}
              step={1}
              value={[maxStops]}
              onValueChange={([v]) => setMaxStops(v)}
              disabled={isGenerating}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isGenerating} className="gap-2">
              {isGenerating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Building…
                </>
              ) : (
                <>
                  <Route className="h-3.5 w-3.5" />
                  Build Tour
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
