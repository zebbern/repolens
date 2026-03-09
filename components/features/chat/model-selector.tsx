import { Button } from '@/components/ui/button'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { BrainCircuit, ChevronDown, Check, Settings, AlertTriangle } from 'lucide-react'
import { useAPIKeys } from '@/providers'
import { PROVIDERS } from '@/providers/api-keys-provider'
import { cn } from '@/lib/utils'
import type { AIProvider } from '@/types/types'

interface ModelSelectorProps {
  className?: string
  onOpenSettings?: () => void
}

export function ModelSelector({ className, onOpenSettings }: ModelSelectorProps) {
  const { models, selectedModel, setSelectedModel, getValidProviders, modelFetchErrors } = useAPIKeys()
  
  const validProviders = getValidProviders()
  const hasModels = models.length > 0
  const hasErrors = Object.keys(modelFetchErrors).length > 0

  // Group models by provider
  const modelsByProvider = models.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = []
    }
    acc[model.provider].push(model)
    return acc
  }, {} as Record<AIProvider, typeof models>)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'flex items-center gap-2 text-xs text-text-secondary hover:bg-foreground/5',
            className
          )}
        >
          <BrainCircuit className={cn(
            "h-3.5 w-3.5 shrink-0",
            hasErrors ? "text-status-warning" : hasModels ? "text-status-success" : "text-text-muted"
          )} />
          {selectedModel ? selectedModel.name : "Select model"}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 bg-popover max-h-80 overflow-y-auto"
      >
        {!hasModels ? (
          <div className="p-3 text-center">
            <p className="text-sm text-text-secondary mb-2">No API keys configured</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (onOpenSettings) {
                  onOpenSettings()
                } else {
                  window.dispatchEvent(new CustomEvent("open-settings"))
                }
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <Settings className="h-4 w-4 mr-1" />
              Set up API keys &rarr;
            </Button>
          </div>
        ) : (
          <>
            {hasErrors && (
              <>
                {Object.entries(modelFetchErrors).map(([provider, error]) => (
                  <div key={provider} className="flex items-start gap-2 px-2 py-1.5 text-xs text-status-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                ))}
                {validProviders.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            {validProviders.map((provider, index) => {
            const providerModels = modelsByProvider[provider] || []
            if (providerModels.length === 0) return null
            
            return (
              <div key={provider}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-text-muted text-xs">
                  {PROVIDERS[provider].name}
                </DropdownMenuLabel>
                {providerModels.map((model) => (
                  <DropdownMenuItem 
                    key={model.id} 
                    onSelect={() => setSelectedModel(model)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="truncate">{model.name}</span>
                      {selectedModel?.id === model.id && <Check className="h-4 w-4 ml-2 shrink-0" />}
                    </div>
                  </DropdownMenuItem>
                ))}
              </div>
            )
          })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
