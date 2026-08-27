import { describe, it, expect, beforeEach } from 'vitest'
import type { AIProvider, APIKeysState, ProviderModel } from '@/types/types'
import {
  isValidAPIKeysState,
  loadKeys,
  saveKeys,
  loadSelectedModel,
  saveSelectedModel,
  findDefaultModel,
} from '../key-storage'
import { STORAGE_KEY, MODEL_STORAGE_KEY, DEFAULT_API_KEYS_STATE } from '../constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidKeysState(overrides: Partial<APIKeysState> = {}): APIKeysState {
  return { ...DEFAULT_API_KEYS_STATE, ...overrides }
}

function model(id: string, provider: AIProvider, name?: string): ProviderModel {
  return { id, name: name ?? id, provider }
}

// ---------------------------------------------------------------------------
// isValidAPIKeysState
// ---------------------------------------------------------------------------

describe('isValidAPIKeysState', () => {
  it('returns true for a valid APIKeysState', () => {
    const state = makeValidKeysState()
    expect(isValidAPIKeysState(state)).toBe(true)
  })

  it('returns true when keys have non-empty values', () => {
    const state = makeValidKeysState({
      openai: { key: 'sk-abc', isValid: true, lastValidated: null },
    })
    expect(isValidAPIKeysState(state)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isValidAPIKeysState(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidAPIKeysState(undefined)).toBe(false)
  })

  it('returns false for a non-object value', () => {
    expect(isValidAPIKeysState('string')).toBe(false)
    expect(isValidAPIKeysState(42)).toBe(false)
    expect(isValidAPIKeysState(true)).toBe(false)
  })

  it('returns false when a provider entry is missing', () => {
    const partial = { openai: { key: '' }, google: { key: '' } }
    expect(isValidAPIKeysState(partial)).toBe(false)
  })

  it('returns false when a provider entry has no key property', () => {
    const state = {
      openai: { key: '' },
      google: { notKey: '' },
      anthropic: { key: '' },
      openrouter: { key: '' },
    }
    expect(isValidAPIKeysState(state)).toBe(false)
  })

  it('returns false when a provider entry key is not a string', () => {
    const state = {
      openai: { key: '' },
      google: { key: 123 },
      anthropic: { key: '' },
      openrouter: { key: '' },
    }
    expect(isValidAPIKeysState(state)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// loadKeys
// ---------------------------------------------------------------------------

describe('loadKeys', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(loadKeys()).toBeNull()
  })

  it('returns parsed keys when valid data is stored', () => {
    const state = makeValidKeysState({
      openai: { key: 'sk-test', isValid: true, lastValidated: null },
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const loaded = loadKeys()
    expect(loaded).not.toBeNull()
    expect(loaded!.openai.key).toBe('sk-test')
  })

  it('returns null and removes storage when data is invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{bad json')
    expect(loadKeys()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('returns null and removes storage when data fails validation', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ incomplete: true }))
    expect(loadKeys()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// saveKeys
// ---------------------------------------------------------------------------

describe('saveKeys', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists keys to localStorage', () => {
    const state = makeValidKeysState()
    saveKeys(state)
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toEqual(state)
  })

  it('overwrites existing keys', () => {
    const first = makeValidKeysState()
    saveKeys(first)

    const second = makeValidKeysState({
      anthropic: { key: 'sk-ant-xyz', isValid: true, lastValidated: null },
    })
    saveKeys(second)

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.anthropic.key).toBe('sk-ant-xyz')
  })
})

// ---------------------------------------------------------------------------
// loadSelectedModel
// ---------------------------------------------------------------------------

describe('loadSelectedModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(loadSelectedModel()).toBeNull()
  })

  it('returns the stored model', () => {
    const m: ProviderModel = { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(m))
    const loaded = loadSelectedModel()
    expect(loaded).toEqual(m)
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem(MODEL_STORAGE_KEY, 'not-json')
    expect(loadSelectedModel()).toBeNull()
  })

  it.each([
    null,
    {},
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'unknown' },
    { id: 42, name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o', name: null, provider: 'openai' },
  ])('rejects and removes malformed stored model data: %j', value => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(value))

    expect(loadSelectedModel()).toBeNull()
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// saveSelectedModel
// ---------------------------------------------------------------------------

describe('saveSelectedModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves the model to localStorage', () => {
    const m: ProviderModel = { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
    saveSelectedModel(m)
    expect(JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY)!)).toEqual(m)
  })

  it('removes the model key when null is passed', () => {
    localStorage.setItem(MODEL_STORAGE_KEY, 'something')
    saveSelectedModel(null)
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findDefaultModel
// ---------------------------------------------------------------------------

describe('findDefaultModel', () => {
  it('returns null for an empty list', () => {
    expect(findDefaultModel([], 'openai')).toBeNull()
  })

  it('returns the preferred model for anthropic', () => {
    const models = [
      model('claude-3-opus', 'anthropic'),
      model('claude-sonnet-4-6-20250514', 'anthropic'),
    ]
    const result = findDefaultModel(models, 'anthropic')
    expect(result!.id).toBe('claude-sonnet-4-6-20250514')
  })

  it('returns the preferred model for google', () => {
    const models = [
      model('gemini-1.5-flash', 'google'),
      model('gemini-2.5-pro-preview', 'google'),
    ]
    const result = findDefaultModel(models, 'google')
    expect(result!.id).toBe('gemini-2.5-pro-preview')
  })

  it('falls back to the first model when no preferred match exists', () => {
    const models = [
      model('some-model-a', 'openai'),
      model('some-model-b', 'openai'),
    ]
    const result = findDefaultModel(models, 'openai')
    expect(result!.id).toBe('some-model-a')
  })

  it('falls back to the first model for providers without preferred defaults', () => {
    const models = [model('or-model-1', 'openrouter'), model('or-model-2', 'openrouter')]
    const result = findDefaultModel(models, 'openrouter')
    expect(result!.id).toBe('or-model-1')
  })
})
