import { AlertTriangle, CalendarCheck2, CheckCircle2, Clock, Eye, Home as HomeIcon, Inbox, Pause, Play, Sparkles, Sun } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '@/app/auth'
import { useUI } from '@/app/ui-store'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useHome, type Home } from '@/api/hooks/insights'
import type { Task } from '@/api/hooks/tasks'
import { useElapsed, useStopTimer } from '@/api/hooks/time'
import { HealthBadge, ProjectIcon } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { TaskRow } from '@/components/task/TaskRow'
import { Button } from '@/components/ui/button'
import { ProgressBar, ProgressRing } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { format, formatMinutes } from '@/lib/dates'
import { cn, pluralize } from '@/lib/utils'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function HomePage() {
  const me = useMe()
  const home = useHome()
  const openCreateTask = useUI((s) => s.openCreateTask)
  const d = home.data

  return (
    <>
      <PageHeader
        title="Home"
        icon={HomeIcon}
        actions={
          <Button size="sm" onClick={() => openCreateTask({ assigneeId: me.id })}>
            New task
          </Button>
        }
      />
      <PageBody>
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">{format(new Date(), 'EEEE, MMMM d')}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {greeting()}, {me.name.split(' ')[0]}
            </h2>
            {d && <p className="mt-1 text-sm text-muted-foreground">{summaryLine(d)}</p>}
          </div>

          {!d ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              <Kpis d={d} />
              <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                <div className="space-y-6">
                  {d.timer && <TimerCard timer={d.timer} />}
                  <TaskSection title="Overdue" icon={AlertTriangle} tone="text-danger" tasks={d.overdue} />
                  <TaskSection title="Due today" icon={Sun} tone="text-warning" tasks={d.due_today} />
                  <TaskSection title="Coming up this week" icon={CalendarCheck2} tone="text-primary" tasks={d.due_this_week} />
                  <TaskSection title="In progress" icon={Sparkles} tone="text-primary" tasks={d.in_progress.filter((t) => ![...d.overdue, ...d.due_today, ...d.due_this_week].some((o) => o.id === t.id))} />
                  {d.review_queue.length > 0 && (
                    <TaskSection title="Waiting for your review" icon={Eye} tone="text-primary" tasks={d.review_queue} />
                  )}
                  {d.open_count === 0 && (
                    <div className="rounded-xl border border-dashed border-border p-10 text-center">
                      <CheckCircle2 className="mx-auto size-8 text-success" />
                      <p className="mt-2 font-medium">Nothing on your plate</p>
                      <p className="text-sm text-muted-foreground">Pick something up from a project, or enjoy the quiet.</p>
                    </div>
                  )}
                </div>
                <aside className="space-y-4">
                  <ProjectsCard d={d} />
                  <QuickLinks />
                </aside>
              </div>
            </>
          )}
        </div>
      </PageBody>
    </>
  )
}

function summaryLine(d: Home) {
  const parts: string[] = []
  if (d.overdue.length) parts.push(`${pluralize(d.overdue.length, 'task')} overdue`)
  if (d.due_today.length) parts.push(`${d.due_today.length} due today`)
  if (d.review_queue.length) parts.push(`${d.review_queue.length} waiting for your review`)
  if (!parts.length) return d.open_count ? `You have ${pluralize(d.open_count, 'open task')} and nothing urgent.` : "You're all caught up."
  return `You have ${parts.join(', ')}.`
}

