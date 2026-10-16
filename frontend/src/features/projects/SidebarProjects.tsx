import { ChevronRight, Plus } from 'lucide-react'
import * as React from 'react'
import { NavLink } from 'react-router-dom'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useProjects } from '@/api/hooks/projects'
import { ProjectIcon } from '@/components/domain'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CreateProjectDialog } from './CreateProjectDialog'

export default function SidebarProjects({ collapsed }: { collapsed: boolean }) {
  const ws = useWorkspace()
  const { data } = useProjects()
  const [open, setOpen] = React.useState(() => localStorage.getItem('ph-sidebar-projects') !== '0')
  const [creating, setCreating] = React.useState(false)
  const projects = (data ?? []).filter((p) => p.status !== 'completed')

  const toggle = () => {
    setOpen((o) => {
      localStorage.setItem('ph-sidebar-projects', o ? '0' : '1')
      return !o
    })
  }

  return (
    <div className="mt-4">
      {!collapsed && (
        <div className="group mb-1 flex items-center px-2 text-2xs font-medium uppercase tracking-wider text-subtle">
          <button onClick={toggle} className="flex items-center gap-1 hover:text-muted-foreground">
            Projects
            <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          </button>
          {!ws.isGuest && (
            <button
              onClick={() => setCreating(true)}
              className="ml-auto rounded p-0.5 opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
              aria-label="New project"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {(open || collapsed) && (
        <div className="space-y-0.5">
          {projects.slice(0, 12).map((p) => {
            const link = (
              <NavLink
                key={p.id}
                to={wsPath(ws, 'projects', p.key)}
                className={({ isActive }) =>
                  cn(
                    'flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                    isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    collapsed && 'justify-center px-0',
                  )
                }
              >
                <ProjectIcon project={p} size="sm" />
                {!collapsed && <span className="truncate">{p.name}</span>}
              </NavLink>
            )
            return collapsed ? (
              <Tip key={p.id} content={p.name} side="right">
                {link}
              </Tip>
            ) : (
              link
            )
          })}
        </div>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
