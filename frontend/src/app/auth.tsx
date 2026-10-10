import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { api, onRefresh, refreshSession, tokenStore, unwrap, type Schemas } from '@/api/client'

type Me = Schemas['MeOut']
type Status = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  status: Status
  me: Me | null
  login: (email: string, password: string) => Promise<Me>
  register: (body: Schemas['RegisterIn']) => Promise<Me>
  logout: () => Promise<void>
  /** Re-fetch /auth/me (e.g. after joining or creating a workspace). */
  reloadMe: () => Promise<Me | null>
  setMe: (me: Me) => void
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<Status>('loading')
  const [me, setMe] = React.useState<Me | null>(null)

  const accept = React.useCallback((payload: Schemas['TokenOut']) => {
    tokenStore.set(payload.access_token, payload.expires_in)
    setMe(payload.user)
    setStatus('authenticated')
    return payload.user
  }, [])

  // Restore the session from the refresh cookie on load
  React.useEffect(() => {
    let cancelled = false
    refreshSession().then((payload) => {
      if (cancelled) return
      if (payload) accept(payload)
      else setStatus('anonymous')
    })
    return () => {
      cancelled = true
    }
  }, [accept])

  // A failed background refresh means the session ended (expired / revoked elsewhere)
  React.useEffect(
    () =>
      onRefresh((payload) => {
        if (payload) setMe(payload.user)
        else if (tokenStore.get() === null) {
          setStatus((s) => (s === 'authenticated' ? 'anonymous' : s))
        }
      }),
    [],
  )

  // Keep the session alive while the tab is open
  React.useEffect(() => {
    if (status !== 'authenticated') return
    const id = window.setInterval(() => {
      if (tokenStore.expiresAt() - Date.now() < 60_000) void refreshSession()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [status])

  const login = React.useCallback(
    async (email: string, password: string) =>
      accept(await unwrap(api.POST('/api/v1/auth/login', { body: { email, password } }))),
    [accept],
  )

  const register = React.useCallback(
    async (body: Schemas['RegisterIn']) => accept(await unwrap(api.POST('/api/v1/auth/register', { body }))),
    [accept],
  )

  const logout = React.useCallback(async () => {
    try {
      await api.POST('/api/v1/auth/logout')
    } finally {
      tokenStore.set(null)
      setMe(null)
      setStatus('anonymous')
      queryClient.clear()
    }
  }, [queryClient])

  const reloadMe = React.useCallback(async () => {
    try {
      const fresh = await unwrap(api.GET('/api/v1/auth/me'))
      setMe(fresh)
      return fresh
    } catch {
      return null
    }
  }, [])

  const value = React.useMemo(
    () => ({ status, me, login, register, logout, reloadMe, setMe }),
    [status, me, login, register, logout, reloadMe],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** The signed-in user (only use inside authenticated routes). */
export function useMe(): Me {
  const { me } = useAuth()
  if (!me) throw new Error('useMe called while signed out')
  return me
}
