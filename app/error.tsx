"use client"

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error)
  }, [error])

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-6 bg-primary-background font-sans text-text-primary">
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl font-bold text-status-error">Error</span>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-center text-sm text-text-secondary">
          An unexpected error occurred. Please try again or return to the home
          page.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="lg">
        Try again
      </Button>
    </div>
  )
}
