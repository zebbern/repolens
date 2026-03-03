"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import type { AIProvider, APIKeysState, APIKeyConfig, ProviderModel, ProviderInfo, ModelResponseItem } from "@/types/types"

// Provider information
export const PROVIDERS: Record<AIProvider, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4, GPT-4o, GPT-3.5 Turbo',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
  },
  google: {
    id: 'google',
    name: 'Google',
    description: 'Gemini Pro, Gemini Flash',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AI',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5, Claude 3 Opus',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access multiple providers',
    docsUrl: 'https://openrouter.ai/keys',
    keyPrefix: 'sk-or-',
  },
}

const defaultKeyConfig: APIKeyConfig = {
  key: '',
  isValid: null,
  lastValidated: null,
}

const defaultAPIKeysState: APIKeysState = {
  openai: { ...defaultKeyConfig },
  google: { ...defaultKeyConfig },
  anthropic: { ...defaultKeyConfig },
  openrouter: { ...defaultKeyConfig },
}

interface APIKeysContextType {
  apiKeys: APIKeysState
  models: ProviderModel[]
  isLoadingModels: boolean
  selectedProvider: AIProvider | null
  selectedModel: ProviderModel | null
  setAPIKey: (provider: AIProvider, key: string) => void
  validateAPIKey: (provider: AIProvider) => Promise<boolean>
  removeAPIKey: (provider: AIProvider) => void
  fetchModels: (provider: AIProvider) => Promise<ProviderModel[]>
  setSelectedModel: (model: ProviderModel | null) => void
  getValidProviders: () => AIProvider[]
}

const APIKeysContext = createContext<APIKeysContextType | null>(null)

const STORAGE_KEY = 'codedoc-api-keys'

export function APIKeysProvider({ children }: { children: ReactNode }) {
  const [apiKeys, setAPIKeys] = useState<APIKeysState>(defaultAPIKeysState)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ProviderModel | null>(null)

  // Load keys from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setAPIKeys(parsed)
      } catch {
        // Invalid stored data, use defaults
      }
    }
  }, [])

  // Save keys to localStorage when changed
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apiKeys))
  }, [apiKeys])

  const setAPIKey = useCallback((provider: AIProvider, key: string) => {
    setAPIKeys(prev => ({
      ...prev,
      [provider]: {
        key,
        isValid: null,
        lastValidated: null,
      },
    }))
  }, [])

  const removeAPIKey = useCallback((provider: AIProvider) => {
    setAPIKeys(prev => ({
      ...prev,
      [provider]: { ...defaultKeyConfig },
    }))
    // Remove models from this provider
    setModels(prev => prev.filter(m => m.provider !== provider))
  }, [])

  const validateAPIKey = useCallback(async (provider: AIProvider): Promise<boolean> => {
    const key = apiKeys[provider].key
    if (!key) return false

    try {
      const response = await fetch(`/api/models/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })

      const data = await response.json()
      const isValid = response.ok && data.models?.length > 0

      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid,
          lastValidated: new Date(),
        },
      }))

      if (isValid && data.models) {
        // Add provider's models to the list
        const providerModels: ProviderModel[] = data.models.map((m: ModelResponseItem) => ({
          id: m.id,
          name: m.name || m.id,
          provider,
          contextLength: m.contextLength,
        }))
        
        setModels(prev => {
          // Remove old models from this provider and add new ones
          const filtered = prev.filter(m => m.provider !== provider)
          return [...filtered, ...providerModels]
        })
      }

      return isValid
    } catch {
      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: false,
          lastValidated: new Date(),
        },
      }))
      return false
    }
  }, [apiKeys])

  const fetchModels = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    const key = apiKeys[provider].key
    if (!key) return []

    setIsLoadingModels(true)
    try {
      const response = await fetch(`/api/models/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })

      if (!response.ok) return []

      const data = await response.json()
      const providerModels: ProviderModel[] = (data.models || []).map((m: ModelResponseItem) => ({
        id: m.id,
        name: m.name || m.id,
        provider,
        contextLength: m.contextLength,
      }))

      setModels(prev => {
        const filtered = prev.filter(m => m.provider !== provider)
        return [...filtered, ...providerModels]
      })

      return providerModels
    } catch {
      return []
    } finally {
      setIsLoadingModels(false)
    }
  }, [apiKeys])

  const getValidProviders = useCallback((): AIProvider[] => {
    return (Object.keys(apiKeys) as AIProvider[]).filter(
      provider => apiKeys[provider].isValid === true
    )
  }, [apiKeys])

  const selectedProvider = selectedModel?.provider || null

  return (
    <APIKeysContext.Provider
      value={{
        apiKeys,
        models,
        isLoadingModels,
        selectedProvider,
        selectedModel,
        setAPIKey,
        validateAPIKey,
        removeAPIKey,
        fetchModels,
        setSelectedModel,
        getValidProviders,
      }}
    >
      {children}
    </APIKeysContext.Provider>
  )
}

export function useAPIKeys() {
  const context = useContext(APIKeysContext)
  if (!context) {
    throw new Error('useAPIKeys must be used within an APIKeysProvider')
  }
  return context
}
