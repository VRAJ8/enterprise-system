import { AlertTriangle, CalendarClock, FolderKanban, LayoutGrid, Lock, Plus, Rows3 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace, wsPath } from '@/app/workspace'
import { usePortfolio, type Portfolio } from '@/api/hooks/insights'
import { useProjects, type Project } from '@/api/hooks/projects'
import { HEALTH_META, HealthBadge, ProjectIcon, type HealthStatus } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ProgressBar } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { daysFromToday, formatDate } from '@/lib/dates'
import { cn, pluralize } from '@/lib/utils'
import { CreateProjectDialog } from './CreateProjectDialog'

type Row = { project: Project; insight?: Portfolio['projects'][number] }
const FILTERS: { value: HealthStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'off_track', label: 'Off track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'on_track', label: 'On track' },
  { value: 'done', label: 'Done' },
]

export default function ProjectsPage() {
  const ws = useWorkspace()
  const projects = useProjects()
  const portfolio = usePortfolio()
  const [creating, setCreating] = React.useState(false)
  const [filter, setFilter] = React.useState<HealthStatus | 'all'>('all')
  const [layout, setLayout] = React.useState<'grid' | 'table'>(() => (localStorage.getItem('ph-projects-layout') as 'grid') || 'grid')

  const insightById = new Map(portfolio.data?.projects.map((p) => [p.project.id, p]))
  const rows: Row[] = (projects.data ?? [])
    .map((p) => ({ project: p, insight: insightById.get(p.id) }))
    .filter((r) => filter === 'all' || r.insight?.health.status === filter)
  const summary = portfolio.data?.summary ?? {}
  const canCreate = !ws.isGuest

  return (
    <>
      <PageHeader
        title="Projects"
        icon={FolderKanban}
        actions={
          <>
            <div className="hidden rounded-md border border-border p-0.5 sm:flex">
              {(['grid', 'table'] as const).map((l) => (
                <Button
                  key={l}
                  variant="ghost"
                  size="icon-xs"
                  className={cn(layout === l && 'bg-accent text-foreground')}
                  onClick={() => {
                    setLayout(l)
                    localStorage.setItem('ph-projects-layout', l)
                  }}
                  aria-label={`${l} layout`}
                >
                  {l === 'grid' ? <LayoutGrid /> : <Rows3 />}
                </Button>
              ))}
            </div>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New project
              </Button>
            )}
          </>
        }
      >
        {FILTERS.map((f) => {
          const n = f.value === 'all' ? projects.data?.length : summary[f.value]
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
                filter === f.value ? 'border-primary/40 bg-primary-soft text-primary' : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {f.value !== 'all' && <span className={cn('size-1.5 rounded-full', HEALTH_META[f.value].dot)} />}
              {f.label}
              {n != null && <span className="text-subtle">{n}</span>}
            </button>
          )
        })}
      </PageHeader>
      <PageBody className="p-4 sm:p-5">
        {projects.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : !projects.data?.length ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to plan work, track progress and see delivery risk early."
            action={canCreate && <Button onClick={() => setCreating(true)}>Create your first project</Button>}
          />
        ) : !rows.length ? (
          <EmptyState compact title="No projects with this health" />
        ) : layout === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <ProjectCard key={r.project.id} row={r} href={wsPath(ws, 'projects', r.project.key, 'overview')} />
            ))}
          </div>
        ) : (
          <ProjectTable rows={rows} base={(key) => wsPath(ws, 'projects', key, 'overview')} />
        )}
      </PageBody>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function TargetLabel({ date, forecast }: { date: string | null; forecast?: string | null }) {
  if (!date) return <span className="text-subtle">No target date</span>
  const late = forecast && forecast > date
  const days = daysFromToday(date)
  return (
    <Tip content={forecast ? `Forecast to finish ${formatDate(forecast)}` : 'Not enough history to forecast yet'}>
      <span className={cn('inline-flex items-center gap-1', late ? 'text-warning' : 'text-muted-foreground')}>
        <CalendarClock className="size-3.5" />
        {formatDate(date)}
        {days >= 0 && <span className="text-subtle">· {days}d left</span>}
      </span>
    </Tip>
  )
}

function ProjectCard({ row, href }: { row: Row; href: string }) {
  const { project: p, insight } = row
  const progress = insight?.health.progress ?? 0
  const expected = insight?.health.expected_progress
  return (
    <Link
      to={href}
      className="group flex flex-col rounded-xl border border-border bg-surface p-4 shadow-elev-1 transition-all hover:-translate-y-0.5 hover:border-subtle/40 hover:shadow-elev-2"
    >
      <div className="flex items-start gap-3">
        <ProjectIcon project={p} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-semibold tracking-tight">{p.name}</h3>
            {p.visibility === 'private' && <Lock className="size-3 text-subtle" />}
          </div>
          <p className="font-mono text-2xs text-subtle">{p.key}</p>
        </div>
        {insight && <HealthBadge status={insight.health.status} reasons={insight.health.reasons} />}
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
        {insight?.health.reasons?.[0] ?? (p.description || 'No description')}
      </p>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-2xs text-muted-foreground">
          <span>{Math.round(progress * 100)}% complete</span>
          {expected != null && <span className="text-subtle">{Math.round(expected * 100)}% of time elapsed</span>}
        </div>
        <ProgressBar value={progress} marker={expected} />
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3 text-xs">
        <UserAvatar user={p.lead} size="sm" tooltip />
        <TargetLabel date={p.target_date} forecast={insight?.forecast_date} />
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {insight && insight.overdue > 0 && (
            <span className="inline-flex items-center gap-1 text-danger">
              <AlertTriangle className="size-3.5" /> {insight.overdue}
            </span>
          )}
          {insight && pluralize(insight.open, 'open task')}
        </span>
      </div>
    </Link>
  )
}

function ProjectTable({ rows, base }: { rows: Row[]; base: (key: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-elev-1">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-2 py-2 font-medium">Health</th>
            <th className="px-2 py-2 font-medium">Progress</th>
            <th className="px-2 py-2 font-medium">Lead</th>
            <th className="px-2 py-2 font-medium">Target</th>
            <th className="px-4 py-2 text-right font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ project: p, insight }) => (
            <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
              <td className="px-4 py-2.5">
                <Link to={base(p.key)} className="flex items-center gap-2 font-medium">
                  <ProjectIcon project={p} size="sm" /> {p.name}
                </Link>
              </td>
              <td className="px-2">{insight && <HealthBadge status={insight.health.status} reasons={insight.health.reasons} />}</td>
              <td className="w-40 px-2">
                <div className="flex items-center gap-2">
                  <ProgressBar value={insight?.health.progress ?? 0} marker={insight?.health.expected_progress} className="flex-1" />
                  <span className="w-8 text-right text-xs text-muted-foreground">{Math.round((insight?.health.progress ?? 0) * 100)}%</span>
                </div>
              </td>
              <td className="px-2">
                <UserAvatar user={p.lead} size="sm" tooltip />
              </td>
              <td className="px-2 text-xs">
                <TargetLabel date={p.target_date} forecast={insight?.forecast_date} />
              </td>
              <td className="px-4 text-right text-xs text-muted-foreground">
                {insight?.open ?? '–'}
                {!!insight?.overdue && <span className="ml-1.5 text-danger">({insight.overdue} late)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