function Kpis({ d }: { d: Home }) {
  const loggedHours = d.time_this_week_minutes / 60
  const util = d.capacity_hours ? loggedHours / d.capacity_hours : 0
  const items = [
    { label: 'Open tasks', value: d.open_count, sub: `${d.in_progress.length} in progress`, icon: Inbox },
    {
      label: 'Overdue',
      value: d.overdue.length,
      sub: d.overdue.length ? 'needs attention' : 'nothing late',
      icon: AlertTriangle,
      tone: d.overdue.length ? 'text-danger' : undefined,
    },
    { label: 'Done last 7 days', value: d.completed_last_7_days, sub: 'completed by you', icon: CheckCircle2, tone: 'text-success' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {k.label}
            <k.icon className={cn('size-4 text-subtle', k.tone)} />
          </div>
          <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', k.tone)}>{k.value}</p>
          <p className="text-2xs text-subtle">{k.sub}</p>
        </div>
      ))}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-elev-1">
        <ProgressRing value={Math.min(1, util)} size={52} stroke={5} />
        <div>
          <p className="text-xs text-muted-foreground">Logged this week</p>
          <p className="text-xl font-semibold tabular-nums tracking-tight">{formatMinutes(d.time_this_week_minutes) || '0h'}</p>
          <p className="text-2xs text-subtle">of {d.capacity_hours}h capacity</p>
        </div>
      </div>
    </div>
  )
}

function TimerCard({ timer }: { timer: NonNullable<Home['timer']> }) {
  const elapsed = useElapsed(timer.started_at)
  const stop = useStopTimer()
  return (
    <div className="flex items-center gap-4 rounded-xl border border-primary/30 bg-primary-soft/50 p-4">
      <span className="relative flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Play className="size-4" />
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Timer running on {timer.task.ref}</p>
        <Link to={`?task=${timer.task.ref}`} className="block truncate font-medium hover:underline">
          {timer.task.title}
        </Link>
      </div>
      <span className="font-mono text-xl tabular-nums">{elapsed}</span>
      <Button variant="outline" size="sm" onClick={() => stop.mutate()}>
        <Pause /> Stop
      </Button>
    </div>
  )
}

function TaskSection({
  title,
  icon: Icon,
  tone,
  tasks,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  tone: string
  tasks: Task[]
}) {
  if (!tasks.length) return null
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className={cn('size-4', tone)} /> {title}
        <span className="text-xs font-normal text-subtle">{tasks.length}</span>
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
        {tasks.slice(0, 8).map((t) => (
          <TaskRow key={t.id} task={t} showProject className="last:border-0" />
        ))}
        {tasks.length > 8 && <p className="px-3 py-2 text-xs text-subtle">+{tasks.length - 8} more in My tasks</p>}
      </div>
    </section>
  )
}

function ProjectsCard({ d }: { d: Home }) {
  const ws = useWorkspace()
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Your projects</h3>
        <Link to={wsPath(ws, 'projects')} className="text-xs text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {d.projects.length === 0 ? (
        <p className="text-xs text-subtle">Projects you work on or lead appear here with their health.</p>
      ) : (
        <div className="space-y-3">
          {d.projects.map((p) => (
            <Link key={p.project.id} to={wsPath(ws, 'projects', p.project.key, 'overview')} className="group block">
              <div className="flex items-center gap-2">
                <ProjectIcon project={p.project} size="sm" />
                <span className="truncate text-sm font-medium group-hover:underline">{p.project.name}</span>
                <HealthBadge status={p.health.status} reasons={p.health.reasons} className="ml-auto" />
              </div>
              <ProgressBar value={p.health.progress} marker={p.health.expected_progress} className="mt-2" />
              <p className="mt-1 text-2xs text-subtle">
                {Math.round(p.health.progress * 100)}% done
                {p.my_open_tasks > 0 && ` · ${pluralize(p.my_open_tasks, 'task')} for you`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function QuickLinks() {
  const ws = useWorkspace()
  const links = [
    { to: 'my-tasks', label: 'My tasks', icon: CheckCircle2 },
    { to: 'time', label: 'Timesheet', icon: Clock },
    { to: 'inbox', label: 'Inbox', icon: Inbox },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {links.map((l) => (
        <Link
          key={l.to}
          to={wsPath(ws, l.to)}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground shadow-elev-1 transition-colors hover:text-foreground"
        >
          <l.icon className="size-4" /> {l.label}
        </Link>
      ))}
    </div>
  )
}
