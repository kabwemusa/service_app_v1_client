import { ADMIN_TOKEN_COOKIE, STEP_UP_COOKIE } from '@/lib/auth/cookies'
import type { ApiError } from '@/lib/api/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function getAdminToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_TOKEN_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function getStepUpToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${STEP_UP_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  // Attach step-up token for sensitive mutations (backend enforces independently)
  stepUp?: boolean
}

export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message)
    this.name = 'ApiResponseError'
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, stepUp, ...init } = options

  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')

  const token = getAdminToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  if (stepUp) {
    const suToken = getStepUpToken()
    if (suToken) headers.set('X-Step-Up-Token', suToken)
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  if (!res.ok) {
    let err: ApiError = { message: `HTTP ${res.status}` }
    try { err = await res.json() } catch { /* use default */ }

    // JWT expired or invalidated — clear cookie and redirect to login
    if (res.status === 401 && typeof document !== 'undefined') {
      document.cookie = `${ADMIN_TOKEN_COOKIE}=; path=/; max-age=0`
      window.location.href = '/login?reason=expired'
      // Throw anyway so the caller's catch block doesn't process a stale result
    }

    throw new ApiResponseError(res.status, err)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET' }),

  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),

  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}
