"use client"

import { useState } from "react"
import { Plus, Play, Trash2, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Tour } from "@/types/tours"

interface TourSidebarProps {
  tours: Tour[]
  activeTour: Tour | null
  isPlaying: boolean
  onStartTour: (tour: Tour) => void
  onDeleteTour: (id: string) => void
  onCreateTour: (name: string, description: string) => void
}

export function TourSidebar({
  tours,
  activeTour,
  isPlaying,
  onStartTour,
  onDeleteTour,
  onCreateTour,
}: TourSidebarProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")

  const handleCreate = () => {
    const trimmedName = newName.trim()
    if (!trimmedName) return
    onCreateTour(trimmedName, newDescription.trim())
    setNewName("")
    setNewDescription("")
    setIsCreateOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-foreground/[0.06] px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Tours
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-text-muted hover:text-text-primary"
          onClick={() => setIsCreateOpen(true)}
          title="Create new tour"
          aria-label="Create new tour"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tour List */}
      <ScrollArea className="flex-1">
        {tours.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center animate-in fade-in duration-300">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] mb-3">
              <Route className="h-5 w-5 text-text-secondary" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1">No tours yet</p>
            <p className="text-xs text-text-muted max-w-[200px]">
              Create a tour manually or ask AI to generate a guided walkthrough.
            </p>
            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {tours.map((tour) => {
              const isActive = activeTour?.id === tour.id
              return (
                <div
                  key={tour.id}
                  className={cn(
                    "group rounded-md border border-transparent px-2.5 py-2 transition-colors",
                    isActive
                      ? "bg-foreground/[0.06] border-foreground/[0.08]"
                      : "hover:bg-foreground/[0.03]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {tour.name}
                      </p>
                      {tour.description && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                          {tour.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-text-muted bg-foreground/[0.04] px-1.5 py-0.5 rounded">
                          {tour.stops.length} {tour.stops.length === 1 ? "stop" : "stops"}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {new Date(tour.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-text-muted hover:text-accent-primary"
                        onClick={() => onStartTour(tour)}
                        disabled={tour.stops.length === 0}
                        title={tour.stops.length === 0 ? "Tour has no stops" : "Play tour"}
                        aria-label={`Play tour: ${tour.name}`}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-text-muted hover:text-status-error"
                        onClick={() => onDeleteTour(tour.id)}
                        disabled={isPlaying && isActive}
                        title={isPlaying && isActive ? "Stop the tour before deleting" : "Delete tour"}
                        aria-label={`Delete tour: ${tour.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* Create Tour Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Tour</DialogTitle>
            <DialogDescription>
              Create a new guided tour for this repository.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label
                htmlFor="tour-name"
                className="text-sm font-medium text-text-primary mb-1.5 block"
              >
                Name
              </label>
              <input
                id="tour-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Authentication Flow"
                className="w-full rounded-md border border-foreground/[0.1] bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                autoFocus
              />
            </div>
            <div>
              <label
                htmlFor="tour-description"
                className="text-sm font-medium text-text-primary mb-1.5 block"
              >
                Description{" "}
                <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <textarea
                id="tour-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="A brief description of what this tour covers..."
                rows={3}
                className="w-full rounded-md border border-foreground/[0.1] bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create Tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
