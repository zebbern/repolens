"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useGitHubToken } from "@/providers/github-token-provider"
import { Eye, EyeOff, ExternalLink, Check, X, Loader2, Trash2 } from "lucide-react"

export function GitHubTokenInput() {
  const { token, isValid, isValidating, username, scopes, setToken, validateToken, removeToken } =
    useGitHubToken()
  const [showToken, setShowToken] = useState(false)
  const [inputValue, setInputValue] = useState(token ?? "")

  const commitToken = () => {
    const trimmed = inputValue.trim()
    if (trimmed) {
      setToken(trimmed)
    } else {
      removeToken()
    }
  }

  const handleValidate = async () => {
    commitToken()
    if (!inputValue.trim()) return
    await validateToken()
  }

  const handleRemove = () => {
    removeToken()
    setInputValue("")
  }

  const getStatusIcon = () => {
    if (isValidating) return <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
    if (isValid === true) return <Check className="h-4 w-4 text-status-success" />
    if (isValid === false) return <X className="h-4 w-4 text-status-error" />
    return null
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
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
              type={showToken ? "text" : "password"}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={() => commitToken()}
              onKeyDown={(e) => { if (e.key === 'Enter') commitToken() }}
              placeholder="ghp_... or github_pat_..."
              className="pr-10 bg-foreground/5 border-foreground/10 text-text-primary placeholder:text-text-muted"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-text-muted hover:text-text-secondary"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          <Button
            onClick={handleValidate}
            disabled={!token || isValidating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
          </Button>
        </div>
      </div>

      {/* Status */}
      {token && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
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
        Add a GitHub Personal Access Token for higher API rate limits and access to private repositories.
        No scopes needed for public repos. Add the <code className="text-text-secondary">repo</code> scope for private repos.
      </p>
    </div>
  )
}
