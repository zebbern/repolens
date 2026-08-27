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
  const providerRequestsRef = useRef(new Map<AIProvider, { generation: number; controller: AbortController; settled: boolean }>())
  const providerGenerationRef = useRef(new Map<AIProvider, number>())
  const loadingRequestsRef = useRef(0)

  const beginProviderRequest = useCallback((provider: AIProvider) => {
    const previous = providerRequestsRef.current.get(provider)
    if (previous) {
      previous.controller.abort()
      if (!previous.settled) {
        previous.settled = true
        loadingRequestsRef.current = Math.max(0, loadingRequestsRef.current - 1)
      }
    }
    const generation = (providerGenerationRef.current.get(provider) ?? 0) + 1
    providerGenerationRef.current.set(provider, generation)
    const request = { generation, controller: new AbortController(), settled: false }
    providerRequestsRef.current.set(provider, request)
    loadingRequestsRef.current += 1
    setIsLoadingModels(true)
    return request
  }, [])

  const endProviderRequest = useCallback((provider: AIProvider, request: { generation: number; controller: AbortController; settled: boolean }) => {
    if (request.settled) return
    request.settled = true
    if (providerRequestsRef.current.get(provider) === request) providerRequestsRef.current.delete(provider)
    loadingRequestsRef.current = Math.max(0, loadingRequestsRef.current - 1)
    if (loadingRequestsRef.current === 0) setIsLoadingModels(false)
  }, [])

  const isProviderRequestCurrent = useCallback((provider: AIProvider, key: string, request: { generation: number; controller: AbortController; settled: boolean }) => (
    providerRequestsRef.current.get(provider) === request
    && !request.settled
    && !request.controller.signal.aborted
    && apiKeysRef.current[provider].key === key
  ), [])

  const invalidateProviderRequest = useCallback((provider: AIProvider) => {
    const request = providerRequestsRef.current.get(provider)
    if (request) {
      request.controller.abort()
      if (!request.settled) {
        request.settled = true
        loadingRequestsRef.current = Math.max(0, loadingRequestsRef.current - 1)
        if (loadingRequestsRef.current === 0) setIsLoadingModels(false)
      }
    }
    providerRequestsRef.current.delete(provider)
  }, [])

  const discardProviderState = useCallback((provider: AIProvider, clearError = true) => {
    setModels(current => current.filter(model => model.provider !== provider))
    if (selectedModelRef.current?.provider === provider) {
      selectedModelRef.current = null
      setSelectedModel(null)
    }
    if (clearError) {
      setModelFetchErrors(current => {
        if (!(provider in current)) return current
        const next = { ...current }
        delete next[provider]
        return next
      })
    }
  }, [])

  const reconcileProviderSelection = useCallback((provider: AIProvider, providerModels: ProviderModel[]) => {
    const current = selectedModelRef.current
    if (current && current.provider !== provider) return

    const next = (current && providerModels.find(model => model.id === current.id))
      || findDefaultModel(providerModels, provider)
    if (next && next !== current) {
      selectedModelRef.current = next
      setSelectedModel(next)
    }
  }, [])

  useEffect(() => { apiKeysRef.current = apiKeys }, [apiKeys])

  // Keep ref in sync with state so callbacks can read current value without re-creation
  useEffect(() => { selectedModelRef.current = selectedModel }, [selectedModel])

  // Hydrate state from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const storedKeys = loadKeys()
    const storedModel = loadSelectedModel()
    queueMicrotask(() => {
      if (storedKeys) setAPIKeys(storedKeys)
      if (storedModel && storedKeys?.[storedModel.provider]?.key && storedKeys[storedModel.provider].isValid === true) {
        setSelectedModel(storedModel)
        selectedModelRef.current = storedModel
      } else if (storedModel) {
        saveSelectedModel(null)
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
    invalidateProviderRequest(provider)
    discardProviderState(provider)
    setAPIKeys(prev => {
      const next = {
        ...prev,
        [provider]: { key, isValid: null, lastValidated: null },
      }
      apiKeysRef.current = next
      return next
    })
  }, [discardProviderState, invalidateProviderRequest])

  const removeAPIKey = useCallback((provider: AIProvider) => {
    invalidateProviderRequest(provider)
    discardProviderState(provider)
    setAPIKeys(prev => {
      const next = { ...prev, [provider]: { ...DEFAULT_KEY_CONFIG } }
      apiKeysRef.current = next
      return next
    })
  }, [discardProviderState, invalidateProviderRequest])

  const validateAPIKey = useCallback(async (provider: AIProvider): Promise<boolean> => {
    const key = apiKeysRef.current[provider].key
    if (!key) return false
    const request = beginProviderRequest(provider)

    try {
      const { models: providerModels, isValid } = await fetchProviderModels(provider, key, {
        signal: request.controller.signal,
      })
      if (!isProviderRequestCurrent(provider, key, request)) return false

      if (!isValid) {
        const errorMsg = `Failed to validate ${PROVIDERS[provider].name} API key — check your key and try again`
        discardProviderState(provider, false)
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
        return false
      }

      setAPIKeys(prev => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isValid: true,
          lastValidated: new Date(),
        },
      }))

      if (providerModels.length > 0) {
        setModels(prev => {
          const filtered = prev.filter(m => m.provider !== provider)
          return [...filtered, ...providerModels]
        })

        reconcileProviderSelection(provider, providerModels)
      } else {
        discardProviderState(provider, false)
      }
      setModelFetchErrors(prev => {
        if (!(provider in prev)) return prev
        const next = { ...prev }
        delete next[provider]
        return next
      })

      return true
    } catch {
      if (!isProviderRequestCurrent(provider, key, request)) return false
      const errorMsg = `Failed to validate ${PROVIDERS[provider].name} API key — try again`
      setModelFetchErrors(prev => ({ ...prev, [provider]: errorMsg }))
      toast.error(errorMsg)
      return false
    } finally {
      endProviderRequest(provider, request)
    }
  }, [beginProviderRequest, discardProviderState, endProviderRequest, isProviderRequestCurrent, reconcileProviderSelection])

  const fetchModelsInternal = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    const key = apiKeysRef.current[provider].key
    if (!key) return []
    const request = beginProviderRequest(provider)

    try {
      const { models: providerModels, isValid } = await fetchProviderModels(provider, key, {
        signal: request.controller.signal,
      })
      if (!isProviderRequestCurrent(provider, key, request)) return []

      if (!isValid) {
        const errorMsg = `Failed to load ${PROVIDERS[provider].name} models — check your API key`
        discardProviderState(provider, false)
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

      if (providerModels.length > 0) {
        setModels(prev => {
          const filtered = prev.filter(m => m.provider !== provider)
          return [...filtered, ...providerModels]
        })
      } else {
        discardProviderState(provider, false)
      }

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

      if (providerModels.length > 0) {
        reconcileProviderSelection(provider, providerModels)
      }

      return providerModels
    } catch {
      if (!isProviderRequestCurrent(provider, key, request)) return []
      const errorMsg = `Failed to load ${PROVIDERS[provider].name} models — try again`
      setModelFetchErrors(prev => ({ ...prev, [provider]: errorMsg }))
      toast.error(errorMsg)
      return []
    } finally {
      endProviderRequest(provider, request)
    }
  }, [beginProviderRequest, discardProviderState, endProviderRequest, isProviderRequestCurrent, reconcileProviderSelection])

  const fetchModels = useCallback(async (provider: AIProvider): Promise<ProviderModel[]> => {
    return fetchModelsInternal(provider)
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
      await Promise.all(providersWithKeys.map(provider => fetchModelsInternal(provider)))
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
