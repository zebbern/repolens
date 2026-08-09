"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAPIKeys, PROVIDERS } from "@/providers/api-keys-provider"
import type { AIProvider } from "@/types/types"
import { Eye, EyeOff, ExternalLink, Check, X, Loader2, Trash2 } from "lucide-react"

interface APIKeyInputProps {
  provider: AIProvider
}

export function APIKeyInput({ provider }: APIKeyInputProps) {
  const { apiKeys, models, setAPIKey, validateAPIKey, removeAPIKey } = useAPIKeys()
  const [showKey, setShowKey] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  
  const config = apiKeys[provider]
  const providerInfo = PROVIDERS[provider]
  const providerModels = models.filter(m => m.provider === provider)

  const handleValidate = async () => {
    if (!config.key) return
    setIsValidating(true)
    await validateAPIKey(provider)
    setIsValidating(false)
  }

  const handleRemove = () => {
    removeAPIKey(provider)
  }

  const getStatusIcon = () => {
    if (isValidating) return <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
    if (config.isValid === true) return <Check className="h-4 w-4 text-status-success" />
    if (config.isValid === false) return <X className="h-4 w-4 text-status-error" />
    return null
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${provider}-key`} className="text-text-secondary">
            API Key
          </Label>
          <a
            href={providerInfo.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
          >
            Get API key
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={`${provider}-key`}
              type={showKey ? "text" : "password"}
              value={config.key}
              onChange={(e) => setAPIKey(provider, e.target.value)}
              placeholder={`Enter your ${providerInfo.name} API key`}
              className="pr-10 bg-foreground/5 border-foreground/10 text-text-primary placeholder:text-text-muted"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-text-muted hover:text-text-secondary"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? `Hide ${providerInfo.name} API key` : `Show ${providerInfo.name} API key`}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          
          <Button
            onClick={handleValidate}
            disabled={!config.key || isValidating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isValidating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Test"
            )}
          </Button>
        </div>
      </div>

      {/* Status */}
      {config.key && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm text-text-secondary">
              {isValidating && "Validating..."}
              {!isValidating && config.isValid === true && "Connected"}
              {!isValidating && config.isValid === false && "Invalid key"}
              {!isValidating && config.isValid === null && "Not tested"}
            </span>
          </div>
          
          {config.key && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              className="text-text-muted hover:text-status-error"
              aria-label={`Remove ${providerInfo.name} API key`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Available Models */}
      {config.isValid && providerModels.length > 0 && (
        <div className="space-y-2">
          <Label className="text-text-secondary">Available Models</Label>
          <div className="max-h-40 overflow-y-auto rounded-md border border-foreground/10 bg-foreground/5 p-2">
            <div className="space-y-1">
              {providerModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between rounded px-2 py-1 text-sm"
                >
                  <span className="text-text-primary">{model.name}</span>
                  {model.contextLength && (
                    <span className="text-xs text-text-muted">
                      {Math.round(model.contextLength / 1000)}k
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Provider Description */}
      <p className="text-xs text-text-muted">
        {providerInfo.description}
      </p>
      <p className="text-xs text-text-muted">
        Your key is stored in this browser. For AI features, the key, your prompt, selected repository context, and local tool results are sent through the RepoLens server to the selected AI provider.
      </p>
    </div>
  )
}
