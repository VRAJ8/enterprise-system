import { ChevronLeft, ChevronRight, Clock, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useMe } from '@/app/auth'
import { useTaskPanel } from '@/app/task-panel'
import { useWorkspace } from '@/app/workspace'
import { useWorkspaceTasks } from '@/api/hooks/tasks'
import { useDeleteTimeEntry, useLogTime, useTimeEntries, type TimeEntry } from '@/api/hooks/time'
import { useMembers } from '@/api/hooks/workspace'
import { ProjectIcon } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Picker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/UserAvatar'
import { addDays, format, formatMinutes, parseDuration, parseISO, toISODate, weekStart } from '@/lib/dates'
import { cn } from '@/lib/utils'

type Row = { taskId: string; ref: string; title: string; project: TimeEntry['project']; byDay: Record<string, number> }

export default function TimesheetPage() {
  const me = useMe()
  const ws = useWorkspace()
  const members = useMembers()
  const [start, setStart] = React.useState(() => weekStart())
  const [userId, setUserId] = React.useState(me.id)
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)))
  const entries = useTimeEntries({ user_id: userId, date_from: days[0], date_to: days[6] })
  const [extraTasks, setExtraTasks] = React.useState<Row[]>([])
  const mine = userId === me.id
  const person = members.data?.find((m) => m.user.id === userId)
  const capacity = Number(person?.weekly_capacity_hours ?? 40)

  const rows = React.useMemo(() => {
    const map = new Map<string, Row>()
    for (const e of entries.data ?? []) {
      const day = toISODate(parseISO(e.started_at))
      const r = map.get(e.task.id) ?? { taskId: e.task.id, ref: e.task.ref, title: e.task.title, project: e.project, byDay: {} }
      r.byDay[day] = (r.byDay[day] ?? 0) + e.minutes
      map.set(e.task.id, r)
    }
    for (const x of extraTasks) if (!map.has(x.taskId)) map.set(x.taskId, x)
    return [...map.values()]
  }, [entries.data, extraTasks])

  const dayTotal = (d: string) => rows.reduce((n, r) => n + (r.byDay[d] ?? 0), 0)
  const weekTotal = days.reduce((n, d) => n + dayTotal(d), 0)
  const today = toISODate(new Date())

  return (
    <>
      <PageHeader title="Timesheet" icon={Clock}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setStart((s) => addDays(s, -7))} aria-label="Previous week">
            <ChevronLeft />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-medium">
            {format(start, 'MMM d')} – {format(addDays(start, 6), 'MMM d, yyyy')}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setStart((s) => addDays(s, 7))} aria-label="Next week">
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(weekStart())}>
            This week
          </Button>
        </div>
        {(ws.isAdmin || (members.data?.length ?? 0) > 1) && (
          <Picker
            options={(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name, icon: <UserAvatar user={m.user} size="sm" /> }))}
            value={userId}
            onChange={(v) => {
              setUserId(v)
              setExtraTasks([])
            }}
          >
            <Button variant="outline" size="sm">
              <UserAvatar user={person?.user ?? me} size="sm" /> {mine ? 'My time' : person?.user.name}
            </Button>
          </Picker>
        )}
        <div className="ml-auto text-sm">
          <span className="font-semibold tabular-nums">{formatMinutes(weekTotal) || '0m'}</span>
          <span className="text-muted-foreground"> / {capacity}h</span>
        </div>
      </PageHeader>
      <PageBody className="p-4 sm:p-5">
        {entries.isLoading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-elev-1">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-[38%] px-4 py-2.5 text-left font-medium">Task</th>
                  {days.map((d) => (
                    <th key={d} className={cn('px-1 py-2.5 text-center font-medium', d === today && 'text-primary')}>
                      {format(parseISO(d), 'EEE')}
                      <span className="block text-2xs font-normal text-subtle">{format(parseISO(d), 'MMM d')}</span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <TaskLine key={r.taskId} row={r} days={days} today={today} editable={mine} />
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={9}>
                      {/* Pinned to the visible width so it stays readable while the table scrolls sideways on phones */}
                      <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))]">
                        <EmptyState compact icon={Clock} title="No time logged this week" description="Start a timer from any task, or add a row below." />
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                {mine && (
                  <tr className="border-t border-border/60">
                    <td colSpan={9} className="px-3 py-2">
                      <AddRow onAdd={(r) => setExtraTasks((x) => [...x, r])} exclude={rows.map((r) => r.taskId)} />
                    </td>
                  </tr>
                )}
                <tr className="border-t border-border bg-muted/30 text-xs font-medium">
                  <td className="px-4 py-2.5 text-muted-foreground">Daily total</td>
                  {days.map((d) => {
                    const m = dayTotal(d)
                    const over = m > (capacity / 5) * 60 * 1.25
                    return (
                      <td key={d} className={cn('py-2.5 text-center tabular-nums', over && 'text-warning')}>
                        {m ? formatMinutes(m) : '–'}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMinutes(weekTotal) || '0m'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <EntryList entries={entries.data ?? []} editable={mine || ws.isAdmin} />
      </PageBody>
    </>
  )
}

function TaskLine({ row, days, today, editable }: { row: Row; days: string[]; today: string; editable: boolean }) {
  const panel = useTaskPanel()
  const total = days.reduce((n, d) => n + (row.byDay[d] ?? 0), 0)
  return (
    <tr className="border-b border-border/50 hover:bg-accent/30">
      <td className="px-4 py-1.5">
        <button onClick={() => panel.open(row.ref)} className="flex min-w-0 items-center gap-2 text-left">
          <ProjectIcon project={row.project} size="sm" />
          <span className="shrink-0 font-mono text-2xs text-subtle">{row.ref}</span>
          <span className="truncate hover:underline">{row.title}</span>
        </button>
      </td>
      {days.map((d) => (
        <td key={d} className={cn('px-1 py-1', d === today && 'bg-primary-soft/30')}>
          <Cell taskId={row.taskId} day={d} minutes={row.byDay[d] ?? 0} editable={editable} />
        </td>
      ))}
      <td className="px-4 text-right font-medium tabular-nums">{formatMinutes(total)}</td>
    </tr>
  )
}

function Cell({ taskId, day, minutes, editable }: { taskId: string; day: string; minutes: number; editable: boolean }) {
  const log = useLogTime(taskId)
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState('')
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="+1h"
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
          if (e.key === 'Enter') {
            const m = parseDuration(value.replace(/^\+/, ''))
            if (!m) return toast.error('Try 30m, 1h or 1:30')
            log.mutate({ minutes: m, date: day, note: '' })
            setEditing(false)
          }
        }}
        className="h-9 w-full rounded-md border border-ring bg-background text-center text-xs outline-none"
      />
    )
  }
  return (
    <button
      disabled={!editable}
      onClick={() => {
        setValue('')
        setEditing(true)
      }}
      title={editable ? 'Add time for this day' : undefined}
      className={cn(
        'h-9 w-full rounded-md text-center text-xs tabular-nums transition-colors',
        minutes ? 'bg-primary/10 font-medium text-foreground' : 'text-subtle',
        editable && 'hover:ring-1 hover:ring-border',
      )}
    >
      {minutes ? formatMinutes(minutes) : editable ? '+' : '–'}
    </button>
  )
}

