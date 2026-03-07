import type { AIProvider, ProviderInfo, APIKeysState, APIKeyConfig } from '@/types/types'

/** Provider information for all supported AI providers. */
export const PROVIDERS: Record<AIProvider, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5.4',
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
    description: 'Claude 4.6 Sonnet, Claude 4.6 Opus',
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

export const STORAGE_KEY = 'codedoc-api-keys'
export const MODEL_STORAGE_KEY = 'codedoc-selected-model'
export const API_KEY_PROVIDERS: AIProvider[] = ['openai', 'google', 'anthropic', 'openrouter']

export const DEFAULT_KEY_CONFIG: APIKeyConfig = {
  key: '',
  isValid: null,
  lastValidated: null,
}

export const DEFAULT_API_KEYS_STATE: APIKeysState = {
  openai: { ...DEFAULT_KEY_CONFIG },
  google: { ...DEFAULT_KEY_CONFIG },
  anthropic: { ...DEFAULT_KEY_CONFIG },
  openrouter: { ...DEFAULT_KEY_CONFIG },
}
