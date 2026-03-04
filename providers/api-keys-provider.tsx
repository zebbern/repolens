"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
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

/** Preferred default model ID substrings per provider. Uses `.includes()` matching. */
export const DEFAULT_MODELS: Partial<Record<AIProvider, string>> = {
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-pro',
}

/** Find the best default model for a provider from a list of available models. */
export function findDefaultModel(models: ProviderModel[], provider: AIProvider): ProviderModel | null {
  if (models.length === 0) return null

  const preferredSubstring = DEFAULT_MODELS[provider]
  if (preferredSubstring) {
    const preferred = models.find(m => m.id.includes(preferredSubstring))
    if (preferred) return preferred
  }

  return models[0]
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
  isHydrated: boolean
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
const MODEL_STORAGE_KEY = 'codedoc-selected-model'
const API_KEY_PROVIDERS: AIProvider[] = ['openai', 'google', 'anthropic', 'openrouter']

/** Validate that parsed localStorage data has the expected APIKeysState shape. */
function isValidAPIKeysState(data: unknown): data is APIKeysState {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return API_KEY_PROVIDERS.every(p => {
    const entry = obj[p]
    return entry && typeof entry === 'object' && 'key' in entry && typeof (entry as Record<string, unknown>).key === 'string'
  })
}

export function APIKeysProvider({ children }: { children: ReactNode }) {
  const [apiKeys, setAPIKeys] = useState<APIKeysState>(defaultAPIKeysState)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ProviderModel | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const selectedModelRef = useRef<ProviderModel | null>(null)

  // Ref to always have current apiKeys for internal use
  const apiKeysRef = useRef(apiKeys)
  useEffect(() => { apiKeysRef.current = apiKeys }, [apiKeys])

  // Keep ref in sync with state so callbacks can read current value without re-creation
  useEffect(() => { selectedModelRef.current = selectedModel }, [selectedModel])

  // Hydrate state from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (isValidAPIKeysState(parsed)) {
          setAPIKeys(parsed)
        } else {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }

    try {
      const storedModel = localStorage.getItem(MODEL_STORAGE_KEY)
      if (storedModel) {
        const parsed = JSON.parse(storedModel) as ProviderModel
        setSelectedModel(parsed)
        selectedModelRef.current = parsed
      }
    } catch {
      // Ignore invalid stored model
    }

    setIsHydrated(true)
  }, [])

  // Save keys to localStorage when changed (skip before hydration)
  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apiKeys))
  }, [apiKeys, isHydrated])

  // Persist selected model to localStorage
  useEffect(() => {
    if (!isHydrated) return
    if (selectedModel) {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(selectedModel))
    } else {
      localStorage.removeItem(MODEL_STORAGE_KEY)
    }
  }, [selectedModel, isHydrated])

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
    const key = apiKeysRef.current[provider].key
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

        // Auto-select a default model if none is currently selected
        if (!selectedModelRef.current) {
          const defaultModel = findDefaultModel(providerModels, provider)
          if (defaultModel) {
            selectedModelRef.current = defaultModel
            setSelectedModel(defaultModel)
          }
        }
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
  }, [])

  const fetchModelsInternal = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    const key = apiKeysRef.current[provider].key
    if (!key) return []

    try {
      const response = await fetch(`/api/models/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })

      if (!response.ok) {
        // Mark invalid on failure
        setAPIKeys(prev => ({
          ...prev,
          [provider]: {
            ...prev[provider],
            isValid: false,
            lastValidated: new Date(),
          },
        }))
        return []
      }

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

      // Mark valid
      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: true,
          lastValidated: new Date(),
        },
      }))

      // Auto-select a default model if none is currently selected
      if (!selectedModelRef.current) {
        const defaultModel = findDefaultModel(providerModels, provider)
        if (defaultModel) {
          selectedModelRef.current = defaultModel
          setSelectedModel(defaultModel)
        }
      }

      return providerModels
    } catch {
      // Mark invalid on failure
      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: false,
          lastValidated: new Date(),
        },
      }))
      return []
    }
  }, []) // No dependencies — reads from refs

  const fetchModels = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    setIsLoadingModels(true)
    try {
      return await fetchModelsInternal(provider)
    } finally {
      setIsLoadingModels(false)
    }
  }, [fetchModelsInternal])

  // Auto-fetch models once hydration is complete for providers with stored keys
  const hasAutoFetched = useRef(false)

  useEffect(() => {
    if (!isHydrated) return
    if (hasAutoFetched.current) return
    hasAutoFetched.current = true

    // Find all providers that have a stored key
    const providersWithKeys = (Object.keys(apiKeys) as AIProvider[]).filter(
      provider => apiKeys[provider]?.key?.length > 0
    )

    if (providersWithKeys.length === 0) return

    // Fetch models for all providers with keys in parallel
    const fetchAll = async () => {
      setIsLoadingModels(true)
      try {
        await Promise.all(providersWithKeys.map(provider => fetchModelsInternal(provider)))
      } finally {
        setIsLoadingModels(false)
      }
    }
    fetchAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]) // Runs once after hydration completes

  const getValidProviders = useCallback((): AIProvider[] => {
    return (Object.keys(apiKeys) as AIProvider[]).filter(
      provider => apiKeys[provider]?.isValid === true
    )
  }, [apiKeys])

  const selectedProvider = selectedModel?.provider || null

  return (
    <APIKeysContext.Provider
      value={{
        apiKeys,
        models,
        isLoadingModels,
        isHydrated,
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
