"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { GitCompareArrows, GitFork, Github, Settings } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { SettingsModal } from "@/components/features/settings/settings-modal"
import { ThemeToggle } from "@/components/theme-toggle"
import { AuthButton } from "@/components/features/auth/auth-button"
import { UserMenu } from "@/components/features/auth/user-menu"
import { ExportMenu } from "@/components/features/export/export-menu"
import { useAPIKeys } from "@/providers"

const SHOW_AUTH = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true"

interface HeaderProps {
  className?: string
}

export function Header({ className }: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { getValidProviders } = useAPIKeys()
  const { data: session } = useSession()
  
  const validProviders = getValidProviders()
  const hasValidKey = validProviders.length > 0

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true)
    window.addEventListener("open-settings", handleOpenSettings)
    return () => window.removeEventListener("open-settings", handleOpenSettings)
  }, [])

  return (
    <>
      <header className={`flex h-11 items-center bg-primary-background border-b border-foreground/[0.06] px-4 justify-between ${className || ''}`}>
        <div className="flex items-center gap-2">
          <Image src="/repolens.svg" alt="RepoLens" width={24} height={20} className="dark:invert" />
          <Link
            href="/compare"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            Compare
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {SHOW_AUTH && (session ? <UserMenu /> : <AuthButton />)}
          <ExportMenu />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-3.5 w-3.5" />
            {hasValidKey && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-status-success" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
            asChild
          >
            <a href="https://github.com/zebbern/repolens/fork" target="_blank" rel="noopener noreferrer">
              <GitFork className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
            asChild
          >
            <a href="https://github.com/zebbern/repolens" target="_blank" rel="noopener noreferrer">
              <Github className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </header>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
