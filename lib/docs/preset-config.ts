import type { ReactNode } from 'react'
import type { UIMessage } from 'ai'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The built-in documentation types available as generation presets. */
export type DocType = 'architecture' | 'setup' | 'api-reference' | 'file-explanation' | 'onboarding' | 'custom'

/**
 * A documentation generation preset.
 *
 * Each preset defines the label, description, and prompt template used to
 * instruct the AI.  Icons are intentionally `null` here — the UI layer maps
 * `id → icon` at render time via `DOC_PRESET_ICONS` in DocViewer.
 */
export interface DocPreset {
  /** Unique identifier matching a {@link DocType}. */
  id: DocType
  /** Human-readable name shown in the preset picker. */
  label: string
  /** Short explanation of what this preset generates. */
  description: string
  /** React icon element — always `null` in config; mapped in UI layer. */
  icon: ReactNode
  /**
   * Prompt template sent to the AI.  Empty for `file-explanation` (built
   * dynamically from the target file) and `custom` (user-provided).
   */
  prompt: string
}

/**
 * A completed (or in-progress) documentation generation result.
 *
 * Stored in the `DocsProvider` state array and displayed in DocViewer's
 * history sidebar.
 */
export interface GeneratedDoc {
  /** Unique ID, typically `doc-{timestamp}`. */
  id: string
  /** Which preset was used to generate this doc. */
  type: DocType
  /** Display title derived from the preset label or custom prompt. */
  title: string
  /** Full chat message history from the generation session. */
  messages: UIMessage[]
  /** When the generation was initiated. */
  createdAt: Date
  /** File path if this was a file-explanation generation. */
  targetFile?: string
  /** User-provided prompt if this was a custom generation. */
  customPrompt?: string
  /** Max tool-call steps used during generation. */
  maxSteps?: number
  /** Active skill IDs used during generation. */
  activeSkills?: string[]
}

/**
 * Generation context snapshot shared between the provider and hook.
 *
 * Captured at the start of a generation so completion handlers can access
 * the original parameters even after React state has changed.
 */
export interface GenContext {
  /** Which preset type is being generated. */
  docType: DocType
  /** Target file path for file-explanation, or `null`. */
  targetFile: string | null
  /** User-provided prompt text for custom generations. */
  customPrompt: string
  /** Max tool-call steps allowed. */
  maxSteps?: number
  /** Active skill IDs to include in the generation request. */
  activeSkills?: string[]
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Built-in documentation generation presets.
 *
 * Each entry provides a prompt template for a common documentation task.
 * Icons are `null` here — the UI layer maps preset IDs to icons at render
 * time via `DOC_PRESET_ICONS` in `doc-viewer.tsx`.
 *
 * To add a new preset:
 * 1. Add the new `DocType` union member above.
 * 2. Add a new entry here with `id`, `label`, `description`, and `prompt`.
 * 3. Add an icon mapping in `DOC_PRESET_ICONS` in `doc-viewer.tsx`.
 */
export const DOC_PRESETS: DocPreset[] = [
  {
    id: 'architecture',
    label: 'Architecture Overview',
    description: 'How the project is structured, modules, data flow, and design decisions',
    icon: null,
    prompt:
      'Generate a comprehensive architecture overview for this codebase. Cover the high-level structure, key modules, data flow, and notable design decisions.',
  },
  {
    id: 'setup',
    label: 'Setup / Getting Started',
    description: 'Installation, configuration, and how to run the project locally',
    icon: null,
    prompt:
      'Generate a Getting Started guide for this project. Include prerequisites, installation steps, configuration (env vars, etc.), and how to run it locally.',
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    description: 'Exported functions, classes, types, and interfaces with signatures',
    icon: null,
    prompt:
      'Generate an API reference documenting all significant exported functions, classes, types, and interfaces. Include type signatures, parameter descriptions, and usage examples.',
  },
  {
    id: 'file-explanation',
    label: 'Explain a File',
    description: 'Deep explanation of a specific file -- purpose, logic, and how it fits',
    icon: null,
    prompt: '', // set dynamically based on selected file
  },
  {
    id: 'onboarding',
    label: 'AI Onboarding Prompt',
    description: 'Generate a comprehensive AGENTS.md-style context document that lets any AI agent hit the ground running',
    icon: null,
    prompt:
      'Generate a comprehensive AI onboarding context document for this codebase. Perform exhaustive multi-phase analysis using tools — read entry points, configs, core modules, type definitions, test files, and shared abstractions. Fill out every section of the template with specific, grounded, actionable information. This document will be used by AI coding agents who have never seen this project before.',
  },
  {
    id: 'custom',
    label: 'Custom Prompt',
    description: 'Ask the AI to generate any docs you need',
    icon: null,
    prompt: '',
  },
]
