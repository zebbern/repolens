"use client"

import { useState, useCallback, type FormEvent } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useComparison } from "@/providers/comparison-provider"
import { MAX_COMPARISON_REPOS } from "@/types/comparison"

const MIN_INPUTS = 2

export function RepoInputBar() {
  const [urls, setUrls] = useState<string[]>(["", ""])
  const [isAdding, setIsAdding] = useState(false)
  const { addRepo, isAtCapacity, repos } = useComparison()

  const filledCount = urls.filter((u) => u.trim()).length
  const canCompare = filledCount >= 2
  const canAddMore = urls.length < MAX_COMPARISON_REPOS && !isAtCapacity

  const updateUrl = useCallback((index: number, value: string) => {
    setUrls((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const addInput = useCallback(() => {
    setUrls((prev) => [...prev, ""])
  }, [])

  const removeInput = useCallback((index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleCompare = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const toAdd = urls.map((u) => u.trim()).filter(Boolean)
      if (toAdd.length < 2) return

      setIsAdding(true)
      try {
        const results = await Promise.all(toAdd.map((u) => addRepo(u)))
        // Clear only successfully added URLs
        setUrls((prev) =>
          prev.map((u, i) => {
            const trimmed = u.trim()
            const addedIndex = toAdd.indexOf(trimmed)
            if (addedIndex !== -1 && results[addedIndex]) return ""
            return u
          })
        )
      } finally {
        setIsAdding(false)
      }
    },
    [urls, addRepo]
  )

  return (
    <form onSubmit={handleCompare} className="space-y-2">
      {urls.map((url, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type="text"
            placeholder={
              index === 0
                ? "Enter first repository URL"
                : index === 1
                  ? "Enter second repository URL"
                  : `Repository URL ${index + 1}`
            }
            value={url}
            onChange={(e) => updateUrl(index, e.target.value)}
            disabled={isAdding}
            className="flex-1"
            aria-label={`Repository URL ${index + 1}`}
          />
          {index >= MIN_INPUTS && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-text-secondary hover:text-destructive"
              onClick={() => removeInput(index)}
              disabled={isAdding}
              aria-label={`Remove repository ${index + 1}`}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2">
        {canAddMore && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addInput}
            disabled={isAdding}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add another repo
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={isAdding || !canCompare}
        >
          {isAdding ? "Comparing…" : "Compare"}
        </Button>
      </div>
    </form>
  )
}
