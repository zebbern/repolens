"use client"

import { signIn, signOut, useSession } from "next-auth/react"
import { LogIn, LogOut, KeyRound } from "lucide-react"
import { Github } from "@/components/icons/github"
import { Button } from "@/components/ui/button"
import { useGitHubToken } from "@/providers/github-token-provider"

export function AuthButton() {
  const { data: session, status } = useSession()
  const { isValid: hasPAT } = useGitHubToken()

  if (status === "loading") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-text-secondary"
        disabled
      >
        <Github className="h-3.5 w-3.5" />
      </Button>
    )
  }

  if (session) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-foreground/5"
        onClick={() => signOut()}
      >
        <LogOut className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {hasPAT === true && (
        <span className="flex items-center gap-1 text-xs text-status-success" title="Authenticated via PAT">
          <KeyRound className="h-3 w-3" />
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-foreground/5"
        onClick={() => signIn("github")}
      >
        <LogIn className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
    </div>
  )
}
