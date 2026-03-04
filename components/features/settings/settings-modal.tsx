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
import type { AIProvider } from "@/types/types"
import { APIKeyInput } from "./api-key-input"

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<AIProvider>("openai")
  const { apiKeys } = useAPIKeys()

  const providers = Object.values(PROVIDERS)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-popover border-foreground/10">
        <DialogHeader>
          <DialogTitle className="text-text-primary">API Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure API keys for AI providers
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AIProvider)}>
          <TabsList className="grid w-full grid-cols-4 bg-foreground/5">
            {providers.map((provider) => (
              <TabsTrigger
                key={provider.id}
                value={provider.id}
                className="relative data-[state=active]:bg-foreground/10 text-xs"
              >
                {provider.name}
                {apiKeys[provider.id].isValid === true && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-status-success" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

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
