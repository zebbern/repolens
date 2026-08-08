"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { toast } from "sonner"
import type { AIProvider, APIKeysState, ProviderModel } from "@/types/types"
import {
  PROVIDERS,
  DEFAULT_KEY_CONFIG,
  DEFAULT_API_KEYS_STATE,
  loadKeys,
  saveKeys,
  loadSelectedModel,
  saveSelectedModel,
  findDefaultModel,
  fetchProviderModels,
} from '@/lib/api-keys'

// Re-export for backward compatibility
export { PROVIDERS, findDefaultModel, DEFAULT_MODELS } from '@/lib/api-keys'

interface APIKeysContextType {
  apiKeys: APIKeysState
  models: ProviderModel[]
  isLoadingModels: boolean
  isHydrated: boolean
  selectedProvider: AIProvider | null
  selectedModel: ProviderModel | null
  modelFetchErrors: Partial<Record<AIProvider, string>>
  setAPIKey: (provider: AIProvider, key: string) => void
  validateAPIKey: (provider: AIProvider) => Promise<boolean>
  removeAPIKey: (provider: AIProvider) => void
  fetchModels: (provider: AIProvider) => Promise<ProviderModel[]>
  setSelectedModel: (model: ProviderModel | null) => void
  getValidProviders: () => AIProvider[]
}

const APIKeysContext = createContext<APIKeysContextType | null>(null)

export function APIKeysProvider({ children }: { children: ReactNode }) {
  const [apiKeys, setAPIKeys] = useState<APIKeysState>(DEFAULT_API_KEYS_STATE)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ProviderModel | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [modelFetchErrors, setModelFetchErrors] = useState<Partial<Record<AIProvider, string>>>({})
  const selectedModelRef = useRef<ProviderModel | null>(null)

  // Ref to always have current apiKeys for internal use
  const apiKeysRef = useRef(apiKeys)
  useEffect(() => { apiKeysRef.current = apiKeys }, [apiKeys])

  // Keep ref in sync with state so callbacks can read current value without re-creation
  useEffect(() => { selectedModelRef.current = selectedModel }, [selectedModel])

  // Hydrate state from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const storedKeys = loadKeys()
    const storedModel = loadSelectedModel()
    queueMicrotask(() => {
      if (storedKeys) setAPIKeys(storedKeys)
      if (storedModel) {
        setSelectedModel(storedModel)
        selectedModelRef.current = storedModel
      }
      setIsHydrated(true)
    })
  }, [])

  // Save keys to localStorage when changed (skip before hydration)
  useEffect(() => {
    if (!isHydrated) return
    saveKeys(apiKeys)
  }, [apiKeys, isHydrated])

  // Persist selected model to localStorage
  useEffect(() => {
    if (!isHydrated) return
    saveSelectedModel(selectedModel)
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
      [provider]: { ...DEFAULT_KEY_CONFIG },
    }))
    // Remove models from this provider
    setModels(prev => prev.filter(m => m.provider !== provider))
  }, [])

  const validateAPIKey = useCallback(async (provider: AIProvider): Promise<boolean> => {
    const key = apiKeysRef.current[provider].key
    if (!key) return false

    try {
      const { models: providerModels, isValid } = await fetchProviderModels(provider, key)

      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid,
          lastValidated: new Date(),
        },
      }))

      if (isValid && providerModels.length > 0) {
        setModels(prev => {
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
      toast.error(`Failed to validate ${PROVIDERS[provider].name} API key — check your key and try again`)
      return false
    }
  }, [])

  const fetchModelsInternal = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    const key = apiKeysRef.current[provider].key
    if (!key) return []

    try {
      const { models: providerModels, isValid } = await fetchProviderModels(provider, key)

      if (!isValid) {
        const errorMsg = `Failed to load ${PROVIDERS[provider].name} models — check your API key`
        setAPIKeys(prev => ({
          ...prev,
          [provider]: {
            ...prev[provider],
            isValid: false,
            lastValidated: new Date(),
          },
        }))
        setModelFetchErrors(prev => ({ ...prev, [provider]: errorMsg }))
        toast.error(errorMsg)
        return []
      }

      setModels(prev => {
        const filtered = prev.filter(m => m.provider !== provider)
        return [...filtered, ...providerModels]
      })

      // Mark valid and clear any previous fetch error
      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: true,
          lastValidated: new Date(),
        },
      }))
      setModelFetchErrors(prev => {
        const next = { ...prev }
        delete next[provider]
        return next
      })

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
      const errorMsg = `Failed to load ${PROVIDERS[provider].name} models — check your API key`
      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: false,
          lastValidated: new Date(),
        },
      }))
      setModelFetchErrors(prev => ({ ...prev, [provider]: errorMsg }))
      toast.error(errorMsg)
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
  }, [isHydrated, apiKeys, fetchModelsInternal])

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
        modelFetchErrors,
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
  if (context === null) {
    throw new Error('useAPIKeys must be used within an APIKeysProvider')
  }
  return context
}
