import { z } from 'zod'

// Shared API route schemas
export const apiKeyRequestSchema = z.object({
  apiKey: z.string().min(1).max(500),
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

// Pinned file types for chat context pinning
export interface PinnedFile {
  /** Absolute path within the repository (e.g. "src/lib/utils.ts"). */
  path: string
  /** Whether the user pinned a file directly or a directory (resolved at content-assembly time). */
  type: 'file' | 'directory'
}

export interface PinnedContentsResult {
  /** Formatted content string for system prompt injection. */
  content: string
  /** Number of files successfully included. */
  fileCount: number
  /** Total byte size of assembled content. */
  totalBytes: number
  /** Paths of files excluded due to size limits. */
  skipped: string[]
}

// UI Component types
export interface ResizableLayoutProps {
    defaultSidebarWidth?: number
    minSidebarWidth?: number
    maxSidebarWidth?: number
}
