import * as React from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { homePathFor } from '@/features/auth/LoginPage'
import { AppShell } from './AppShell'
import { useAuth } from './auth'
import { WorkspaceRoute } from './workspace'

const lazyPage = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const Component = React.lazy(loader)
  return (
    <React.Suspense fallback={<PageFallback />}>
      <Component />
    </React.Suspense>
  )
}

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  )
}

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-5" />
    </div>
  )
}

function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

function PublicOnly() {
  const { status, me } = useAuth()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'authenticated' && me) return <Navigate to={homePathFor(me)} replace />
  return <Outlet />
}

function RootRedirect() {
  const { status, me } = useAuth()
  if (status === 'loading') return <FullScreenLoader />
  if (!me) return <Navigate to="/login" replace />
  return <Navigate to={homePathFor(me)} replace />
}

function RouteError() {
  const error = useRouteError() as Error | undefined
  // Stale chunk after a deploy: reload once to fetch the new build
  React.useEffect(() => {
    if (error?.message?.includes('dynamically imported module') && !sessionStorage.getItem('ph-reloaded')) {
      sessionStorage.setItem('ph-reloaded', '1')
      window.location.reload()
    }
  }, [error])
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? 'Unexpected error'}</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/invite/:token', element: lazyPage(() => import('@/features/auth/InvitePage')) },
      {
        element: <PublicOnly />,
        children: [
          { path: '/login', element: lazyPage(() => import('@/features/auth/LoginPage')) },
          { path: '/signup', element: lazyPage(() => import('@/features/auth/SignupPage')) },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: '/onboarding', element: lazyPage(() => import('@/features/auth/OnboardingPage')) },
          {
            path: '/:workspaceSlug',
            element: <WorkspaceRoute />,
            children: [
              {
                element: <AppShell />,
                errorElement: <RouteError />,
                children: [
                  { index: true, element: lazyPage(() => import('@/features/home/HomePage')) },
                  { path: 'inbox', element: lazyPage(() => import('@/features/inbox/InboxPage')) },
                  { path: 'my-tasks', element: lazyPage(() => import('@/features/my-tasks/MyTasksPage')) },
                  { path: 'projects', element: lazyPage(() => import('@/features/projects/ProjectsPage')) },
                  {
                    path: 'projects/:projectKey',
                    element: lazyPage(() => import('@/features/projects/ProjectLayout')),
                    children: [
                      { index: true, element: <Navigate to="board" replace /> },
                      { path: 'overview', element: lazyPage(() => import('@/features/projects/ProjectOverviewPage')) },
                      { path: 'board', element: lazyPage(() => import('@/features/board/BoardView')) },
                      { path: 'list', element: lazyPage(() => import('@/features/list/ListView')) },
                      { path: 'timeline', element: lazyPage(() => import('@/features/timeline/TimelineView')) },
                      { path: 'updates', element: lazyPage(() => import('@/features/projects/ProjectUpdatesPage')) },
                      { path: 'settings', element: lazyPage(() => import('@/features/projects/ProjectSettingsPage')) },
                    ],
                  },
                  { path: 'tasks/:taskRef', element: lazyPage(() => import('@/features/tasks/TaskPage')) },
                  { path: 'workload', element: lazyPage(() => import('@/features/workload/WorkloadPage')) },
                  { path: 'time', element: lazyPage(() => import('@/features/time/TimesheetPage')) },
                  { path: 'insights', element: lazyPage(() => import('@/features/insights/InsightsPage')) },
                  { path: 'settings/*', element: lazyPage(() => import('@/features/settings/SettingsPage')) },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <RootRedirect /> },
    ],
  },
])
