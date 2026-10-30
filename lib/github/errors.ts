// Typed GitHub errors shared by the server fetchers, the /api/github routes and
// the browser client (proxy and PAT direct mode). Isomorphic: no next/server.
//
// `message` is always self-written text from the table below. GitHub's own
// text is kept in `upstreamMessage`, which is only ever logged server-side.

export const GITHUB_ERROR_KINDS = [
  'not_found',
  'unauthorized',
  'forbidden',
  'rate_limited',
  'invalid',
  'timeout',
  'upstream',
] as const
export type GitHubErrorKind = typeof GITHUB_ERROR_KINDS[number]

/** What was being fetched; selects the message for each kind. */
export type GitHubResource =
  | 'repository'
  | 'tree'
  | 'file'
  | 'tags'
  | 'branches'
  | 'commits'
  | 'comparison'
  | 'commit'
  | 'blame'
  | 'pulls'
  | 'pull_request'
  | 'pull_request_files'
  | 'github'

export interface GitHubErrorTarget {
  resource: GitHubResource
  /** A request identifier echoed in some not-found messages: commit SHA, PR number or file path. */
  subject?: string
}

// ---------------------------------------------------------------------------
// Message table
// ---------------------------------------------------------------------------

const REPOSITORY_NOT_FOUND = 'Repository not found. Make sure the repository exists. If it\'s private, add a GitHub token in Settings.'
const RATE_LIMITED = 'Rate limit exceeded. Please try again later or add a GitHub token.'
const UNAUTHORIZED = 'Invalid or expired GitHub token. Sign in again or check your GitHub token in Settings.'
const FORBIDDEN = 'GitHub denied access. Your token may lack permission for this repository, or the organization may require you to authorize the token for SSO.'
const TIMEOUT = 'GitHub did not respond in time. Please try again.'

interface ResourceMessages {
  /** Lower-case noun used in "Failed to fetch …" and "Invalid request for …". */
  label: string
  notFound: (subject?: string) => string
  rateLimited?: string
  unauthorized?: string
}

const RESOURCE_MESSAGES: Record<GitHubResource, ResourceMessages> = {
  repository: {
    label: 'repository',
    notFound: () => REPOSITORY_NOT_FOUND,
    rateLimited: 'Rate limit exceeded. Try again later or add a GitHub Personal Access Token in Settings for higher limits.',
  },
  tree: { label: 'repository tree', notFound: () => 'Repository tree not found.' },
  file: { label: 'file', notFound: subject => subject ? `File not found: ${subject}` : 'File not found.' },
  tags: { label: 'tags', notFound: () => 'Tags not found.' },
  branches: { label: 'branches', notFound: () => 'Branches not found.' },
  commits: { label: 'commits', notFound: () => 'Commits not found.' },
  comparison: { label: 'comparison', notFound: () => 'Comparison not found.' },
  commit: { label: 'commit detail', notFound: subject => subject ? `Commit not found: ${subject}` : 'Commit not found.' },
  // GraphQL resolves the repository first; a missing file is reported as 'file'.
  blame: {
    label: 'blame data',
    notFound: () => REPOSITORY_NOT_FOUND,
    unauthorized: 'Authentication required to fetch blame data',
  },
  pulls: { label: 'pull requests', notFound: () => 'Pull requests not found.' },
  pull_request: { label: 'pull request', notFound: pullRequestNotFound },
  pull_request_files: { label: 'pull request files', notFound: pullRequestNotFound },
  github: { label: 'GitHub data', notFound: () => 'Not found on GitHub.' },
}

function pullRequestNotFound(subject?: string): string {
  return subject ? `Pull request #${subject} not found` : 'Pull request not found'
}

/** The user-facing message for a failure kind on a resource. */
export function gitHubErrorMessage(kind: GitHubErrorKind, target: GitHubErrorTarget): string {
  const messages = RESOURCE_MESSAGES[target.resource]
  switch (kind) {
    case 'not_found': return messages.notFound(target.subject)
    case 'unauthorized': return messages.unauthorized ?? UNAUTHORIZED
    case 'forbidden': return FORBIDDEN
    case 'rate_limited': return messages.rateLimited ?? RATE_LIMITED
    case 'invalid': return `Invalid request for ${messages.label}.`
    case 'timeout': return TIMEOUT
    case 'upstream': return `Failed to fetch ${messages.label}`
  }
}

/**
 * HTTP status and error code each kind gets on /api/github/*. Routes keep
 * their historical not-found code (REPO_NOT_FOUND or NOT_FOUND). GitHub rate
 * limits, including the secondary-limit 429, stay 403 RATE_LIMIT; the app's
 * own limiter answers 429 RATE_LIMITED.
 */
