import { describe, it, expect } from 'vitest'
import { apiError } from './error'

describe('apiError', () => {
  it('returns NextResponse with correct JSON body shape', async () => {
    const response = apiError('BAD_REQUEST', 'Missing required field', 400)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing required field',
      },
    })
  })

  it('includes details field when provided', async () => {
    const response = apiError(
      'VALIDATION_ERROR',
      'Invalid input',
      422,
      'Field "email" must be a valid email address',
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: 'Field "email" must be a valid email address',
      },
    })
  })

  it('omits details field when not provided', async () => {
    const response = apiError('NOT_FOUND', 'Resource not found', 404)
    const body = await response.json()

    expect(body.error).not.toHaveProperty('details')
  })

  it('omits details field when undefined is explicitly passed', async () => {
    const response = apiError('SERVER_ERROR', 'Something went wrong', 500, undefined)
    const body = await response.json()

    expect(body.error).not.toHaveProperty('details')
  })

  it.each([
    { code: 'BAD_REQUEST', status: 400 },
    { code: 'UNAUTHORIZED', status: 401 },
    { code: 'FORBIDDEN', status: 403 },
    { code: 'NOT_FOUND', status: 404 },
    { code: 'RATE_LIMITED', status: 429 },
    { code: 'SERVER_ERROR', status: 500 },
    { code: 'BAD_GATEWAY', status: 502 },
  ])('maps status code $status correctly for $code', async ({ code, status }) => {
    const response = apiError(code, 'test message', status)

    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body.error.code).toBe(code)
  })

  it('returns a Response with Content-Type application/json', () => {
    const response = apiError('BAD_REQUEST', 'test', 400)

    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
