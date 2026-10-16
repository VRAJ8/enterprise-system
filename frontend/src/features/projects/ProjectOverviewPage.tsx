import { AlertTriangle, CalendarClock, Flag, Gauge, Megaphone, Timer, TrendingUp, Users } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useProjectInsights, type ProjectInsights } from '@/api/hooks/insights'
import { axisProps, CHART, ChartTooltip, Legend } from '@/components/charts'
import { HEALTH_META, HealthBadge } from '@/components/domain'
import { Markdown } from '@/components/Markdown'
import { TaskRow } from '@/components/task/TaskRow'
import { ProgressBar } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { format, formatDate, parseISO, timeAgo } from '@/lib/dates'
import { cn, pluralize } from '@/lib/utils'
import { useProjectContext } from './ProjectLayout'

const short = (iso: string) => format(parseISO(iso), 'MMM d')

export default function ProjectOverviewPage() {
  const { project } = useProjectContext()
  const q = useProjectInsights(project.id)
  const d = q.data

  if (!d) {
    return (
      <div className="grid gap-4 p-5 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-5">
        <HealthHero d={d} target={project.target_date} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Burn-up" icon={TrendingUp} className="lg:col-span-2" right={<Legend items={[{ label: 'Scope', color: CHART.muted, dashed: true }, { label: 'Completed', color: CHART.primary }]} />}>
            <Burnup d={d} />
          </Card>
          <Card title="Status mix" icon={Gauge}>
            <StatusMix d={d} />
          </Card>
          <Card title="Weekly throughput" icon={Timer} right={<Legend items={[{ label: 'Created', color: CHART.muted }, { label: 'Completed', color: CHART.primary }]} />}>
            <Throughput d={d} />
          </Card>
          <Card title="Needs attention" icon={AlertTriangle} className="lg:col-span-2" pad={false}>
            {d.at_risk_tasks.length ? (
              <div>
                {d.at_risk_tasks.map((t) => (
                  <TaskRow key={t.id} task={t} className="last:border-0" />
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Nothing overdue, blocked or about to slip. 🎉</p>
            )}
          </Card>
          <Card title="Workload in this project" icon={Users}>
            <People d={d} />
          </Card>
          <Card title="Milestones" icon={Flag}>
            <Milestones d={d} />
          </Card>
          <Card title="Latest status update" icon={Megaphone}>
            <LatestUpdate d={d} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({
  title,
  icon: Icon,
  right,
  className,
  pad = true,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  right?: React.ReactNode
  className?: string
  pad?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-border bg-surface shadow-elev-1', className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      <div className={cn('flex-1', pad && 'p-4')}>{children}</div>
    </section>
  )
}

function HealthHero({ d, target }: { d: ProjectInsights; target: string | null }) {
  const h = d.health
  const meta = HEALTH_META[h.status] ?? HEALTH_META.no_data
  const f = d.forecast
  const stats = [
    { label: 'Open', value: d.scope.open },
    { label: 'Done', value: d.scope.done },
    { label: 'Overdue', value: d.scope.overdue, tone: d.scope.overdue ? 'text-danger' : '' },
    { label: 'Blocked', value: d.scope.blocked, tone: d.scope.blocked ? 'text-warning' : '' },
    { label: 'Unassigned', value: d.scope.unassigned },
    { label: 'Cycle time', value: d.cycle_time_days != null ? `${d.cycle_time_days}d` : '–' },
  ]
  return (
    <section className={cn('rounded-xl border border-border p-5 shadow-elev-1', meta.bg)}>
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-[260px] flex-1">
          <div className="flex items-center gap-2">
            <HealthBadge status={h.status} />
            <span className="text-xs text-muted-foreground">computed from progress vs. schedule</span>
          </div>
          <ul className="mt-3 space-y-1">
            {(h.reasons ?? []).map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm">
                <span className={cn('size-1.5 rounded-full', meta.dot)} /> {r}
              </li>
            ))}
          </ul>
          <div className="mt-4 max-w-md">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{Math.round(h.progress * 100)}% complete</span>
              {h.expected_progress != null && <span>{Math.round(h.expected_progress * 100)}% of schedule elapsed</span>}
            </div>
            <ProgressBar value={h.progress} marker={h.expected_progress} className="h-2" />
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface/80 p-4 text-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" /> Forecast completion
          </p>
          {f.completion_date ? (
            <>
              <p className={cn('mt-1 text-xl font-semibold tracking-tight', f.will_miss_target && 'text-warning')}>
                {formatDate(f.completion_date)}
              </p>
              <p className="text-2xs text-subtle">
                range {formatDate(f.earliest)} – {formatDate(f.latest)} · {f.confidence} confidence
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                at {f.weekly_throughput} {f.weekly_throughput === 1 ? "task" : "tasks"}/week
                {target && (f.will_miss_target ? ` · after target (${formatDate(target)})` : ` · before target (${formatDate(target)})`)}
              </p>
            </>
          ) : (
            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
              {d.scope.open === 0 ? 'No open work left.' : 'Not enough completed work in the last 6 weeks to forecast yet.'}
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-surface/80 px-3 py-2">
            <p className="text-2xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', s.tone)}>{s.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Burnup({ d }: { d: ProjectInsights }) {
  if (d.burnup.length < 2) return <p className="text-sm text-muted-foreground">The chart fills in as work gets done.</p>
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={d.burnup} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.18} />
            <stop offset="100%" stopColor={CHART.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={short} minTickGap={32} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip content={<ChartTooltip formatLabel={(l) => formatDate(l)} />} cursor={{ stroke: CHART.grid }} />
        <Line type="stepAfter" dataKey="scope" name="Scope" stroke={CHART.muted} strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <Area type="monotone" dataKey="completed" name="Completed" stroke={CHART.primary} strokeWidth={2} fill="url(#burnFill)" activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function Throughput({ d }: { d: ProjectInsights }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={d.weekly} margin={{ top: 8, right: 0, bottom: 0, left: -24 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
        <XAxis dataKey="week_start" tickFormatter={short} {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip content={<ChartTooltip formatLabel={(l) => `Week of ${formatDate(l)}`} />} cursor={{ fill: 'hsl(var(--accent))' }} />
        <Bar dataKey="created" name="Created" fill={CHART.muted} fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={14} />
        <Bar dataKey="completed" name="Completed" fill={CHART.primary} radius={[4, 4, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function StatusMix({ d }: { d: ProjectInsights }) {
  const total = d.status_breakdown.reduce((n, s) => n + s.count, 0)
  if (!total) return <p className="text-sm text-muted-foreground">No tasks yet.</p>
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {d.status_breakdown
          .filter((s) => s.count)
          .map((s) => (
            <Tip key={s.status_id} content={`${s.name}: ${s.count}`}>
              <div style={{ width: `${(s.count / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
            </Tip>
          ))}
      </div>
      <ul className="space-y-1.5">
        {d.status_breakdown.map((s) => (
          <li key={s.status_id} className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="ml-auto tabular-nums">{s.count}</span>
            <span className="w-10 text-right text-2xs tabular-nums text-subtle">{Math.round((s.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function People({ d }: { d: ProjectInsights }) {
  if (!d.people.length) return <p className="text-sm text-muted-foreground">No open work is assigned yet.</p>
  const max = Math.max(...d.people.map((p) => p.estimate_hours), 1)
  return (
    <ul className="space-y-3">
      {d.people.map((p) => (
        <li key={p.user.id}>
          <div className="flex items-center gap-2 text-sm">
            <UserAvatar user={p.user} size="sm" />
            <span className="truncate">{p.user.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {pluralize(p.open_tasks, 'task')} · {p.estimate_hours}h
              {p.overdue > 0 && <span className="text-danger"> · {p.overdue} late</span>}
            </span>
          </div>
          <ProgressBar value={p.estimate_hours / max} className="mt-1.5 h-1" />
        </li>
      ))}
    </ul>
  )
}

function Milestones({ d }: { d: ProjectInsights }) {
  if (!d.milestones.length) return <p className="text-sm text-muted-foreground">No milestones. Add them in project settings to track key dates.</p>
  return (
    <ul className="space-y-3">
      {d.milestones.map((m) => (
        <li key={m.id}>
          <div className="flex items-center gap-2 text-sm">
            <Flag className={cn('size-3.5', m.completed_at ? 'text-success' : m.at_risk ? 'text-warning' : 'text-subtle')} />
            <span className="truncate font-medium">{m.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{m.due_date ? formatDate(m.due_date) : 'No date'}</span>
          </div>
          <ProgressBar value={m.task_total ? m.task_done / m.task_total : 0} className="mt-1.5 h-1" />
          <p className={cn('mt-1 text-2xs', m.at_risk ? 'text-warning' : 'text-subtle')}>
            {m.risk_reason ?? `${m.task_done}/${m.task_total} tasks done`}
          </p>
        </li>
      ))}
    </ul>
  )
}

function LatestUpdate({ d }: { d: ProjectInsights }) {
  const ws = useWorkspace()
  const { project } = useProjectContext()
  const u = d.latest_update
  if (!u) {
    return (
      <p className="text-sm text-muted-foreground">
        No updates yet.{' '}
        <Link to={wsPath(ws, 'projects', project.key, 'updates')} className="text-primary hover:underline">
          Post the first one
        </Link>
      </p>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <UserAvatar user={u.author} size="sm" />
        <span className="font-medium">{u.author?.name}</span>
        <span className="text-subtle">{timeAgo(u.created_at)}</span>
        <HealthBadge status={u.health} className="ml-auto" />
      </div>
      <Markdown className="mt-2 line-clamp-6 text-sm">{u.body}</Markdown>
      <Link to={wsPath(ws, 'projects', project.key, 'updates')} className="mt-2 inline-block text-xs text-primary hover:underline">
        All updates →
      </Link>
    </div>
  )
}
