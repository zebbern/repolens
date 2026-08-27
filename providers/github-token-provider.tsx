"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { GITHUB_TOKEN_STORAGE_KEY, loadGitHubToken, saveGitHubToken, removeGitHubToken } from "@/lib/github-token"
import { setGitHubPAT, setGitHubOAuthPrincipal, clearGitHubCache } from "@/lib/github/client"
import { clearPrivateRepoCache } from "@/lib/cache/repo-cache"
import { clearScanCache } from '@/lib/code/scanner/scanner'
import { clearValidationCache } from '@/lib/code/scanner/ai-validator'
import {
  PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT,
  PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT,
  isPrivateRepositoryRevocation,
  notifyPrivateRepositoryAccessRevoked,
} from '@/lib/auth/credential-events'

interface GitHubTokenContextType {
  token: string | null
  isValid: boolean | null
  isValidating: boolean
  isHydrated: boolean
  username: string | null
  scopes: string[]
  setToken: (token: string) => Promise<void>
  validateToken: (token?: string) => Promise<boolean>
  removeToken: () => Promise<void>
}

const GitHubTokenContext = createContext<GitHubTokenContextType | null>(null)

export function GitHubTokenProvider({ children }: { children: ReactNode }) {
  const { data: session, status: sessionStatus } = useSession()
  const [token, setTokenState] = useState<string | null>(null)
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [scopes, setScopes] = useState<string[]>([])
  const [appliedOAuthPrincipal, setAppliedOAuthPrincipal] = useState<string | null | undefined>(undefined)
  const [credentialTransitioning, setCredentialTransitioning] = useState(false)

  const tokenRef = useRef<string | null>(null)
  const credentialStateRef = useRef({
    token: null as string | null,
    isValid: null as boolean | null,
    username: null as string | null,
    scopes: [] as string[],
  })
  const validationRef = useRef<{ generation: number; controller: AbortController } | null>(null)
  const validationGenerationRef = useRef(0)
  const transitionGenerationRef = useRef(0)
  useEffect(() => { tokenRef.current = token }, [token])
  useEffect(() => {
    credentialStateRef.current = { token, isValid, username, scopes }
  }, [isValid, scopes, token, username])

  const oauthPrincipal = session?.user?.githubUserId ?? session?.user?.githubUsername ?? null

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

  useEffect(() => {
    if (!isHydrated || sessionStatus === 'loading') {
      return
    }

    if (appliedOAuthPrincipal === oauthPrincipal) return

    setGitHubOAuthPrincipal(oauthPrincipal)
    clearGitHubCache()
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setAppliedOAuthPrincipal(oauthPrincipal)
      setCredentialTransitioning(false)
    })
    return () => { cancelled = true }
  }, [appliedOAuthPrincipal, isHydrated, oauthPrincipal, sessionStatus])

  const clearLocalCredentialState = useCallback((broadcast: boolean) => {
    validationRef.current?.controller.abort()
    validationRef.current = null
    validationGenerationRef.current += 1
    setIsValidating(false)
    tokenRef.current = null
    setTokenState(null)
    setGitHubPAT(null)
    clearGitHubCache()
    clearScanCache()
    clearValidationCache()
    setIsValid(null)
    setUsername(null)
    setScopes([])
    if (broadcast) notifyPrivateRepositoryAccessRevoked()
  }, [])

  const restoreCredentialState = useCallback((previous: typeof credentialStateRef.current) => {
    tokenRef.current = previous.token
    setTokenState(previous.token)
    setGitHubPAT(previous.token)
    setIsValid(previous.isValid)
    setUsername(previous.username)
    setScopes(previous.scopes)
    setCredentialTransitioning(false)
  }, [])

  const installToken = useCallback((newToken: string, persist: boolean) => {
    if (persist) saveGitHubToken(newToken)
    tokenRef.current = newToken
    setGitHubPAT(newToken)
    setTokenState(newToken)
  }, [])

  const setToken = useCallback(async (newToken: string) => {
    if (newToken === tokenRef.current) return
    const generation = ++transitionGenerationRef.current
    const previous = credentialStateRef.current
    setCredentialTransitioning(true)
    clearLocalCredentialState(true)
    try {
      await clearPrivateRepoCache()
    } catch (error) {
      if (transitionGenerationRef.current === generation) {
        setCredentialTransitioning(false)
        toast.error('Private repository cleanup failed; the new GitHub token was not saved')
      }
      throw error
    }
    if (transitionGenerationRef.current !== generation) return
    try {
      installToken(newToken, true)
      setCredentialTransitioning(false)
    } catch (error) {
      restoreCredentialState(previous)
      throw error
    }
  }, [clearLocalCredentialState, installToken, restoreCredentialState])

  const validateToken = useCallback(async (tokenOverride?: string): Promise<boolean> => {
    const current = tokenOverride ?? tokenRef.current
    if (!current) return false

    const validation = {
      generation: ++validationGenerationRef.current,
      controller: new AbortController(),
    }
    validationRef.current = validation
    setIsValidating(true)
    try {
      const res = await fetch("/api/github/validate-token", {
        method: "POST",
        headers: { "X-GitHub-Token": current },
        signal: validation.controller.signal,
      })
      if (validationRef.current !== validation || validation.controller.signal.aborted || tokenRef.current !== current) return false
      const data = await res.json() as
        | { valid: true; login: string; scopes: string[] }
        | { valid: false; error: string }
      if (validationRef.current !== validation || validation.controller.signal.aborted || tokenRef.current !== current) return false

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
      if (validationRef.current !== validation || validation.controller.signal.aborted || tokenRef.current !== current) return false
      setIsValid(false)
      setUsername(null)
      setScopes([])
      toast.error("Failed to validate GitHub token — check your network and try again")
      return false
    } finally {
      if (validationRef.current === validation) {
        validationRef.current = null
        setIsValidating(false)
      }
    }
  }, [])

  const removeTokenFn = useCallback(async () => {
    const generation = ++transitionGenerationRef.current
    setCredentialTransitioning(true)
    clearLocalCredentialState(true)
    let removalError: unknown
    try {
      removeGitHubToken()
    } catch (error) {
      removalError = error
      toast.error('The GitHub token could not be removed from browser storage')
    }

    let cleanupError: unknown
    try {
      await clearPrivateRepoCache()
    } catch (error) {
      cleanupError = error
      toast.error('Private repository cleanup failed; retry token removal')
    }

    if (transitionGenerationRef.current !== generation) return
    setCredentialTransitioning(false)
    if (removalError) throw removalError
    if (cleanupError) throw cleanupError
  }, [clearLocalCredentialState])

  useEffect(() => {
    const handleSameWindowRevocation = () => {
      setCredentialTransitioning(true)
      clearGitHubCache()
    }
    const handleRevocationFinished = (event: Event) => {
      const detail = (event as CustomEvent<{ success?: boolean }>).detail
      if (detail?.success === false
        && sessionStatus === 'unauthenticated'
        && oauthPrincipal === null) {
        setCredentialTransitioning(false)
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (!isPrivateRepositoryRevocation(event) && event.key !== GITHUB_TOKEN_STORAGE_KEY) return

      const generation = ++transitionGenerationRef.current
      setCredentialTransitioning(true)
      clearLocalCredentialState(false)
      const nextToken = event.key === GITHUB_TOKEN_STORAGE_KEY ? event.newValue : null
      void clearPrivateRepoCache().then(() => {
        if (transitionGenerationRef.current !== generation) return
        if (nextToken) installToken(nextToken, false)
        // A revocation-only event may be an OAuth sign-out from another tab.
        // Keep descendants gated until NextAuth reports the new session
        // principal. PAT storage events provide the deterministic release for
        // token replacement and removal.
        if (event.key === GITHUB_TOKEN_STORAGE_KEY
          || (sessionStatus === 'unauthenticated' && oauthPrincipal === null)) {
          setCredentialTransitioning(false)
        }
      }).catch(() => {
        if (transitionGenerationRef.current === generation) {
          toast.error('Private repository cache cleanup failed after a credential change in another tab')
        }
      })
    }

    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleSameWindowRevocation)
    window.addEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, handleRevocationFinished)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT, handleSameWindowRevocation)
      window.removeEventListener(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, handleRevocationFinished)
      window.removeEventListener('storage', handleStorage)
    }
  }, [clearLocalCredentialState, installToken, oauthPrincipal, sessionStatus])

  useEffect(() => () => {
    transitionGenerationRef.current += 1
    validationRef.current?.controller.abort()
  }, [])

  const canRenderDescendants =
    isHydrated &&
    sessionStatus !== 'loading' &&
    !credentialTransitioning &&
    appliedOAuthPrincipal === oauthPrincipal

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
      {canRenderDescendants ? children : null}
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
