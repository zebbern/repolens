import { z } from 'zod'

// Shared API route schemas
export const apiKeyRequestSchema = z.object({
  apiKey: z.string().min(1),
})

export type ApiKeyRequest = z.infer<typeof apiKeyRequestSchema>

// API Provider types
export type AIProvider = 'openai' | 'google' | 'anthropic' | 'openrouter'

export interface APIKeyConfig {
  key: string
  isValid: boolean | null
  lastValidated: Date | null
}

export interface APIKeysState {
  openai: APIKeyConfig
  google: APIKeyConfig
  anthropic: APIKeyConfig
  openrouter: APIKeyConfig
}

export interface ProviderModel {
  id: string
  name: string
  provider: AIProvider
  contextLength?: number
}

export interface ProviderInfo {
  id: AIProvider
  name: string
  description: string
  docsUrl: string
  keyPrefix: string
}

// API model response types (from /api/models/{provider})
export interface ModelResponseItem {
  id: string
  name?: string
  contextLength?: number
}

// UI Component types
export interface ResizableLayoutProps {
    defaultSidebarWidth?: number
    minSidebarWidth?: number
    maxSidebarWidth?: number
}

