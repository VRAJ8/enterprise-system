/**
 * Pure grouping / ordering helpers for task lists (project list view and My Tasks).
 */
import {
  AlertCircle,
  ArrowDownWideNarrow,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleDashed,
  CircleDot,
  Clock3,
  History,
  Layers,
  ListOrdered,
  Signal,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { Task } from '@/api/hooks/tasks'
import { isClosed } from '@/components/domain'
import { daysFromToday } from '@/lib/dates'
import { PRIORITY_ORDER } from '@/lib/utils'

// ─── Options ───

export type GroupBy = 'status' | 'assignee' | 'priority' | 'due' | 'none'
export type OrderBy = 'manual' | 'priority' | 'due' | 'updated' | 'created'

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string; icon: LucideIcon }[] = [
  { value: 'status', label: 'Status', icon: CircleDot },
  { value: 'assignee', label: 'Assignee', icon: UserRound },
  { value: 'priority', label: 'Priority', icon: Signal },
  { value: 'due', label: 'Due date', icon: CalendarDays },
  { value: 'none', label: 'No grouping', icon: Layers },
]

export const ORDER_BY_OPTIONS: { value: OrderBy; label: string; icon: LucideIcon }[] = [
  { value: 'manual', label: 'Manual', icon: ListOrdered },
  { value: 'priority', label: 'Priority', icon: Signal },
  { value: 'due', label: 'Due date', icon: CalendarClock },
  { value: 'updated', label: 'Last updated', icon: History },
  { value: 'created', label: 'Created', icon: ArrowDownWideNarrow },
]

// ─── Ordering ───

const byPosition = (a: Task, b: Task) => a.position - b.position || a.created_at.localeCompare(b.created_at)
const byPriority = (a: Task, b: Task) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
const byDue = (a: Task, b: Task) => {
  if (a.due_date === b.due_date) return 0
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  return a.due_date < b.due_date ? -1 : 1
}

export function compareTasks(order: OrderBy): (a: Task, b: Task) => number {
  switch (order) {
    case 'priority':
      return (a, b) => byPriority(a, b) || byDue(a, b) || byPosition(a, b)
    case 'due':
      return (a, b) => byDue(a, b) || byPriority(a, b) || byPosition(a, b)
    case 'updated':
      return (a, b) => b.updated_at.localeCompare(a.updated_at)
    case 'created':
      return (a, b) => b.created_at.localeCompare(a.created_at)
    default:
      return byPosition
  }
}

// ─── Rows (subtask nesting) ───

export interface RowItem {
  task: Task
  indent: boolean
}

/**
 * Sort tasks and, when a subtask's parent is in the same set, place it directly under its parent (indented).
 * Subtasks whose parent lives elsewhere (another group, filtered out) render as regular rows.
 */
export function buildRows(tasks: Task[], cmp: (a: Task, b: Task) => number, nest: boolean): RowItem[] {
  if (!nest) return [...tasks].sort(cmp).map((task) => ({ task, indent: false }))
  const ids = new Set(tasks.map((t) => t.id))
  const children = new Map<string, Task[]>()
  const roots: Task[] = []
  for (const t of tasks) {
    if (t.parent_id && ids.has(t.parent_id)) {
      const list = children.get(t.parent_id) ?? []
      list.push(t)
      children.set(t.parent_id, list)
    } else roots.push(t)
  }
  const out: RowItem[] = []
  const seen = new Set<string>()
  const visit = (t: Task, depth: number) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    out.push({ task: t, indent: depth > 0 })
    children
      .get(t.id)
      ?.sort(cmp)
      .forEach((c) => visit(c, depth + 1))
  }
  roots.sort(cmp).forEach((r) => visit(r, 0))
  return out
}

// ─── Due buckets ───

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'past'
export type Tone = 'danger' | 'warning' | 'primary' | 'muted' | 'subtle' | 'default'

export const DUE_BUCKETS: Record<DueBucket, { label: string; icon: LucideIcon; tone: Tone; hint?: string }> = {
  overdue: { label: 'Overdue', icon: AlertCircle, tone: 'danger' },
  today: { label: 'Today', icon: Sun, tone: 'warning' },
  week: { label: 'Next 7 days', icon: CalendarRange, tone: 'primary' },
  later: { label: 'Later', icon: Clock3, tone: 'muted' },
  none: { label: 'No due date', icon: CircleDashed, tone: 'subtle' },
  past: { label: 'Past', icon: History, tone: 'subtle' },
}

export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later', 'past', 'none']

export function dueBucket(t: Task): DueBucket {
  if (!t.due_date) return 'none'
  const closed = isClosed(t.status.category)
  const n = daysFromToday(t.due_date)
  if (n < 0 || t.is_overdue) return closed ? 'past' : 'overdue'
  if (n === 0) return 'today'
  if (n <= 7) return 'week'
  return 'later'
}

export const TONE_TEXT: Record<Tone, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  primary: 'text-primary',
  muted: 'text-muted-foreground',
  subtle: 'text-subtle',
  default: 'text-foreground',
}

export const TONE_PILL: Record<Tone, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  primary: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
  subtle: 'bg-muted text-subtle',
  default: 'bg-muted text-muted-foreground',
}
