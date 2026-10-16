import { AlertTriangle, Users } from 'lucide-react'
import * as React from 'react'
import { useWorkload, type Workload } from '@/api/hooks/insights'
import { useProjects } from '@/api/hooks/projects'
import { useWorkspace } from '@/app/workspace'
import { ProjectIcon } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Picker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { format, parseISO } from '@/lib/dates'
import { cn } from '@/lib/utils'

/** Utilisation → cell style. Sequential (one hue) up to capacity, then the reserved warning/danger states. */
function cellStyle(util: number): { className: string; label: string } {
  if (util === 0) return { className: 'bg-muted/40 text-subtle', label: 'Free' }
  if (util > 1.2) return { className: 'bg-danger/15 text-danger ring-1 ring-inset ring-danger/30', label: 'Overloaded' }
  if (util > 1) return { className: 'bg-warning/15 text-warning ring-1 ring-inset ring-warning/30', label: 'Over capacity' }
  const step = util > 0.8 ? 'bg-primary/40' : util > 0.5 ? 'bg-primary/25' : util > 0.25 ? 'bg-primary/15' : 'bg-primary/[0.07]'
  return { className: cn(step, 'text-foreground'), label: 'Within capacity' }
}

export default function WorkloadPage() {
  const ws = useWorkspace()
  const projects = useProjects()
  const [weeks, setWeeks] = React.useState(8)
  const [projectId, setProjectId] = React.useState<string | undefined>()
  const q = useWorkload({ weeks, ...(projectId ? { project_id: projectId } : {}) })
  const project = projects.data?.find((p) => p.id === projectId)

  if (ws.isGuest) return <EmptyState icon={Users} title="Workload is visible to members" description="Ask an admin if you need access." />

  return (
    <>
      <PageHeader title="Workload" icon={Users}>
        <Picker
          options={[{ value: '', label: 'All projects' }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, icon: <ProjectIcon project={p} size="sm" /> }))]}
          value={projectId ?? ''}
          onChange={(v) => setProjectId(v || undefined)}
        >
          <Button variant="outline" size="sm">
            {project ? <ProjectIcon project={project} size="sm" /> : null}
            {project?.name ?? 'All projects'}
          </Button>
        </Picker>
        <div className="flex rounded-md border border-border p-0.5">
          {[4, 8, 12].map((n) => (
            <button
              key={n}
              onClick={() => setWeeks(n)}
              className={cn('h-6 rounded px-2 text-xs', weeks === n ? 'bg-accent font-medium' : 'text-muted-foreground')}
            >
              {n} weeks
            </button>
          ))}
        </div>
        <Legend />
      </PageHeader>
      <PageBody className="p-4 sm:p-5">
        {!q.data ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : (
          <Grid data={q.data} />
        )}
        <p className="mt-3 max-w-3xl text-xs text-subtle">
          Planned hours spread each open task's estimate evenly across working days between its start (or today) and due
          date. Overdue work lands in the current week. Tasks without estimates or due dates are counted separately so
          nothing hides.
        </p>
      </PageBody>
    </>
  )
}

function Legend() {
  const items = [
    { util: 0.3, label: '< 50%' },
    { util: 0.9, label: 'Near full' },
    { util: 1.1, label: '> 100%' },
    { util: 1.5, label: '> 120%' },
  ]
  return (
    <div className="ml-auto hidden items-center gap-3 text-2xs text-muted-foreground md:flex">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn('size-3 rounded', cellStyle(i.util).className)} /> {i.label}
        </span>
      ))}
    </div>
  )
}

function Grid({ data }: { data: Workload }) {
  if (!data.people.length) return <EmptyState icon={Users} title="No team members yet" />
  const thisWeek = data.weeks[0]
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-elev-1">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-2xs uppercase tracking-wide text-subtle">
            <th className="sticky left-0 z-10 w-56 border-b border-border bg-surface px-4 py-2.5 font-medium">Person</th>
            {data.weeks.map((w) => (
              <th key={w} className="border-b border-border px-1 py-2.5 text-center font-medium">
                {w === thisWeek ? 'This week' : format(parseISO(w), 'MMM d')}
              </th>
            ))}
            <th className="border-b border-border px-3 py-2.5 text-right font-medium">Not scheduled</th>
          </tr>
        </thead>
        <tbody>
          {data.people.map((p) => {
            const overloaded = p.weeks.filter((w) => w.utilization > 1).length
            return (
              <tr key={p.user.id} className="group">
                <td className="sticky left-0 z-10 border-b border-border/60 bg-surface px-4 py-2 group-hover:bg-accent/30">
                  <div className="flex items-center gap-2">
                    <UserAvatar user={p.user} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.user.name}</p>
                      <p className="text-2xs text-subtle">
                        {p.capacity_hours}h/week
                        {overloaded > 0 && <span className="text-warning"> · over in {overloaded} wk</span>}
                      </p>
                    </div>
                  </div>
                </td>
                {p.weeks.map((w) => {
                  const s = cellStyle(w.utilization)
                  return (
                    <td key={w.week_start} className="border-b border-border/60 p-1">
                      <Tip
                        content={
                          <div className="text-xs">
                            <p className="font-medium">
                              {p.user.name} · week of {format(parseISO(w.week_start), 'MMM d')}
                            </p>
                            <p>
                              {w.planned_hours}h planned of {w.capacity_hours}h ({Math.round(w.utilization * 100)}%) · {w.task_count} tasks
                            </p>
                            <p className="text-muted-foreground">{s.label}</p>
                          </div>
                        }
                      >
                        <div className={cn('flex h-11 flex-col items-center justify-center rounded-md text-xs tabular-nums', s.className)}>
                          <span className="font-medium">{w.planned_hours ? `${w.planned_hours}h` : '–'}</span>
                          {w.planned_hours > 0 && <span className="text-2xs opacity-70">{Math.round(w.utilization * 100)}%</span>}
                        </div>
                      </Tip>
                    </td>
                  )
                })}
                <td className="border-b border-border/60 px-3 text-right text-xs text-muted-foreground">
                  {p.unscheduled_hours > 0 && <p>{p.unscheduled_hours}h no due date</p>}
                  {p.unestimated_tasks > 0 && <p>{p.unestimated_tasks} unestimated</p>}
                  {p.overdue_tasks > 0 && (
                    <p className="inline-flex items-center gap-1 text-danger">
                      <AlertTriangle className="size-3" /> {p.overdue_tasks} overdue
                    </p>
                  )}
                  {!p.unscheduled_hours && !p.unestimated_tasks && !p.overdue_tasks && <span className="text-subtle">–</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
