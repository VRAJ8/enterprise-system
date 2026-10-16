/**
 * Task filters shared by board, list, timeline and My Tasks.
 * State lives in the URL (?assignee=me&priority=high,urgent&q=...) so views are linkable.
 * Filtering happens client-side on the already-loaded task list for instant feedback.
 */
import { CalendarClock, Filter, Search, Tag, User, X } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMe } from '@/app/auth'
import type { Task } from '@/api/hooks/tasks'
import { useLabels, useMembers } from '@/api/hooks/workspace'
import { PRIORITIES, PRIORITY_LABEL, PriorityIcon, isClosed, type Priority } from '@/components/domain'
import { MultiPicker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/UserAvatar'
import { daysFromToday } from '@/lib/dates'
import { cn } from '@/lib/utils'

export type DueFilter = 'overdue' | 'today' | 'week' | 'none'

export interface TaskFilterState {
  q: string
  assignees: string[] // user ids, 'me', 'unassigned'
  priorities: Priority[]
  labels: string[]
  due: DueFilter | null
  showClosed: boolean
}

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])

export function useTaskFilters(defaults: Partial<TaskFilterState> = {}) {
  const [params, setParams] = useSearchParams()
  const state: TaskFilterState = {
    q: params.get('q') ?? defaults.q ?? '',
    assignees: params.has('assignee') ? list(params.get('assignee')) : (defaults.assignees ?? []),
    priorities: (params.has('priority') ? list(params.get('priority')) : (defaults.priorities ?? [])) as Priority[],
    labels: params.has('label') ? list(params.get('label')) : (defaults.labels ?? []),
    due: (params.get('due') as DueFilter | null) ?? defaults.due ?? null,
    showClosed: params.has('closed') ? params.get('closed') === '1' : (defaults.showClosed ?? true),
  }

  const update = React.useCallback(
    (patch: Partial<TaskFilterState>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const set = (k: string, v: string | null) => (v ? next.set(k, v) : next.delete(k))
          if ('q' in patch) set('q', patch.q || null)
          if (patch.assignees) set('assignee', patch.assignees.join(',') || null)
          if (patch.priorities) set('priority', patch.priorities.join(',') || null)
          if (patch.labels) set('label', patch.labels.join(',') || null)
          if ('due' in patch) set('due', patch.due ?? null)
          if ('showClosed' in patch) next.set('closed', patch.showClosed ? '1' : '0')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const clear = React.useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          ;['q', 'assignee', 'priority', 'label', 'due'].forEach((k) => next.delete(k))
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const active = !!(state.q || state.assignees.length || state.priorities.length || state.labels.length || state.due)
  return { filters: state, update, clear, active }
}

export function applyTaskFilters(tasks: Task[], f: TaskFilterState, meId: string): Task[] {
  const q = f.q.trim().toLowerCase()
  return tasks.filter((t) => {
    if (!f.showClosed && isClosed(t.status.category)) return false
    if (q && !t.title.toLowerCase().includes(q) && !t.ref.toLowerCase().includes(q)) return false
    if (f.assignees.length) {
      const ok = f.assignees.some((a) =>
        a === 'unassigned' ? !t.assignee : a === 'me' ? t.assignee?.id === meId : t.assignee?.id === a,
      )
      if (!ok) return false
    }
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false
    if (f.labels.length && !t.labels.some((l) => f.labels.includes(l.id))) return false
    if (f.due) {
      if (f.due === 'none') return !t.due_date
      if (!t.due_date) return false
      const n = daysFromToday(t.due_date)
      if (f.due === 'overdue' && !(t.is_overdue)) return false
      if (f.due === 'today' && n !== 0) return false
      if (f.due === 'week' && (n < 0 || n > 7)) return false
    }
    return true
  })
}

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No due date' },
]

const Chip = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>(function Chip(
  { active, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors [&_svg]:size-3.5',
        active
          ? 'border-primary/40 bg-primary-soft text-primary'
          : 'border-dashed border-border text-muted-foreground hover:border-subtle/50 hover:text-foreground',
      )}
      {...props}
    >
      {children}
    </button>
  )
})