export const GITHUB_ERROR_RESPONSES: Record<GitHubErrorKind, { status: number; code: string }> = {
  not_found: { status: 404, code: 'NOT_FOUND' },
  unauthorized: { status: 401, code: 'AUTH_REQUIRED' },
  forbidden: { status: 403, code: 'FORBIDDEN' },
  rate_limited: { status: 403, code: 'RATE_LIMIT' },
  invalid: { status: 422, code: 'VALIDATION_ERROR' },
  timeout: { status: 504, code: 'GITHUB_TIMEOUT' },
  upstream: { status: 502, code: 'GITHUB_ERROR' },
}

/** Proxy error codes the client recognizes; any other code is 'upstream'. */
const PROXY_CODE_KINDS: Record<string, GitHubErrorKind> = {
  REPO_NOT_FOUND: 'not_found',
  NOT_FOUND: 'not_found',
  AUTH_REQUIRED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  RATE_LIMIT: 'rate_limited',
  RATE_LIMITED: 'rate_limited',
  VALIDATION_ERROR: 'invalid',
  GITHUB_TIMEOUT: 'timeout',
  GITHUB_ERROR: 'upstream',
}

// ---------------------------------------------------------------------------
// GitHubError
// ---------------------------------------------------------------------------

export interface GitHubErrorInit extends GitHubErrorTarget {
  /** Overrides the table message; only for a message the proxy already took from the table. */
  message?: string
  /** HTTP status of the failed response (GitHub's, or the proxy's on the client). */
  upstreamStatus?: number
  /** Seconds until a rate limit resets, when the response said so. */
  retryAfter?: number
  /** GitHub's own error text or the transport error. Log it; never send it to a client. */
  upstreamMessage?: string
}

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind
  readonly resource: GitHubResource
  readonly subject?: string
  readonly upstreamStatus?: number
  readonly retryAfter?: number
  readonly upstreamMessage?: string

  constructor(kind: GitHubErrorKind, init: GitHubErrorInit) {
    super(init.message ?? gitHubErrorMessage(kind, init))
    this.name = 'GitHubError'
    this.kind = kind
    this.resource = init.resource
    this.subject = init.subject
    this.upstreamStatus = init.upstreamStatus
    this.retryAfter = init.retryAfter
    this.upstreamMessage = init.upstreamMessage
  }
}

/**
 * Recognize a GitHubError by name and kind as well as by class: vi.mock and
 * bundling can load this module twice, which breaks instanceof alone.
 */
export function isGitHubError(error: unknown): error is GitHubError {
  if (error instanceof GitHubError) return true
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; kind?: unknown; message?: unknown }
  return candidate.name === 'GitHubError'
    && typeof candidate.message === 'string'
    && (GITHUB_ERROR_KINDS as readonly unknown[]).includes(candidate.kind)
}

/** The same failure reported against another resource (for example GraphQL → blame). */
export function withGitHubResource(error: GitHubError, target: GitHubErrorTarget): GitHubError {
  return new GitHubError(error.kind, {
    ...target,
    upstreamStatus: error.upstreamStatus,
    retryAfter: error.retryAfter,
    upstreamMessage: error.upstreamMessage,
  })
}

// ---------------------------------------------------------------------------
// Building errors from GitHub responses
// ---------------------------------------------------------------------------

/** Error bodies beyond this are cancelled unread; GitHub's are a few hundred bytes. */
const MAX_ERROR_BODY_BYTES = 16 * 1024

function header(headers: Headers | null | undefined, name: string): string | null {
  return typeof headers?.get === 'function' ? headers.get(name) : null
}

function isRateLimited(headers: Headers | null | undefined, upstreamMessage?: string): boolean {
  return header(headers, 'x-ratelimit-remaining') === '0'
    || header(headers, 'retry-after') !== null
    // Secondary limits can arrive as a 403 without either header.
    || RATE_LIMIT_MESSAGE.test(upstreamMessage ?? '')
}

/** GitHub's wording for primary, secondary and older abuse-detection limits. */
const RATE_LIMIT_MESSAGE = /rate limit|abuse detection/i

/** Longest Retry-After sent to clients: GitHub's own limits reset within an hour. */
const MAX_RETRY_AFTER_SECONDS = 86_400

function retryAfterSeconds(seconds: number): number {
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)))
}

/** Classify a failed GitHub response by status, headers and GitHub's message. */
export function classifyGitHubStatus(
  status: number,
  headers?: Headers | null,
  upstreamMessage?: string,
): GitHubErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status === 403) return isRateLimited(headers, upstreamMessage) ? 'rate_limited' : 'forbidden'
  if (status === 451) return 'forbidden'
  if (status === 404 || status === 410) return 'not_found'
  if (status === 400 || status === 409 || status === 422) return 'invalid'
  return 'upstream'
}