function AddRow({ onAdd, exclude }: { onAdd: (r: Row) => void; exclude: string[] }) {
  const tasks = useWorkspaceTasks({ assignee: 'me', state: 'open' })
  const options = (tasks.data?.items ?? [])
    .filter((t) => !exclude.includes(t.id))
    .map((t) => ({ value: t.id, label: `${t.ref} ${t.title}`, icon: <ProjectIcon project={t.project} size="sm" /> }))
  return (
    <Picker
      options={options}
      value={null}
      placeholder="Find one of your tasks…"
      emptyText="No other open tasks assigned to you"
      onChange={(id) => {
        const t = tasks.data?.items.find((x) => x.id === id)
        if (t) onAdd({ taskId: t.id, ref: t.ref, title: t.title, project: t.project, byDay: {} })
      }}
    >
      <Button variant="ghost" size="sm">
        <Plus /> Add task row
      </Button>
    </Picker>
  )
}

function EntryList({ entries, editable }: { entries: TimeEntry[]; editable: boolean }) {
  const del = useDeleteTimeEntry()
  if (!entries.length) return null
  const sorted = [...entries].sort((a, b) => b.started_at.localeCompare(a.started_at))
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-medium">Entries</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
        {sorted.map((e) => (
          <div key={e.id} className="group flex items-center gap-3 border-b border-border/50 px-4 py-2 text-sm last:border-0">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{format(parseISO(e.started_at), 'EEE MMM d')}</span>
            <span className="shrink-0 font-mono text-2xs text-subtle">{e.task.ref}</span>
            <span className="min-w-0 flex-1 truncate">
              {e.task.title}
              {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
            </span>
            {e.running && <span className="rounded-full bg-primary/10 px-2 text-2xs font-medium text-primary">running</span>}
            <span className="w-16 text-right font-medium tabular-nums">{formatMinutes(e.minutes)}</span>
            {editable && !e.running && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => del.mutate(e)}
                aria-label="Delete entry"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
