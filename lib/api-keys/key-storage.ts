import type { AIProvider, APIKeysState, ProviderModel } from '@/types/types'
import { API_KEY_PROVIDERS, STORAGE_KEY, MODEL_STORAGE_KEY, DEFAULT_MODELS } from './constants'

/** Validate that parsed localStorage data has the expected APIKeysState shape. */
export function isValidAPIKeysState(data: unknown): data is APIKeysState {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return API_KEY_PROVIDERS.every(p => {
    const entry = obj[p]
    return entry && typeof entry === 'object' && 'key' in entry && typeof (entry as Record<string, unknown>).key === 'string'
  })
}

/** Load API keys from localStorage. Returns null if nothing is stored or invalid. */
export function loadKeys(): APIKeysState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (isValidAPIKeysState(parsed)) return parsed
    localStorage.removeItem(STORAGE_KEY)
    return null
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

/** Persist API keys to localStorage. */
export function saveKeys(keys: APIKeysState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
}

function isStoredProviderModel(value: unknown): value is ProviderModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Record<string, unknown>
  const contextLength = model.contextLength
  return typeof model.id === 'string'
    && model.id !== ''
    && typeof model.name === 'string'
    && model.name !== ''
    && API_KEY_PROVIDERS.includes(model.provider as AIProvider)
    && (contextLength === undefined || (typeof contextLength === 'number' && Number.isFinite(contextLength)))
}

/** Load a previously-selected model from localStorage. Returns null if absent/invalid. */
export function loadSelectedModel(): ProviderModel | null {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (isStoredProviderModel(parsed)) return parsed
    localStorage.removeItem(MODEL_STORAGE_KEY)
    return null
  } catch {
    localStorage.removeItem(MODEL_STORAGE_KEY)
    return null
  }
}

/** Persist the selected model to localStorage. */
export function saveSelectedModel(model: ProviderModel | null): void {
  if (model) {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model))
  } else {
    localStorage.removeItem(MODEL_STORAGE_KEY)
  }
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
