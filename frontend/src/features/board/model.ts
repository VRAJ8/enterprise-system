/**
 * Pure board logic: grouping into lanes, column ordering, container ids and drop placement.
 * Kept free of React so it is easy to reason about (and to unit test).
 */
import type { Status } from '@/api/hooks/projects'
import type { Task } from '@/api/hooks/tasks'
import type { UserBrief } from '@/api/hooks/workspace'
import { PRIORITIES, PRIORITY_LABEL, type Priority } from '@/components/domain'

export type GroupBy = 'none' | 'assignee' | 'priority'

export const GROUP_LABEL: Record<GroupBy, string> = {
  none: 'No grouping',
  assignee: 'Assignee',
  priority: 'Priority',
}

/** A swimlane (row). With no grouping there is a single lane, `all`. */
export interface Lane {
  key: string
  label: string
  /** Field value a card takes when dropped into this lane. */
  assignee?: UserBrief | null
  priority?: Priority
}

export const ALL_LANE: Lane = { key: 'all', label: 'All tasks' }

// ─── Ordering ───

/** Board order inside a column: position ascending, then number (stable when positions tie). */
export function compareTasks(a: Task, b: Task): number {
  return a.position - b.position || a.number - b.number
}

export function sortStatuses(statuses: Status[]): Status[] {
  return [...statuses].sort((a, b) => a.position - b.position)
}

// ─── Lanes ───

export function laneKeyFor(task: Task, groupBy: GroupBy): string {
  if (groupBy === 'assignee') return `u:${task.assignee?.id ?? 'none'}`
  if (groupBy === 'priority') return `p:${task.priority}`
  return ALL_LANE.key
}

export function buildLanes(tasks: Task[], groupBy: GroupBy, meId: string): Lane[] {
  if (groupBy === 'none') return [ALL_LANE]
  if (groupBy === 'priority') {
    return PRIORITIES.map((p) => ({ key: `p:${p}`, label: PRIORITY_LABEL[p], priority: p }))
  }
  const people = new Map<string, UserBrief>()
  for (const t of tasks) if (t.assignee) people.set(t.assignee.id, t.assignee)
  const lanes: Lane[] = [...people.values()]
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)))
    .map((u) => ({ key: `u:${u.id}`, label: u.name, assignee: u }))
  // Always offer an "Unassigned" lane so cards can be dropped there.
  lanes.push({ key: 'u:none', label: 'Unassigned', assignee: null })
  return lanes
}

// ─── Containers ───

/** Droppable/sortable container id for one lane × status cell. */
export const containerId = (laneKey: string, statusId: string) => `c|${laneKey}|${statusId}`
/** Droppable id for a collapsed column rail (no sortable items inside). */
export const railId = (laneKey: string, statusId: string) => `r|${laneKey}|${statusId}`

export function parseContainer(id: string): { kind: 'cell' | 'rail'; laneKey: string; statusId: string } | null {
  const [kind, laneKey, statusId] = id.split('|')
  if ((kind !== 'c' && kind !== 'r') || !laneKey || !statusId) return null
  return { kind: kind === 'c' ? 'cell' : 'rail', laneKey, statusId }
}

export const isContainerId = (id: string) => id.startsWith('c|')
export const isRailId = (id: string) => id.startsWith('r|')

export type Items = Record<string, string[]>

/** Group visible tasks into ordered id lists per container (expanded columns only get containers). */
export function buildItems(tasks: Task[], statuses: Status[], lanes: Lane[], groupBy: GroupBy): Items {
  const items: Items = {}
  for (const lane of lanes) for (const s of statuses) items[containerId(lane.key, s.id)] = []
  const sorted = [...tasks].sort(compareTasks)
  for (const t of sorted) {
    const key = containerId(laneKeyFor(t, groupBy), t.status.id)
    items[key]?.push(t.id)
  }
  return items
}

export function findContainer(items: Items, id: string): string | undefined {
  if (id in items) return id
  return Object.keys(items).find((k) => items[k].includes(id))
}

// ─── Drop placement ───

export interface Placement {
  afterId: string | null
  beforeId: string | null
  afterPosition: number | null
  beforePosition: number | null
  /** Optimistic position, matching what useMoveTask computes. */
  position: number
}

export function placementFor(ids: string[], activeId: string, byId: Map<string, Task>, fallback: number): Placement {
  const idx = ids.indexOf(activeId)
  const after = idx > 0 ? byId.get(ids[idx - 1]) : undefined
  const before = idx >= 0 && idx < ids.length - 1 ? byId.get(ids[idx + 1]) : undefined
  const afterPosition = after?.position ?? null
  const beforePosition = before?.position ?? null
  const position =
    afterPosition != null && beforePosition != null
      ? (afterPosition + beforePosition) / 2
      : afterPosition != null
        ? afterPosition + 1024
        : beforePosition != null
          ? beforePosition - 1024
          : fallback
  return { afterId: after?.id ?? null, beforeId: before?.id ?? null, afterPosition, beforePosition, position }
}

// ─── Optimistic overrides ───

/** Local, synchronous override applied on top of cached tasks while move/update requests are in flight. */
export interface TaskOverride {
  status?: Task['status']
  position?: number
  assignee?: UserBrief | null
  priority?: Priority
  pending: number
}

export function applyOverride(t: Task, o: TaskOverride | undefined): Task {
  if (!o) return t
  return {
    ...t,
    ...(o.status ? { status: o.status } : null),
    ...(o.position != null ? { position: o.position } : null),
    ...(o.assignee !== undefined ? { assignee: o.assignee } : null),
    ...(o.priority ? { priority: o.priority } : null),
  }
}
