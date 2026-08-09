"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAPIKeys, PROVIDERS } from "@/providers/api-keys-provider"
import { useGitHubToken } from "@/providers/github-token-provider"
import type { AIProvider } from "@/types/types"
import { APIKeyInput } from "./api-key-input"
import { GitHubTokenInput } from "./github-token-input"

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: AIProvider | "github"
}

export function SettingsModal({ open, onOpenChange, initialTab = "github" }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<AIProvider | "github">(initialTab)
  const { apiKeys } = useAPIKeys()
  const { isValid: isGitHubValid } = useGitHubToken()

  const providers = Object.values(PROVIDERS)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-popover border-foreground/10">
        <DialogHeader>
          <DialogTitle className="text-text-primary">API Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure API keys and GitHub authentication
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AIProvider | "github")}>
          <TabsList className="grid w-full grid-cols-5 bg-foreground/5">
            <TabsTrigger
              value="github"
              className="relative data-[state=active]:bg-foreground/10 text-xs"
            >
              GitHub
              {isGitHubValid === true && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-status-success" aria-label="GitHub token configured" />
              )}
            </TabsTrigger>
            {providers.map((provider) => (
              <TabsTrigger
                key={provider.id}
                value={provider.id}
                className="relative data-[state=active]:bg-foreground/10 text-xs"
              >
                {provider.name}
                {apiKeys[provider.id].isValid === true && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-status-success" aria-label={`${provider.name} key configured`} />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="github" className="mt-4">
            <GitHubTokenInput />
          </TabsContent>

          {providers.map((provider) => (
            <TabsContent key={provider.id} value={provider.id} className="mt-4">
              <APIKeyInput provider={provider.id} />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
