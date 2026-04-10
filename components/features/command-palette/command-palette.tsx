"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Bug, FileText, Network, Code2, Package, History,
  GitCommitHorizontal, Route, Settings, Moon, Sun, Monitor,
  MessageSquare, Search, GitCompareArrows,
} from "lucide-react"
import { Github } from "@/components/icons/github"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command"

const NAVIGATION_ITEMS = [
  { id: "repo", label: "Repo Overview", icon: Github, keywords: ["home", "overview", "summary", "project"] },
  { id: "code", label: "Code Browser", icon: Code2, keywords: ["browse", "files", "source"] },
  { id: "issues", label: "Issues & Scanner", icon: Bug, keywords: ["bugs", "scan", "security", "quality"] },
  { id: "deps", label: "Dependencies", icon: Package, keywords: ["packages", "npm", "health"] },
  { id: "diagram", label: "Diagrams", icon: Network, keywords: ["architecture", "mermaid", "graph"] },
  { id: "docs", label: "Documentation", icon: FileText, keywords: ["readme", "generate"] },
  { id: "changelog", label: "Changelog", icon: History, keywords: ["changes", "release", "notes"] },
  { id: "git-history", label: "Git History", icon: GitCommitHorizontal, keywords: ["commits", "blame", "log"] },
  { id: "tours", label: "Tours", icon: Route, keywords: ["walkthrough", "guide"] },
] as const

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const runAndClose = useCallback((fn: () => void) => {
    fn()
    setOpen(false)
  }, [])

  const switchTab = useCallback((tabId: string) => {
    runAndClose(() => {
      window.dispatchEvent(new CustomEvent("switch-tab", { detail: { tab: tabId } }))
    })
  }, [runAndClose])

  const openSettings = useCallback(() => {
    runAndClose(() => {
      window.dispatchEvent(new Event("open-settings"))
    })
  }, [runAndClose])

  const openFileSearch = useCallback(() => {
    runAndClose(() => {
      window.dispatchEvent(new Event("open-file-search"))
    })
  }, [runAndClose])

  const cycleTheme = useCallback(() => {
    runAndClose(() => {
      const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
      document.documentElement.classList.add("theme-transition")
      setTheme(next)
      setTimeout(() => document.documentElement.classList.remove("theme-transition"), 250)
    })
  }, [runAndClose, theme, setTheme])

  const navigateCompare = useCallback(() => {
    runAndClose(() => router.push("/compare"))
  }, [runAndClose, router])

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAVIGATION_ITEMS.map(item => (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.keywords.join(" ")}`}
              onSelect={() => switchTab(item.id)}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="Search files code symbols" onSelect={openFileSearch}>
            <Search className="mr-2 h-4 w-4" />
            Search Files
            <CommandShortcut>Then ⌘K</CommandShortcut>
          </CommandItem>
          <CommandItem value="Open settings api keys preferences" onSelect={openSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Open Settings
          </CommandItem>
          <CommandItem
            value={`Toggle theme dark light system ${theme}`}
            onSelect={cycleTheme}
          >
            <ThemeIcon className="mr-2 h-4 w-4" />
            Toggle Theme
            <CommandShortcut>{theme}</CommandShortcut>
          </CommandItem>
          <CommandItem value="Compare repositories side by side" onSelect={navigateCompare}>
            <GitCompareArrows className="mr-2 h-4 w-4" />
            Compare Repos
          </CommandItem>
          <CommandItem
            value="Start new AI chat conversation"
            onSelect={() => runAndClose(() => {
              window.dispatchEvent(new Event("focus-chat-input"))
            })}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Focus Chat
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
