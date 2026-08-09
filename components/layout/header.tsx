"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { GitCompareArrows, GitFork, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Github } from "@/components/icons/github"
import Image from "next/image"
import Link from "next/link"
import { SettingsModal } from "@/components/features/settings/settings-modal"
import { ThemeToggle } from "@/components/theme-toggle"
import { AuthButton } from "@/components/features/auth/auth-button"
import { UserMenu } from "@/components/features/auth/user-menu"
import { ExportMenu } from "@/components/features/export/export-menu"
import { useAPIKeys, useApp } from "@/providers"
import { useIsMobile } from "@/hooks/use-mobile"
import type { AIProvider } from "@/types/types"

const SHOW_AUTH = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true"

interface HeaderProps {
  className?: string
}

export function Header({ className }: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<AIProvider | "github">("github")
  const [settingsRequestId, setSettingsRequestId] = useState(0)
  const settingsOpenerRef = useRef<HTMLElement | null>(null)
  const { getValidProviders } = useAPIKeys()
  const { isChatCollapsed, setChatCollapsed } = useApp()
  const isMobile = useIsMobile()
  const { data: session } = useSession()
  
  const validProviders = getValidProviders()
  const hasValidKey = validProviders.length > 0

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const requestedTab = (event as CustomEvent<{ tab?: AIProvider | "github" }>).detail?.tab
      settingsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (requestedTab) setSettingsTab(requestedTab)
      setSettingsRequestId((requestId) => requestId + 1)
      setSettingsOpen(true)
    }
    window.addEventListener("open-settings", handleOpenSettings)
    return () => window.removeEventListener("open-settings", handleOpenSettings)
  }, [])

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open)
    if (!open) {
      window.requestAnimationFrame(() => settingsOpenerRef.current?.focus())
    }
  }

  return (
    <>
      <header className={`flex h-11 items-center bg-primary-background border-b border-foreground/6 px-4 justify-between ${className || ''}`}>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors duration-150"
              onClick={() => setChatCollapsed(!isChatCollapsed)}
              aria-label={isChatCollapsed ? "Show chat panel" : "Hide chat panel"}
              aria-pressed={!isChatCollapsed}
              title={isChatCollapsed ? "Show chat panel" : "Hide chat panel"}
            >
              {isChatCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Image src="/repolens.svg" alt="RepoLens" width={24} height={20} className="dark:invert" />
          <Link
            href="/compare"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
            className="relative h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5 transition-colors duration-150"
            onClick={(event) => {
              settingsOpenerRef.current = event.currentTarget
              setSettingsTab("github")
              setSettingsRequestId((requestId) => requestId + 1)
              setSettingsOpen(true)
            }}
            aria-label="Open API settings"
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
            <a href="https://github.com/zebbern/repolens/fork" target="_blank" rel="noopener noreferrer" aria-label="Fork RepoLens on GitHub">
              <GitFork className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-secondary hover:text-text-primary hover:bg-foreground/5"
            asChild
          >
            <a href="https://github.com/zebbern/repolens" target="_blank" rel="noopener noreferrer" aria-label="Open the RepoLens GitHub repository">
              <Github className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </header>

      <SettingsModal
        key={`${settingsTab}-${settingsRequestId}`}
        open={settingsOpen}
        onOpenChange={handleSettingsOpenChange}
        initialTab={settingsTab}
      />
    </>
  )
}
