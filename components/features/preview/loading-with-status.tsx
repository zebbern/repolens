"use client"

export function LoadingWithStatus() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-primary-background">
      <div className="w-full max-w-xl space-y-4 p-4">
        <div className="flex items-center space-x-3 font-medium text-text-secondary">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-blue-600"></div>
          <span>Generating component...</span>
        </div>
        <p className="text-sm text-text-muted">
          This may take a few moments.
        </p>
      </div>
    </div>
  )
}
