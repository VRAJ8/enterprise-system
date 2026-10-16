import { BarChart3, Clock, FolderKanban } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWorkspace, wsPath } from '@/app/workspace'
import { usePortfolio, useTimeReport } from '@/api/hooks/insights'
import { axisProps, CHART, ChartTooltip } from '@/components/charts'
import { HEALTH_META, HealthBadge, ProjectIcon, type HealthStatus } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { ProgressBar } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/UserAvatar'
import { addDays, format, formatDate, formatMinutes, parseISO, toISODate, weekStart } from '@/lib/dates'
import { cn } from '@/lib/utils'

const RANGES = [
  { key: 'week', label: 'This week', from: () => weekStart(), days: 7 },
  { key: '2w', label: 'Last 2 weeks', from: () => addDays(weekStart(), -7), days: 14 },
  { key: 'month', label: 'Last 30 days', from: () => addDays(new Date(), -29), days: 30 },
]
const ORDER: HealthStatus[] = ['off_track', 'at_risk', 'on_track', 'not_started', 'done']

export default function InsightsPage() {
  const [range, setRange] = React.useState(RANGES[0])
  const from = range.from()
  const time = useTimeReport({ date_from: toISODate(from), date_to: toISODate(addDays(from, range.days - 1)) })
  return (
    <>
      <PageHeader title="Insights" icon={BarChart3}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r)}
            className={cn('h-7 rounded-md px-2.5 text-xs font-medium', range.key === r.key ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60')}
          >
            {r.label}
          </button>
        ))}
      </PageHeader>
      <PageBody>
        <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-5">
          <Portfolio />
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-border bg-surface p-4 shadow-elev-1 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Time logged per day</h3>
                <span className="ml-auto text-sm font-semibold tabular-nums">{formatMinutes(time.data?.total_minutes ?? 0)}</span>
              </div>
              {time.data ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={time.data.by_day.map((d) => ({ ...d, hours: Math.round((d.minutes / 60) * 10) / 10 }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => format(parseISO(d), range.days > 7 ? 'MMM d' : 'EEE')} minTickGap={16} {...axisProps} />
                    <YAxis {...axisProps} unit="h" />
                    <Tooltip content={<ChartTooltip formatLabel={(l) => formatDate(l, true)} formatValue={(v) => `${v}h`} />} cursor={{ fill: 'hsl(var(--accent))' }} />
                    <Bar dataKey="hours" name="Logged" fill={CHART.primary} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Skeleton className="h-[220px]" />
              )}
            </section>
            <section className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
              <h3 className="mb-3 text-sm font-medium">By project</h3>
              <div className="space-y-3">
                {(time.data?.by_project ?? []).map((p) => (
                  <div key={p.project.id}>
                    <div className="flex items-center gap-2 text-sm">
                      <ProjectIcon project={p.project} size="sm" />
                      <span className="truncate">{p.project.name}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{formatMinutes(p.minutes)}</span>
                    </div>
                    <ProgressBar value={time.data!.total_minutes ? p.minutes / time.data!.total_minutes : 0} className="mt-1.5 h-1" />
                  </div>
                ))}
                {time.data && !time.data.by_project.length && <p className="text-sm text-muted-foreground">No time logged in this range.</p>}
              </div>
            </section>
          </div>
          <section className="rounded-xl border border-border bg-surface shadow-elev-1">
            <h3 className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">Utilisation (logged ÷ capacity)</h3>
            <div className="divide-y divide-border/50">
              {(time.data?.by_user ?? []).map((u) => (
                <div key={u.user.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <UserAvatar user={u.user} size="sm" />
                  <span className="w-40 truncate">{u.user.name}</span>
                  <ProgressBar
                    value={Math.min(1, u.utilization)}
                    className="h-2 flex-1"
                    indicatorClassName={u.utilization > 1.05 ? 'bg-warning' : undefined}
                  />
                  <span className="w-32 text-right text-xs tabular-nums text-muted-foreground">
                    {formatMinutes(u.minutes)} / {formatMinutes(u.capacity_minutes)}
                  </span>
                  <span className={cn('w-12 text-right text-xs font-medium tabular-nums', u.utilization > 1.05 && 'text-warning')}>
                    {Math.round(u.utilization * 100)}%
                  </span>
                </div>
              ))}
              {time.data && !time.data.by_user.length && <p className="px-4 py-3 text-sm text-muted-foreground">No time logged in this range.</p>}
            </div>
          </section>
        </div>
      </PageBody>
    </>
  )
}

function Portfolio() {
  const ws = useWorkspace()
  const q = usePortfolio()
  if (!q.data) return <Skeleton className="h-64 rounded-xl" />
  const total = q.data.projects.length || 1
  return (
    <section className="rounded-xl border border-border bg-surface shadow-elev-1">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <FolderKanban className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Portfolio health</h3>
      </div>
      <div className="p-4">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {ORDER.filter((s) => q.data.summary[s]).map((s) => (
            <div key={s} className={cn('h-full', HEALTH_META[s].dot)} style={{ width: `${(q.data.summary[s] / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {ORDER.filter((s) => q.data.summary[s]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', HEALTH_META[s].dot)} />
              {HEALTH_META[s].label} <span className="font-medium text-foreground">{q.data.summary[s]}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="border-y border-border/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-2 py-2 font-medium">Health</th>
              <th className="px-2 py-2 font-medium">Why</th>
              <th className="px-2 py-2 font-medium">Target</th>
              <th className="px-4 py-2 text-right font-medium">Forecast</th>
            </tr>
          </thead>
          <tbody>
            {q.data.projects.map((p) => (
              <tr key={p.project.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <Link to={wsPath(ws, 'projects', p.project.key, 'overview')} className="flex items-center gap-2 font-medium hover:underline">
                    <ProjectIcon project={p.project} size="sm" /> {p.project.name}
                  </Link>
                </td>
                <td className="px-2">
                  <HealthBadge status={p.health.status} />
                </td>
                <td className="max-w-xs truncate px-2 text-xs text-muted-foreground">{p.health.reasons?.join(' · ')}</td>
                <td className="px-2 text-xs">{p.target_date ? formatDate(p.target_date) : '–'}</td>
                <td
                  className={cn(
                    'px-4 text-right text-xs',
                    p.forecast_date && p.target_date && p.forecast_date > p.target_date ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {p.forecast_date ? formatDate(p.forecast_date) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
