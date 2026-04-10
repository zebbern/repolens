import { type KeyboardEvent, type ReactNode, type DragEvent, type ClipboardEvent, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp, ImagePlus, Loader2, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelSelector } from './model-selector'
import { toast } from 'sonner'
import type { FileUIPart } from 'ai'

const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2MB per image
const MAX_IMAGES = 4

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isLoading?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Slot rendered above the textarea (e.g. pinned context chips). */
  pinnedChips?: ReactNode
  /** Slot rendered next to ModelSelector in the bottom bar (e.g. pin file picker). */
  pinPicker?: ReactNode
  /** Slot rendered next to pinPicker in the bottom bar (e.g. skill selector). */
  skillPicker?: ReactNode
  /** Called to abort an in-progress stream. */
  onStop?: () => void
  /** Attached image files to display as previews. */
  attachedImages?: FileUIPart[]
  /** Called when user attaches new images (via button, paste, or drag-and-drop). */
  onImageAttach?: (images: FileUIPart[]) => void
  /** Called when user removes an attached image by index. */
  onImageRemove?: (index: number) => void
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = 'Ask about the codebase...',
  className,
  disabled = false,
  pinnedChips,
  pinPicker,
  skillPicker,
  onStop,
  attachedImages,
  onImageAttach,
  onImageRemove,
}: ChatInputProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(async (files: FileList | File[]) => {
    if (!onImageAttach) return
    const currentCount = attachedImages?.length ?? 0
    const remaining = MAX_IMAGES - currentCount
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed`)
      return
    }

    const fileArray = Array.from(files).slice(0, remaining)
    const newParts: FileUIPart[] = []

    for (const file of fileArray) {
      if (!file.type.startsWith('image/')) {
        toast.error(`"${file.name}" is not an image`)
        continue
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`"${file.name}" exceeds 2 MB limit`)
        continue
      }

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })

      newParts.push({ type: 'file', mediaType: file.type, filename: file.name, url: dataUrl })
    }

    if (newParts.length > 0) onImageAttach(newParts)
  }, [attachedImages?.length, onImageAttach])

  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()
      await processFiles(imageFiles)
    }
  }, [processFiles])

  const handleDragOver = useCallback((e: DragEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (files && files.length > 0) await processFiles(files)
  }, [processFiles])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit()
  }

  const isDisabled = isLoading || disabled
  const hasImages = attachedImages && attachedImages.length > 0
  const canAttachMore = onImageAttach && (attachedImages?.length ?? 0) < MAX_IMAGES

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn('relative rounded-lg border border-interactive-border bg-surface', disabled && 'opacity-60', className)}
    >
      {pinnedChips}

      {hasImages && (
        <div className="flex gap-2 px-3 pt-2 flex-wrap">
          {attachedImages.map((img, i) => (
            <div key={`${img.filename ?? 'img'}-${i}`} className="relative group">
              <img
                src={img.url}
                alt={img.filename || 'Attached image'}
                className="h-16 w-16 rounded-md object-cover border border-foreground/10"
              />
              <button
                type="button"
                onClick={() => onImageRemove?.(i)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-surface-elevated border border-foreground/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                <X className="h-2.5 w-2.5 text-text-muted" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        rows={1}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={isDisabled}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          if (e.target.files) await processFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <ModelSelector />
          {pinPicker}
          {skillPicker}
          {canAttachMore && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-text-primary"
              aria-label="Attach image"
              title={`Attach image (max 2 MB, up to ${MAX_IMAGES})`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isDisabled}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isLoading && onStop ? (
            <Button
              type="button"
              size="icon"
              className="h-7 w-7 bg-status-error/20 text-status-error hover:bg-status-error/30"
              aria-label="Stop generating"
              onClick={onStop}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={isDisabled || (!value.trim() && !hasImages)}
              size="icon"
              className="h-7 w-7 bg-interactive-hover text-text-primary hover:bg-interactive-active"
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
