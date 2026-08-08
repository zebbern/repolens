"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { toast } from "sonner"
import { loadGitHubToken, saveGitHubToken, removeGitHubToken } from "@/lib/github-token"
import { setGitHubPAT, clearGitHubCache } from "@/lib/github/client"

interface GitHubTokenContextType {
  token: string | null
  isValid: boolean | null
  isValidating: boolean
  isHydrated: boolean
  username: string | null
  scopes: string[]
  setToken: (token: string) => void
  validateToken: () => Promise<boolean>
  removeToken: () => void
}

const GitHubTokenContext = createContext<GitHubTokenContextType | null>(null)

export function GitHubTokenProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [scopes, setScopes] = useState<string[]>([])

  const tokenRef = useRef<string | null>(null)
  useEffect(() => { tokenRef.current = token }, [token])

  // Hydrate from localStorage on mount (avoids SSR/client mismatch)
  useEffect(() => {
    const stored = loadGitHubToken()
    if (stored) {
      tokenRef.current = stored
      setGitHubPAT(stored)
    }
    queueMicrotask(() => {
      if (stored) setTokenState(stored)
      setIsHydrated(true)
    })
  }, [])

  const setToken = useCallback((newToken: string) => {
    setTokenState(newToken)
    tokenRef.current = newToken
    saveGitHubToken(newToken)
    setGitHubPAT(newToken)
    clearGitHubCache()
    // Reset validation state when token changes
    setIsValid(null)
    setUsername(null)
    setScopes([])
  }, [])

  const validateToken = useCallback(async (): Promise<boolean> => {
    const current = tokenRef.current
    if (!current) return false

    setIsValidating(true)
    try {
      const res = await fetch("/api/github/validate-token", {
        method: "POST",
        headers: { "X-GitHub-Token": current },
      })
      const data = await res.json() as
        | { valid: true; login: string; scopes: string[] }
        | { valid: false; error: string }

      if (data.valid) {
        setIsValid(true)
        setUsername(data.login)
        setScopes(data.scopes)
        return true
      }

      setIsValid(false)
      setUsername(null)
      setScopes([])
      toast.error(`GitHub token invalid: ${data.error}`)
      return false
    } catch {
      setIsValid(false)
      setUsername(null)
      setScopes([])
      toast.error("Failed to validate GitHub token — check your network and try again")
      return false
    } finally {
      setIsValidating(false)
    }
  }, [])

  const removeTokenFn = useCallback(() => {
    setTokenState(null)
    tokenRef.current = null
    removeGitHubToken()
    setGitHubPAT(null)
    clearGitHubCache()
    setIsValid(null)
    setUsername(null)
    setScopes([])
  }, [])

  return (
    <GitHubTokenContext.Provider
      value={{
        token,
        isValid,
        isValidating,
        isHydrated,
        username,
        scopes,
        setToken,
        validateToken,
        removeToken: removeTokenFn,
      }}
    >
      {children}
    </GitHubTokenContext.Provider>
  )
}

export function useGitHubToken() {
  const ctx = useContext(GitHubTokenContext)
  if (!ctx) {
    throw new Error("useGitHubToken must be used within a GitHubTokenProvider")
  }
  return ctx
}
