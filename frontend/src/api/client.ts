/**
 * Typed API client (openapi-fetch over the generated OpenAPI types).
 *
 * Auth model: a short-lived access token lives in memory only; a rotating refresh token lives in an
 * httpOnly cookie. On a 401 the client refreshes once (deduplicated across concurrent requests)
 * and retries the original request transparently.
 */
import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema'

export type Schemas = components['schemas']

/** '' = same origin (Vite dev proxy / reverse proxy). Set VITE_API_URL for a separate API host. */
export const API_ORIGIN: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

// ─── Access token (memory only) ───

type Listener = (token: string | null) => void
let accessToken: string | null = null
let expiresAt = 0
const listeners = new Set<Listener>()

export const tokenStore = {
  get: () => accessToken,
  expiresAt: () => expiresAt,
  set(token: string | null, expiresInSeconds = 0) {
    accessToken = token
    expiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0
    listeners.forEach((l) => l(token))
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// ─── Errors ───

export class ApiError extends Error {
  status: number
  code: string
  detail: string
  fields?: Record<string, string>

  constructor(status: number, detail: string, code = 'error', fields?: Record<string, string>) {
    super(detail)
    this.status = status
    this.code = code
    this.detail = detail
    this.fields = fields
  }
}

type ValidationItem = { loc?: (string | number)[]; msg?: string }

/** Turn any error body (ours: {detail, code}; FastAPI 422: {detail: [...]}) into an ApiError. */
export function toApiError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { detail?: unknown; code?: string }
  if (Array.isArray(b.detail)) {
    const fields: Record<string, string> = {}
    for (const item of b.detail as ValidationItem[]) {
      const field = String(item.loc?.[item.loc.length - 1] ?? 'body')
      fields[field] = (item.msg ?? 'Invalid value').replace(/^Value error, /, '')
    }
    const [first] = Object.entries(fields)
    const message = first ? (first[0] === 'body' ? first[1] : `${humanize(first[0])}: ${first[1]}`) : 'Invalid request'
    return new ApiError(status, message, 'validation_error', fields)
  }
  const detail = typeof b.detail === 'string' ? b.detail : defaultMessage(status)
  return new ApiError(status, detail, b.code ?? `http_${status}`)
}

function humanize(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function defaultMessage(status: number) {
  if (status === 0) return "Can't reach the server. Check your connection."
  if (status >= 500) return 'Something went wrong on our side. Please try again.'
  if (status === 404) return 'Not found'
  if (status === 403) return "You don't have permission to do that"
  return 'Request failed'
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// ─── Refresh ───

type TokenPayload = Schemas['TokenOut']
let refreshInFlight: Promise<TokenPayload | null> | null = null
const refreshListeners = new Set<(payload: TokenPayload | null) => void>()

export function onRefresh(listener: (payload: TokenPayload | null) => void): () => void {
  refreshListeners.add(listener)
  return () => {
    refreshListeners.delete(listener)
  }
}

/** Exchange the refresh cookie for a new access token. Resolves null when the session is gone. */
export function refreshSession(): Promise<TokenPayload | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          tokenStore.set(null)
          return null
        }
        const payload = (await res.json()) as TokenPayload
        tokenStore.set(payload.access_token, payload.expires_in)
        return payload
      } catch {
        return null
      } finally {
        setTimeout(() => (refreshInFlight = null), 0)
      }
    })().then((payload) => {
      refreshListeners.forEach((l) => l(payload))
      return payload
    })
  }
  return refreshInFlight
}

// ─── Middleware ───

const pendingClones = new WeakMap<Request, Request>()
const NO_RETRY = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh', '/api/v1/auth/logout']

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    // Refresh proactively when the token is about to expire
    if (accessToken && expiresAt && expiresAt - Date.now() < 20_000 && !NO_RETRY.some((p) => request.url.includes(p))) {
      await refreshSession()
    }
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`)
    if (request.method !== 'GET' && request.method !== 'HEAD') pendingClones.set(request, request.clone())
    return request
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || NO_RETRY.some((p) => request.url.includes(p))) return response
    const clone = pendingClones.get(request) ?? request
    const payload = await refreshSession()
    if (!payload) return response
    const retry = new Request(clone, { headers: new Headers(clone.headers) })
    retry.headers.set('Authorization', `Bearer ${payload.access_token}`)
    return fetch(retry)
  },
}

export const api = createClient<paths>({ baseUrl: API_ORIGIN, credentials: 'include' })
api.use(authMiddleware)

/**
 * Await an openapi-fetch call and return its data, throwing ApiError on failure.
 *   const project = await unwrap(api.GET('/api/v1/projects/{project_id}', { params: { path: { project_id } } }))
 */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await promise
  } catch {
    throw new ApiError(0, defaultMessage(0), 'network_error')
  }
  if (result.error !== undefined || !result.response.ok) {
    throw toApiError(result.response.status, result.error)
  }
  return result.data as T
}

/** Authenticated fetch for non-JSON endpoints (file downloads/uploads). */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_ORIGIN}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.headers ?? {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    })
  let res = await doFetch()
  if (res.status === 401 && (await refreshSession())) res = await doFetch()
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    throw toApiError(res.status, body)
  }
  return res
}
