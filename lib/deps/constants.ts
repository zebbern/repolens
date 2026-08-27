/** Maximum number of dependency records accepted by one RepoLens API request. */
export const MAX_DEPENDENCY_API_BATCH = 20

/** Maximum dependency records one client may enrich during a one-minute window. */
export const MAX_DEPENDENCY_PACKAGES_PER_WINDOW = 60

/** Early request-rate ceiling, separate from the weighted upstream-query budget. */
export const MAX_DEPENDENCY_REQUESTS_PER_WINDOW = 30

/** Dependency request bodies are small even at the maximum valid batch size. */
export const MAX_DEPENDENCY_REQUEST_BODY_BYTES = 32 * 1024

/** Per-upstream response ceilings for npm endpoints that return bodies. */
export const MAX_NPM_METADATA_RESPONSE_BYTES = 256 * 1024
export const MAX_NPM_DOWNLOADS_RESPONSE_BYTES = 64 * 1024

/** npm's range/last-month endpoint should return at most one point per day. */
export const MAX_NPM_DOWNLOAD_POINTS = 31
export const MAX_NPM_METADATA_STRING_CHARS = 2_000
export const MAX_NPM_VERSION_STRING_CHARS = 256
export const MAX_NPM_DOWNLOAD_DAY_STRING_CHARS = 32
export const MAX_NPM_DOWNLOAD_COUNT = 1_000_000_000_000
export const MAX_NPM_WEEKLY_DOWNLOADS = MAX_NPM_DOWNLOAD_COUNT * 7
