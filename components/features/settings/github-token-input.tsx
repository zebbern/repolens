"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useGitHubToken } from "@/providers/github-token-provider"
import { Eye, EyeOff, ExternalLink, Check, X, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

export function GitHubTokenInput() {
  const { token, isValid, isValidating, username, scopes, setToken, validateToken, removeToken } =
    useGitHubToken()
  const [showToken, setShowToken] = useState(false)
  const [inputValue, setInputValue] = useState(token ?? "")
  const isDirtyRef = useRef(false)
  const previousTokenRef = useRef(token)

  useEffect(() => {
    if (token === previousTokenRef.current) return
    previousTokenRef.current = token

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (token === null) {
        isDirtyRef.current = false
        setInputValue("")
      } else if (!isDirtyRef.current) {
        setInputValue(token)
      }
    })

    return () => {
      cancelled = true
    }
  }, [token])

  const reportRemovalFailure = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : "Failed to remove GitHub token")
  }

  const commitToken = () => {
    const trimmed = inputValue.trim()
    isDirtyRef.current = false
    if (trimmed) {
      void Promise.resolve(setToken(trimmed)).catch(() => {})
    } else {
      void removeToken().catch(reportRemovalFailure)
    }
  }

  const handleValidate = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    isDirtyRef.current = false
    try {
      await setToken(trimmed)
      await validateToken(trimmed)
    } catch {
      // The provider reports credential-transition cleanup failures.
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleValidate()
  }

  const handleRemove = () => {
    isDirtyRef.current = false
    void removeToken()
      .then(() => setInputValue(""))
      .catch(reportRemovalFailure)
  }

  const getStatusIcon = () => {
    if (isValidating) return <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
    if (isValid === true) return <Check className="h-4 w-4 text-status-success" />
    if (isValid === false) return <X className="h-4 w-4 text-status-error" />
    return null
  }

  return (
    <div className="space-y-4">
      <form className="space-y-2" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <Label htmlFor="github-token" className="text-text-secondary">
            Personal Access Token
          </Label>
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
          >
            Create token
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="github-token"
              name="github-token"
              type={showToken ? "text" : "password"}
              autoComplete="off"
              value={inputValue}
              onChange={(e) => {
                isDirtyRef.current = true
                setInputValue(e.target.value)
              }}
              onBlur={() => commitToken()}
              placeholder="ghp_... or github_pat_..."
              className="pr-10 bg-foreground/5 border-foreground/10 text-text-primary placeholder:text-text-muted"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-text-muted hover:text-text-secondary"
              onClick={() => setShowToken(!showToken)}
              aria-label={showToken ? "Hide GitHub token" : "Show GitHub token"}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          <Button
            type="submit"
            disabled={!inputValue.trim() || isValidating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isValidating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="sr-only">Test</span>
              </>
            ) : "Test"}
          </Button>
        </div>
      </form>

      {/* Status */}
      {token && (
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2"
            role={!isValidating && isValid === false ? "alert" : "status"}
            aria-live={!isValidating && isValid === false ? "assertive" : "polite"}
          >
            {getStatusIcon()}
            <span className="text-sm text-text-secondary">
              {isValidating && "Validating..."}
              {!isValidating && isValid === true && (
                <>Connected{username && ` as ${username}`}</>
              )}
              {!isValidating && isValid === false && "Invalid token"}
              {!isValidating && isValid === null && "Not tested"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            className="text-text-muted hover:text-status-error"
            aria-label="Remove GitHub token"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Scopes */}
      {isValid && scopes.length > 0 && (
        <div className="space-y-2">
          <Label className="text-text-secondary">Token Scopes</Label>
          <div className="flex flex-wrap gap-1">
            {scopes.map((scope) => (
              <span
                key={scope}
                className="rounded-md bg-foreground/5 border border-foreground/10 px-2 py-0.5 text-xs text-text-secondary"
              >
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Help text */}
      <p className="text-xs text-text-muted">
        Your token is stored in this browser. RepoLens may send it through its server for validation, ZIP downloads, and some GitHub requests; other supported requests may go directly from your browser to GitHub.
        It enables private-repository access and higher API rate limits.
        For private repos, use a fine-grained, read-only token scoped to the specific repository with <code className="text-text-secondary">Contents: Read-only</code>.
      </p>
    </div>
  )
}
