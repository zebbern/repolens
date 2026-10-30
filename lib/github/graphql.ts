import { fetchGitHub } from './request-signal'
import {
  gitHubErrorFromGraphQL,
  gitHubErrorFromResponse,
  gitHubTransportError,
  type GitHubErrorTarget,
} from './errors'

// GitHub GraphQL API utility

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'
/** Callers re-target errors to what they queried (see withGitHubResource). */
const GRAPHQL_TARGET: GitHubErrorTarget = { resource: 'github' }

interface GraphQLResponse<T> {
  data: T
  errors?: Array<{ message: string; type?: string }>
}

/**
 * Execute a GitHub GraphQL query with parameterized variables.
 * Requires a valid access token — GitHub GraphQL API does not support unauthenticated requests.
 * Failures are thrown as GitHubError; a caller abort is rethrown unchanged.
 */
export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetchGitHub(GITHUB_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal,
    })
  } catch (error) {
    throw gitHubTransportError(error, GRAPHQL_TARGET, signal)
  }

  if (!response.ok) {
    throw await gitHubErrorFromResponse(response, GRAPHQL_TARGET)
  }

  const body = (await response.json()) as GraphQLResponse<T>

  // GitHub reports a missing repository and the rate limit as HTTP 200 with typed errors.
  if (body.errors && body.errors.length > 0) {
    throw gitHubErrorFromGraphQL(body.errors, GRAPHQL_TARGET, response.headers)
  }

  return body.data
}
