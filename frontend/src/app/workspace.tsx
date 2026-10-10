import * as React from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import type { Schemas } from '@/api/client'
import { useAuth } from './auth'

export type WorkspaceRole = Schemas['WorkspaceRole']

export interface CurrentWorkspace {
  id: string
  slug: string
  name: string
  role: WorkspaceRole
  isAdmin: boolean
  isGuest: boolean
}

const WorkspaceContext = React.createContext<CurrentWorkspace | null>(null)

const LAST_WORKSPACE_KEY = 'ph-last-workspace'

export function rememberWorkspace(slug: string) {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, slug)
  } catch {
    /* storage unavailable */
  }
}

export function lastWorkspaceSlug(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

/** Resolves `/:workspaceSlug/*` against the user's memberships. */
export function WorkspaceRoute() {
  const { workspaceSlug } = useParams()
  const { me } = useAuth()
  const membership = me?.workspaces.find((w) => w.workspace_slug === workspaceSlug)

  const value = React.useMemo<CurrentWorkspace | null>(
    () =>
      membership
        ? {
            id: membership.workspace_id,
            slug: membership.workspace_slug,
            name: membership.workspace_name,
            role: membership.role,
            isAdmin: membership.role === 'owner' || membership.role === 'admin',
            isGuest: membership.role === 'guest',
          }
        : null,
    [membership],
  )

  React.useEffect(() => {
    if (value) rememberWorkspace(value.slug)
  }, [value])

  if (!value) {
    const fallback = me?.workspaces[0]
    return <Navigate to={fallback ? `/${fallback.workspace_slug}` : '/onboarding'} replace />
  }
  return (
    <WorkspaceContext.Provider value={value}>
      <Outlet />
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): CurrentWorkspace {
  const ctx = React.useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside a workspace route')
  return ctx
}

/** Build a workspace-scoped path: wsPath(ws, 'projects', 'WEB') -> /acme/projects/WEB */
export function wsPath(ws: { slug: string }, ...parts: (string | number)[]): string {
  return `/${[ws.slug, ...parts].join('/')}`
}