/** Filter toolbar. `hideAssignee` for views that are already per-person (My Tasks). */
export function FilterBar({
  state,
  hideAssignee,
  right,
  className,
  searchRef,
}: {
  state: ReturnType<typeof useTaskFilters>
  hideAssignee?: boolean
  right?: React.ReactNode
  className?: string
  searchRef?: React.RefObject<HTMLInputElement>
}) {
  const { filters, update, clear, active } = state
  const me = useMe()
  const members = useMembers()
  const labels = useLabels()
  const people = [
    { value: 'me', label: 'Me', icon: <UserAvatar user={me} size="sm" /> },
    { value: 'unassigned', label: 'Unassigned', icon: <UserAvatar user={null} size="sm" /> },
    ...(members.data ?? [])
      .filter((m) => m.user.id !== me.id)
      .map((m) => ({ value: m.user.id, label: m.user.name, icon: <UserAvatar user={m.user} size="sm" /> })),
  ]
  const toggle = <T extends string>(arr: T[], v: T, on: boolean) => (on ? [...arr, v] : arr.filter((x) => x !== v))
  const assigneeLabel = filters.assignees.length === 1 ? people.find((p) => p.value === filters.assignees[0])?.label : null

  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-1.5', className)}>
      <div className="relative w-44 shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          ref={searchRef}
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && (update({ q: '' }), e.currentTarget.blur())}
          placeholder="Filter tasks…"
          className="h-7 pl-7 text-xs"
        />
      </div>
      {!hideAssignee && (
        <MultiPicker
          options={people}
          values={filters.assignees}
          onToggle={(v, on) => update({ assignees: toggle(filters.assignees, v, on) })}
          placeholder="Filter by assignee…"
        >
          <Chip active={filters.assignees.length > 0}>
            <User />
            {filters.assignees.length === 0 ? 'Assignee' : (assigneeLabel ?? `${filters.assignees.length} people`)}
          </Chip>
        </MultiPicker>
      )}
      <MultiPicker
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
        values={filters.priorities}
        onToggle={(v, on) => update({ priorities: toggle(filters.priorities, v as Priority, on) })}
        placeholder="Filter by priority…"
      >
        <Chip active={filters.priorities.length > 0}>
          <Filter />
          {filters.priorities.length === 0
            ? 'Priority'
            : filters.priorities.length === 1
              ? PRIORITY_LABEL[filters.priorities[0]]
              : `${filters.priorities.length} priorities`}
        </Chip>
      </MultiPicker>
      <MultiPicker
        options={(labels.data ?? []).map((l) => ({
          value: l.id,
          label: l.name,
          icon: <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />,
        }))}
        values={filters.labels}
        onToggle={(v, on) => update({ labels: toggle(filters.labels, v, on) })}
        placeholder="Filter by label…"
      >
        <Chip active={filters.labels.length > 0}>
          <Tag />
          {filters.labels.length === 0 ? 'Label' : `${filters.labels.length} label${filters.labels.length > 1 ? 's' : ''}`}
        </Chip>
      </MultiPicker>
      <MultiPicker
        options={DUE_OPTIONS}
        values={filters.due ? [filters.due] : []}
        onToggle={(v, on) => update({ due: on ? (v as DueFilter) : null })}
        placeholder="Due…"
      >
        <Chip active={!!filters.due}>
          <CalendarClock />
          {DUE_OPTIONS.find((d) => d.value === filters.due)?.label ?? 'Due'}
        </Chip>
      </MultiPicker>
      {active && (
        <Button variant="ghost" size="xs" onClick={clear} className="shrink-0 text-muted-foreground">
          <X /> Clear
        </Button>
      )}
      {right && <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  )
}
