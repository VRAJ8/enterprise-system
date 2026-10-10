/**
 * Feature-owned pieces rendered by the app shell. Kept in one place so the shell
 * doesn't depend on feature internals.
 */
import * as React from 'react'

const CommandPalette = React.lazy(() => import('@/features/search/CommandPalette'))
const CreateTaskDialog = React.lazy(() => import('@/features/tasks/CreateTaskDialog'))
const TaskPanel = React.lazy(() => import('@/features/tasks/TaskPanel'))
const ShortcutsDialog = React.lazy(() => import('@/features/shortcuts/ShortcutsDialog'))
const InboxBadgeImpl = React.lazy(() => import('@/features/inbox/InboxBadge'))
const SidebarProjectsImpl = React.lazy(() => import('@/features/projects/SidebarProjects'))
const SidebarTimerImpl = React.lazy(() => import('@/features/time/SidebarTimer'))

export function GlobalOverlays() {
  return (
    <React.Suspense fallback={null}>
      <CommandPalette />
      <CreateTaskDialog />
      <TaskPanel />
      <ShortcutsDialog />
    </React.Suspense>
  )
}

export function InboxBadge() {
  return (
    <React.Suspense fallback={null}>
      <InboxBadgeImpl />
    </React.Suspense>
  )
}

export function SidebarProjects({ collapsed }: { collapsed: boolean }) {
  return (
    <React.Suspense fallback={null}>
      <SidebarProjectsImpl collapsed={collapsed} />
    </React.Suspense>
  )
}

export function SidebarTimer({ collapsed }: { collapsed: boolean }) {
  return (
    <React.Suspense fallback={null}>
      <SidebarTimerImpl collapsed={collapsed} />
    </React.Suspense>
  )
}
