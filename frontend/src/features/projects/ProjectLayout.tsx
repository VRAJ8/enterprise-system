import { CalendarRange, KanbanSquare, LayoutDashboard, List, Megaphone, Settings } from 'lucide-react'
import * as React from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { canEditProject, isProjectLead, useProjectByKey, type Project } from '@/api/hooks/projects'
import { useUI } from '@/app/ui-store'
import { useWorkspace, wsPath } from '@/app/workspace'
import { ProjectIcon } from '@/components/domain'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ProjectContextValue {
  project: Project
  canEdit: boolean
  isLead: boolean
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null)

/** The project whose route we're in (board, list, timeline, overview, updates, settings). */
export function useProjectContext(): ProjectContextValue {
  const ctx = React.useContext(ProjectContext)
  if (!ctx) throw new Error('useProjectContext must be used inside ProjectLayout')
  return ctx
}

const TABS = [
  { to: 'overview', label: 'Overview', icon: LayoutDashboard },
  { to: 'board', label: 'Board', icon: KanbanSquare },
  { to: 'list', label: 'List', icon: List },
  { to: 'timeline', label: 'Timeline', icon: CalendarRange },
  { to: 'updates', label: 'Updates', icon: Megaphone },
]

export default function ProjectLayout() {
  const { projectKey } = useParams()
  const ws = useWorkspace()
  const { project, isLoading, notFound } = useProjectByKey(projectKey)
  const openCreateTask = useUI((s) => s.openCreateTask)

  if (notFound) {
    return (
      <EmptyState
        title="Project not found"
        description="It may have been deleted, or you don't have access."
        action={
          <Button asChild variant="outline">
            <NavLink to={wsPath(ws, 'projects')}>All projects</NavLink>
          </Button>
        }
      />
    )
  }
  if (isLoading || !project) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const value: ProjectContextValue = { project, canEdit: canEditProject(project), isLead: isProjectLead(project) }
  const base = wsPath(ws, 'projects', project.key)

  return (
    <ProjectContext.Provider value={value}>
      <PageHeader
        breadcrumb={<NavLink to={wsPath(ws, 'projects')} className="hover:text-foreground">Projects</NavLink>}
        title={
          <span className="flex items-center gap-2">
            <ProjectIcon project={project} size="sm" />
            {project.name}
          </span>
        }
        actions={
          <>
            {value.isLead && (
              <Tip content="Project settings">
                <Button asChild variant="ghost" size="icon-sm" aria-label="Project settings">
                  <NavLink to={`${base}/settings`}>
                    <Settings />
                  </NavLink>
                </Button>
              </Tip>
            )}
            {value.canEdit && (
              <Button size="sm" onClick={() => openCreateTask({ projectId: project.id })}>
                New task
              </Button>
            )}
          </>
        }
      >
        <nav className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={`${base}/${t.to}`}
              className={({ isActive }) =>
                cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5',
                  isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              <t.icon />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </ProjectContext.Provider>
  )
}
