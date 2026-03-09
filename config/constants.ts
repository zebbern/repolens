// Layout constants
export const SIDEBAR_CONFIG = {
    MIN_WIDTH: 240,
    MAX_WIDTH: 500,
    DEFAULT_WIDTH: 320,
} as const

// Preview retry configuration
export const PREVIEW_RETRY_CONFIG = {
    MAX_RETRIES: 3,
    INITIAL_DELAY: 3000, // 3 seconds
    VERIFICATION_TIMEOUT: 5000, // 5 seconds
    VERIFICATION_RETRIES: 3,
    VERIFICATION_DELAY: 2000, // 2 seconds
} as const

// UI Constants
export const UI_CONFIG = {
    HEADER_HEIGHT: 48, // 12 * 4 = 48px
    ANIMATION_DURATION: 200,
    TEXTAREA_MIN_HEIGHT: 96, // 24 * 4 = 96px
} as const

// Pinned context configuration
export const PINNED_CONTEXT_CONFIG = {
  /** Maximum number of pin entries (files + directories count individually). */
  MAX_PINNED_FILES: 20,
  /** Maximum total byte size of assembled pinned content sent to the API. */
  MAX_PINNED_BYTES: 100_000, // 100 KB
  /** Maximum byte size of a single file to include. Files exceeding this are skipped with a warning. */
  MAX_SINGLE_FILE_BYTES: 50_000, // 50 KB
  /** Prefix header in the system prompt for pinned content. */
  SYSTEM_PROMPT_HEADER: '## Pinned Files (User-Selected Context)',
} as const

// Status types for file explorer
export const FILE_STATUS = {
    GENERATED: 'generated',
    MODIFIED: 'modified',
    UNCHANGED: 'unchanged',
} as const

/** Repo size threshold (KB) for using IDB-backed content store. ~50 MB */
export const IDB_CONTENT_STORE_THRESHOLD_KB = 50_000

/** Repo size threshold (KB) for lazy content loading (metadata-only indexing). ~200 MB */
export const LAZY_CONTENT_THRESHOLD_KB = 200_000
