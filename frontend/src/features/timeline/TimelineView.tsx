import { CalendarRange, Flag } from 'lucide-react'
import * as React from 'react'
import { useTaskPanel } from '@/app/task-panel'
import { useMilestones } from '@/api/hooks/projects'
import { useProjectTasks, useUpdateTask, type Task } from '@/api/hooks/tasks'
import { isClosed, StatusIcon } from '@/components/domain'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { addDays, format, formatDate, parseISO, toISODate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useProjectContext } from '@/features/projects/ProjectLayout'

const ZOOM = { week: 40, month: 16, quarter: 6 } as const
type Zoom = keyof typeof ZOOM
const ROW = 36
const dayDiff = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000)

/** Gantt view: drag a bar to move it, drag its right edge to change the due date. */
export default function TimelineView() {
  const { project, canEdit } = useProjectContext()
  const tasks = useProjectTasks(project.id)
  const milestones = useMilestones(project.id)
  const update = useUpdateTask()
  const panel = useTaskPanel()
  const [zoom, setZoom] = React.useState<Zoom>('month')
  const [drag, setDrag] = React.useState<{ id: string; mode: 'move' | 'end'; x0: number; delta: number } | null>(null)
  const scroller = React.useRef<HTMLDivElement>(null)
  const px = ZOOM[zoom]

  const all = tasks.data?.items ?? []
  const scheduled = all
    .filter((t) => t.due_date)
    .sort((a, b) => (a.start_date ?? a.due_date!).localeCompare(b.start_date ?? b.due_date!))
  const unscheduled = all.filter((t) => !t.due_date && !isClosed(t.status.category))

  const today = toISODate(new Date())
  const dates = [
    today,
    project.start_date,
    project.target_date,
    ...scheduled.flatMap((t) => [t.start_date ?? t.due_date!, t.due_date!]),
    ...(milestones.data ?? []).map((m) => m.due_date),
  ].filter(Boolean) as string[]
  const min = toISODate(addDays(parseISO(dates.reduce((a, b) => (a < b ? a : b))), -7))
  const max = toISODate(addDays(parseISO(dates.reduce((a, b) => (a > b ? a : b))), 21))
  const totalDays = dayDiff(min, max) + 1
  const x = (d: string) => dayDiff(min, d) * px

  React.useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - 240)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, tasks.isSuccess])

  React.useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setDrag((d) => d && { ...d, delta: Math.round((e.clientX - d.x0) / px) })
    const up = () => {
      setDrag((d) => {
        if (d && d.delta) {
          const t = all.find((x) => x.id === d.id)
          if (t?.due_date) {
            const due = toISODate(addDays(parseISO(t.due_date), d.delta))
            const start = t.start_date ? toISODate(addDays(parseISO(t.start_date), d.delta)) : null
            if (d.mode === 'move') update.mutate({ id: t.id, due_date: due, start_date: start })
            else if (!t.start_date || due >= t.start_date) update.mutate({ id: t.id, due_date: due })
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, px, all, update])

  if (tasks.isLoading) return <Skeleton className="m-5 h-96 rounded-xl" />
  if (!scheduled.length) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing scheduled yet"
        description="Give tasks a due date (and optionally a start date) to see them on the timeline."
      />
    )
  }

  // Header ticks: months always, plus weeks/days depending on zoom
  const months: { label: string; left: number; width: number }[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(parseISO(min), i)
    if (i === 0 || d.getDate() === 1) months.push({ label: format(d, 'MMMM yyyy'), left: i * px, width: 0 })
  }
  months.forEach((m, i) => (m.width = (months[i + 1]?.left ?? totalDays * px) - m.left))
  const ticks = Array.from({ length: totalDays }, (_, i) => addDays(parseISO(min), i)).filter((d) =>
    zoom === 'week' ? true : zoom === 'month' ? d.getDay() === 1 : d.getDate() === 1,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-xs sm:px-5">
        <span className="text-muted-foreground">
          {scheduled.length} scheduled{unscheduled.length > 0 && ` · ${unscheduled.length} open without a due date`}
        </span>
        <div className="ml-auto flex rounded-md border border-border p-0.5">
          {(Object.keys(ZOOM) as Zoom[]).map((z) => (
            <button key={z} onClick={() => setZoom(z)} className={cn('h-6 rounded px-2 capitalize', zoom === z ? 'bg-accent font-medium' : 'text-muted-foreground')}>
              {z}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-hidden border-r border-border/60 bg-surface">
          <div className="h-14 border-b border-border/60" />
          {scheduled.map((t) => (
            <button
              key={t.id}
              onClick={() => panel.open(t.ref)}
              style={{ height: ROW }}
              className="flex w-full items-center gap-2 border-b border-border/40 px-3 text-left text-sm hover:bg-accent/40"
            >
              <StatusIcon category={t.status.category} color={t.status.color} />
              <span className="shrink-0 whitespace-nowrap font-mono text-2xs text-subtle">{t.ref}</span>
              <span className="truncate">{t.title}</span>
            </button>
          ))}
        </div>
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-auto" onScroll={(e) => {
          const left = e.currentTarget.previousElementSibling as HTMLElement | null
          if (left) left.scrollTop = e.currentTarget.scrollTop
        }}>
          <div style={{ width: totalDays * px }} className="relative">
            <div className="sticky top-0 z-10 h-14 border-b border-border/60 bg-surface/95 backdrop-blur">
              {months.map((m) => (
                <div key={m.left} style={{ left: m.left, width: m.width }} className="absolute top-0 h-7 truncate border-l border-border/60 px-2 pt-1.5 text-xs font-medium">
                  {m.label}
                </div>
              ))}
              {ticks.map((d) => (
                <div key={d.toISOString()} style={{ left: dayDiff(min, toISODate(d)) * px }} className="absolute top-7 h-7 border-l border-border/40 px-1 pt-1.5 text-2xs text-subtle">
                  {zoom === 'quarter' ? format(d, 'MMM') : format(d, zoom === 'week' ? 'd' : 'MMM d')}
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: scheduled.length * ROW }}>
              {ticks.map((d) => (
                <div key={d.toISOString()} style={{ left: dayDiff(min, toISODate(d)) * px }} className="absolute inset-y-0 border-l border-border/30" />
              ))}
              {project.target_date && (
                <div style={{ left: x(project.target_date) + px }} className="absolute inset-y-0 border-l-2 border-dashed border-danger/50" title="Project target date" />
              )}
              <div style={{ left: x(today) + px / 2 }} className="absolute inset-y-0 z-[1] w-px bg-primary">
                <span className="absolute -top-0 -translate-x-1/2 rounded bg-primary px-1 text-2xs text-primary-foreground">Today</span>
              </div>
              {(milestones.data ?? []).filter((m) => m.due_date).map((m) => (
                <Tip key={m.id} content={`${m.name} · ${formatDate(m.due_date)}`}>
                  <div style={{ left: x(m.due_date!) + px / 2 - 7 }} className="absolute top-1 z-[2] text-warning">
                    <Flag className="size-3.5 fill-current" />
                  </div>
                </Tip>
              ))}
              {scheduled.map((t, i) => (
                <Bar
                  key={t.id}
                  task={t}
                  top={i * ROW}
                  left={x(t.start_date ?? t.due_date!)}
                  width={(dayDiff(t.start_date ?? t.due_date!, t.due_date!) + 1) * px}
                  px={px}
                  drag={drag?.id === t.id ? drag : null}
                  canEdit={canEdit}
                  onOpen={() => panel.open(t.ref)}
                  onDragStart={(mode, x0) => setDrag({ id: t.id, mode, x0, delta: 0 })}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Bar({
  task,
  top,
  left,
  width,
  px,
  drag,
  canEdit,
  onOpen,
  onDragStart,
}: {
  task: Task
  top: number
  left: number
  width: number
  px: number
  drag: { mode: 'move' | 'end'; delta: number } | null
  canEdit: boolean
  onOpen: () => void
  onDragStart: (mode: 'move' | 'end', x0: number) => void
}) {
  const closed = isClosed(task.status.category)
  const shift = drag?.mode === 'move' ? drag.delta * px : 0
  const grow = drag?.mode === 'end' ? drag.delta * px : 0
  const moved = React.useRef(false)
  return (
    <div style={{ top: top + 6, left: left + shift, width: Math.max(px, width + grow), height: ROW - 12 }} className="absolute">
      <Tip content={`${task.ref} · ${task.title} · ${task.start_date ? `${formatDate(task.start_date)} → ` : ''}${formatDate(task.due_date)}`}>
        <div
          onPointerDown={(e) => {
            if (!canEdit) return
            moved.current = false
            onDragStart('move', e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) moved.current = true
          }}
          onClick={() => {
            if (moved.current) moved.current = false
            else onOpen()
          }}
          className={cn(
            'group flex h-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-xs font-medium shadow-elev-1 transition-shadow',
            canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
            closed ? 'bg-muted text-muted-foreground' : task.is_overdue ? 'bg-danger/15 text-danger ring-1 ring-danger/30' : 'bg-primary/15 text-foreground ring-1 ring-primary/30',
            drag && 'shadow-elev-3 ring-2 ring-primary',
          )}
          style={!closed && !task.is_overdue ? { background: `${task.status.color}26` } : undefined}
        >
          {task.assignee && <UserAvatar user={task.assignee} size="xs" />}
          <span className="truncate">{task.title}</span>
        </div>
      </Tip>
      {canEdit && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation()
            onDragStart('end', e.clientX)
          }}
          className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize rounded-r-md hover:bg-primary/40"
          aria-label="Drag to change due date"
        />
      )}
    </div>
  )
}