/** Seconds to wait before retrying, from Retry-After or an exhausted x-ratelimit-reset. */
export function gitHubRetryAfter(headers?: Headers | null, now = Date.now()): number | undefined {
  const retryAfter = header(headers, 'retry-after')
  if (retryAfter !== null) {
    const seconds = /^\d+$/.test(retryAfter.trim())
      ? Number(retryAfter)
      : (Date.parse(retryAfter) - now) / 1000
    if (Number.isFinite(seconds)) return retryAfterSeconds(seconds)
  }
  const reset = Number(header(headers, 'x-ratelimit-reset'))
  if (header(headers, 'x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) {
    return retryAfterSeconds(reset - now / 1000)
  }
  return undefined
}

/** Build the GitHubError for a failed response whose body was already read. */
export function gitHubErrorFromStatus(
  status: number,
  headers: Headers | null | undefined,
  init: GitHubErrorTarget & { upstreamMessage?: string },
): GitHubError {
  const kind = classifyGitHubStatus(status, headers, init.upstreamMessage)
  return new GitHubError(kind, {
    ...init,
    upstreamStatus: status,
    retryAfter: kind === 'rate_limited' ? gitHubRetryAfter(headers) : undefined,
  })
}

/** Read GitHub's JSON `message` from a bounded prefix of an error body, then cancel the rest. */
async function readUpstreamMessage(response: Response): Promise<string | undefined> {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') return undefined
  const declared = Number(header(response.headers, 'content-length'))
  if (!/json/i.test(header(response.headers, 'content-type') ?? '')
    || (Number.isFinite(declared) && declared > MAX_ERROR_BODY_BYTES)) {
    void body.cancel().catch(() => {})
    return undefined
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total <= MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    return undefined
  } finally {
    void reader.cancel().catch(() => {})
  }
  if (total > MAX_ERROR_BODY_BYTES) return undefined

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { message?: unknown }
    return typeof parsed?.message === 'string' ? parsed.message : undefined
  } catch {
    return undefined
  }
}

/** Build the GitHubError for a non-OK GitHub response, consuming at most a small body prefix. */
export async function gitHubErrorFromResponse(response: Response, target: GitHubErrorTarget): Promise<GitHubError> {
  const upstreamMessage = await readUpstreamMessage(response) ?? (response.statusText || undefined)
  return gitHubErrorFromStatus(response.status, response.headers, { ...target, upstreamMessage })
}

/** Map GitHub GraphQL `errors` (sent with HTTP 200) to a GitHubError. */
export function gitHubErrorFromGraphQL(
  errors: ReadonlyArray<{ type?: string; message?: string }>,
  target: GitHubErrorTarget,
  headers?: Headers | null,
  now = Date.now(),
): GitHubError {
  const [first] = errors
  const kind = classifyGraphQLError(first?.type, first?.message)
  return new GitHubError(kind, {
    ...target,
    upstreamMessage: first?.message,
    retryAfter: kind === 'rate_limited' ? gitHubRetryAfter(headers, now) : undefined,
  })
}

function classifyGraphQLError(type: string | undefined, message: string | undefined): GitHubErrorKind {
  if (type === 'NOT_FOUND') return 'not_found'
  if (type === 'RATE_LIMITED' || type === 'RATE_LIMIT') return 'rate_limited'
  // INSUFFICIENT_SCOPES: the token works but lacks a permission this query needs.
  if (type === 'FORBIDDEN' || type === 'INSUFFICIENT_SCOPES') return 'forbidden'
  return RATE_LIMIT_MESSAGE.test(message ?? '') ? 'rate_limited' : 'upstream'
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
}

function errorText(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : String(error)
}

/** True for a cancellation by the caller (an AbortError), not for a deadline. */
export function isAbortError(error: unknown): boolean {
  return errorName(error) === 'AbortError'
}

/**
 * Map a rejected GitHub request to a GitHubError: a deadline becomes
 * 'timeout' and a network failure 'upstream'. Caller aborts and existing
 * GitHubErrors are returned unchanged so they can be rethrown.
 */
export function gitHubTransportError(error: unknown, target: GitHubErrorTarget, callerSignal?: AbortSignal | null): unknown {
  if (callerSignal?.aborted || isAbortError(error) || isGitHubError(error)) return error
  const kind: GitHubErrorKind = errorName(error) === 'TimeoutError' ? 'timeout' : 'upstream'
  return new GitHubError(kind, { ...target, upstreamMessage: errorText(error) })
}

// ---------------------------------------------------------------------------
// Client side: rebuilding the error from a proxy response
// ---------------------------------------------------------------------------

/**
 * Rebuild the GitHubError a /api/github route reported. The body is
 * `{ error: { code, message } }`; an unknown code is treated as 'upstream'.
 */
export async function gitHubErrorFromProxyResponse(response: Response, target: GitHubErrorTarget): Promise<GitHubError> {
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  const error = body?.error
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const bodyMessage = typeof error === 'string'
    ? error
    : typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined
  const kind = typeof code === 'string' && Object.prototype.hasOwnProperty.call(PROXY_CODE_KINDS, code)
    ? PROXY_CODE_KINDS[code]
    : 'upstream'
  return new GitHubError(kind, {
    ...target,
    message: typeof bodyMessage === 'string' && bodyMessage ? bodyMessage : undefined,
    upstreamStatus: response.status,
    retryAfter: kind === 'rate_limited' ? gitHubRetryAfter(response.headers) : undefined,
  })
}
