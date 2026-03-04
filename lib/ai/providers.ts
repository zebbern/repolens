import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'

export type AIProvider = 'openai' | 'google' | 'anthropic' | 'openrouter'

/**
 * Create a provider-specific AI model instance.
 * Centralises the switch logic shared by chat and docs routes.
 */
export function createAIModel(provider: AIProvider, model: string, apiKey: string) {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model)
    case 'anthropic':
      return createAnthropic({ apiKey })(model)
    case 'openrouter':
      return createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })(model)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/** Known model context windows (tokens). Used for scaling structural index size. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o3-mini': 200_000,
  // Anthropic
  'claude-sonnet-4': 200_000,
  'claude-3-7-sonnet': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  // Google
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
}

/**
 * Get the context window size for a model. Fuzzy-matches against known models.
 * Defaults to 128_000 for unknown models.
 */
export function getModelContextWindow(model: string): number {
  // Direct match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]
  // Fuzzy match: check if model contains a known key (longest key first to avoid partial matches)
  const sorted = Object.entries(MODEL_CONTEXT_WINDOWS).sort((a, b) => b[0].length - a[0].length)
  for (const [key, tokens] of sorted) {
    if (model.includes(key)) return tokens
  }
  return 128_000 // safe default
}

/**
 * Calculate optimal structural index size based on model context window.
 * Allocates 15% of context for models ≤200K tokens and 10% for larger models, capped at 1MB.
 *
 * Intended for client-side callers that build the structural index before
 * sending it to the server. The server receives the already-built index
 * and cannot resize it.
 */
export function getMaxIndexBytesForModel(model: string): number {
  const contextTokens = getModelContextWindow(model)
  // Use 15% of context for models ≤200K, 10% for larger models
  const percentage = contextTokens <= 200_000 ? 0.15 : 0.10
  const targetBytes = Math.floor(contextTokens * 4 * percentage)
  return Math.min(targetBytes, 1_000_000) // cap at 1MB
}
