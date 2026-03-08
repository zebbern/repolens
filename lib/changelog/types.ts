import type { UIMessage } from 'ai'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The built-in changelog format types available as generation presets. */
export type ChangelogType = 'conventional' | 'release-notes' | 'keep-a-changelog' | 'custom'

/**
 * A changelog generation preset.
 *
 * Each preset defines the label, description, and prompt template used to
 * instruct the AI.  Icons are intentionally `null` here — the UI layer maps
 * `id → icon` at render time (matching {@link DocPreset} pattern).
 */
export interface ChangelogPreset {
  /** Unique identifier matching a {@link ChangelogType}. */
  id: ChangelogType
  /** Human-readable name shown in the preset picker. */
  label: string
  /** Short explanation of what this preset generates. */
  description: string
  /** React icon element — always `null` in config; mapped in UI layer. */
  icon: null
  /**
   * Prompt template sent to the AI.  Empty for `custom` (user-provided).
   */
  prompt: string
}

/**
 * A completed (or in-progress) changelog generation result.
 *
 * Stored in the ChangelogProvider state and displayed in the changelog
 * viewer's history sidebar.
 */
export interface GeneratedChangelog {
  /** Unique ID, typically `changelog-{timestamp}`. */
  id: string
  /** Which preset was used to generate this changelog. */
  type: ChangelogType
  /** Display title derived from the preset label or custom prompt. */
  title: string
  /** Full chat message history from the generation session. */
  messages: UIMessage[]
  /** When the generation was initiated. */
  createdAt: Date
  /** Start ref (tag, branch, or SHA) of the range. */
  fromRef?: string
  /** End ref (tag, branch, or SHA) of the range. */
  toRef?: string
  /** User-provided prompt if this was a custom generation. */
  customPrompt?: string
  /** Cached commit data from the original generation (re-used on regenerate). */
  commitData?: string
  /** Max tool-call steps used for this generation. */
  maxSteps?: number
  /** Whether context compaction was enabled. */
  compactionEnabled?: boolean
  /** Active skill IDs used during generation. */
  activeSkills?: string[]
}

/**
 * Generation context snapshot shared between the provider and hook.
 *
 * Captured at the start of a generation so completion handlers can access
 * the original parameters even after React state has changed.
 */
export interface ChangelogGenContext {
  /** Which preset type is being generated. */
  changelogType: ChangelogType
  /** Start ref (tag, branch, or SHA) of the range. */
  fromRef: string
  /** End ref (tag, branch, or SHA) of the range. */
  toRef: string
  /** User-provided prompt text for custom generations. */
  customPrompt: string
  /** Stringified summary of commits for the AI to process. */
  commitData?: string
  /** Max tool-call steps allowed. */
  maxSteps?: number
  /** Whether context compaction is enabled for this generation. */
  compactionEnabled?: boolean
  /** Active skill IDs to include in the generation request. */
  activeSkills?: string[]
}
