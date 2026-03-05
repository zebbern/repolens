// GitHub GraphQL API utility

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

interface GraphQLResponse<T> {
  data: T
  errors?: Array<{ message: string; type?: string }>
}

/**
 * Execute a GitHub GraphQL query with parameterized variables.
 * Requires a valid access token — GitHub GraphQL API does not support unauthenticated requests.
 */
export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (response.status === 401) {
    throw new Error('Authentication required for this request')
  }

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.statusText}`)
  }

  const body = (await response.json()) as GraphQLResponse<T>

  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0].message)
  }

  return body.data
}
