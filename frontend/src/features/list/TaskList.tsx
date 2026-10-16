import { ChevronRight, Plus } from 'lucide-react'
import * as React from 'react'
import type { Status } from '@/api/hooks/projects'
import type { Task } from '@/api/hooks/tasks'
import { BulkBar } from '@/components/task/BulkBar'
import { TaskRow } from '@/components/task/TaskRow'
import { CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, PriorityIcon, StatusIcon, type StatusCategory } from '@/components/domain'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/UserAvatar'
import { cn } from '@/lib/utils'
import { buildRows, compareTasks, DUE_BUCKET_ORDER, DUE_BUCKETS, dueBucket, TONE_TEXT, type GroupBy, type OrderBy } from './grouping'
import { useTaskSelection } from './useTaskSelection'

interface Group {
  key: string
  label: string
  icon: React.ReactNode
  tasks: Task[]
  /** Defaults for "add task" from this group's header */
  add?: { statusId?: string; assigneeId?: string | null }
}

const CATEGORY_ORDER: StatusCategory[] = ['in_progress', 'review', 'todo', 'backlog', 'done', 'canceled']

function groupTasks(tasks: Task[], groupBy: GroupBy, statuses?: Status[]): Group[] {
  if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', icon: null, tasks }]
  if (groupBy === 'status' && statuses) {
    return [...statuses]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: s.id,
        label: s.name,
        icon: <StatusIcon category={s.category} color={s.color} />,
        tasks: tasks.filter((t) => t.status.id === s.id),
        add: { statusId: s.id },
      }))
  }
  if (groupBy === 'status') {
    return CATEGORY_ORDER.map((c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      icon: <StatusIcon category={c} color="" />,
      tasks: tasks.filter((t) => t.status.category === c),
    }))
  }
  if (groupBy === 'priority') {
    return PRIORITIES.map((p) => ({
      key: p,
      label: PRIORITY_LABEL[p],
      icon: <PriorityIcon priority={p} />,
      tasks: tasks.filter((t) => t.priority === p),
    }))
  }
  if (groupBy === 'due') {
    return DUE_BUCKET_ORDER.map((b) => {
      const meta = DUE_BUCKETS[b]
      return {
        key: b,
        label: meta.label,
        icon: <meta.icon className={cn('size-3.5', TONE_TEXT[meta.tone])} />,
        tasks: tasks.filter((t) => dueBucket(t) === b),
      }
    })
  }
  const people = new Map<string, Group>()
  const none: Group = { key: 'none', label: 'Unassigned', icon: <UserAvatar user={null} size="sm" />, tasks: [], add: { assigneeId: null } }
  for (const t of tasks) {
    if (!t.assignee) {
      none.tasks.push(t)
      continue
    }
    const g: Group = people.get(t.assignee.id) ?? {
      key: t.assignee.id,
      label: t.assignee.name,
      icon: <UserAvatar user={t.assignee} size="sm" />,
      tasks: [],
      add: { assigneeId: t.assignee.id },
    }
    g.tasks.push(t)
    people.set(t.assignee.id, g)
  }
  return [...[...people.values()].sort((a, b) => a.label.localeCompare(b.label)), none]
}

/** Grouped, keyboard-navigable, multi-selectable task list. */
export function TaskList({
  tasks,
  groupBy,
  orderBy,
  statuses,
  showProject,
  canEdit = true,
  hideEmptyGroups,
  onAdd,
  empty,
}: {
  tasks: Task[]
  groupBy: GroupBy
  orderBy: OrderBy
  statuses?: Status[]
  showProject?: boolean
  canEdit?: boolean
  hideEmptyGroups?: boolean
  onAdd?: (defaults: Group['add']) => void
  empty?: React.ReactNode
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const cmp = React.useMemo(() => compareTasks(orderBy), [orderBy])
  const groups = React.useMemo(() => {
    const all = groupTasks(tasks, groupBy, statuses)
    return hideEmptyGroups || groupBy === 'assignee' ? all.filter((g) => g.tasks.length) : all
  }, [tasks, groupBy, statuses, hideEmptyGroups])
  const rendered = React.useMemo(
    () => groups.map((g) => ({ ...g, rows: buildRows(g.tasks, cmp, groupBy !== 'assignee') })),
    [groups, cmp, groupBy],
  )
  const visibleRows = React.useMemo(
    () => rendered.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows.map((r) => r.task))),
    [rendered, collapsed],
  )
  const selection = useTaskSelection({ rows: visibleRows, pool: tasks, canSelect: () => canEdit })

  if (!tasks.length && empty) return <>{empty}</>

  return (
    <div role="grid" className="pb-24">
      {rendered.map((g) => {
        const isCollapsed = collapsed.has(g.key)
        return (
          <div key={g.key}>
            {groupBy !== 'none' && (
              <div className="group sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border/60 bg-muted/60 px-3 text-xs font-medium backdrop-blur">
                <button
                  className="flex items-center gap-2"
                  onClick={() =>
                    setCollapsed((s) => {
                      const n = new Set(s)
                      if (n.has(g.key)) n.delete(g.key)
                      else n.add(g.key)
                      return n
                    })
                  }
                >
                  <ChevronRight className={cn('size-3.5 text-subtle transition-transform', !isCollapsed && 'rotate-90')} />
                  {g.icon}
                  {g.label}
                  <span className="font-normal text-subtle">{g.tasks.length}</span>
                </button>
                {onAdd && canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto opacity-0 group-hover:opacity-100"
                    onClick={() => onAdd(g.add)}
                    aria-label={`Add task to ${g.label}`}
                  >
                    <Plus />
                  </Button>
                )}
              </div>
            )}
            {!isCollapsed &&
              g.rows.map(({ task, indent }) => (
                <div
                  key={task.id}
                  onClickCapture={(e) => selection.api.rowClickCapture(e, task.id)}
                  onMouseDown={selection.api.rowMouseDown}
                >
                  <TaskRow
                    task={task}
                    editable={canEdit}
                    showProject={showProject}
                    indent={indent}
                    selected={selection.selectedIds.has(task.id)}
                    onSelectChange={canEdit ? (v) => selection.api.toggle(task.id, v) : undefined}
                    active={selection.activeId === task.id}
                  />
                </div>
              ))}
          </div>
        )
      })}
      <BulkBar tasks={selection.selectedTasks} statuses={statuses} onClear={selection.clear} />
    </div>
  )
}
