import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModelSelector } from './model-selector'

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
}: ChatInputProps) {
  const formRef = useRef<HTMLFormElement>(null)

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

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={cn('relative rounded-lg border border-interactive-border bg-surface', disabled && 'opacity-60', className)}>
      {pinnedChips}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="resize-none border-0 bg-transparent pr-24 focus-visible:ring-0 focus-visible:ring-offset-0"
        rows={2}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <ModelSelector />
          {pinPicker}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="submit"
            disabled={isDisabled || !value.trim()}
            size="icon"
            className="h-7 w-7 bg-interactive-hover text-text-primary hover:bg-interactive-active"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}
