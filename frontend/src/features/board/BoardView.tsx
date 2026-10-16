import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, Plus, Rows3 } from 'lucide-react'
import * as React from 'react'
import { useMe } from '@/app/auth'
import { useUI } from '@/app/ui-store'
import { useStatuses, type Status } from '@/api/hooks/projects'
import { useBulkUpdateTasks, useMoveTask, useProjectTasks, type Task } from '@/api/hooks/tasks'
import { StatusIcon } from '@/components/domain'
import { Picker } from '@/components/pickers'
import { TaskCard } from '@/components/task/TaskCard'
import { applyTaskFilters, FilterBar, useTaskFilters } from '@/components/task/filters'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/UserAvatar'
import { PriorityIcon } from '@/components/domain'
import { cn } from '@/lib/utils'
import { useProjectContext } from '@/features/projects/ProjectLayout'
import {
  buildItems,
  buildLanes,
  containerId,
  findContainer,
  GROUP_LABEL,
  parseContainer,
  placementFor,
  sortStatuses,
  type GroupBy,
  type Items,
  type Lane,
} from './model'

const GROUP_KEY = 'ph-board-group'

export default function BoardView() {
  const { project, canEdit } = useProjectContext()
  const me = useMe()
  const filters = useTaskFilters()
  const tasksQ = useProjectTasks(project.id)
  const statusesQ = useStatuses(project.id)
  const move = useMoveTask()
  const bulk = useBulkUpdateTasks()
  const openCreateTask = useUI((s) => s.openCreateTask)
  const [groupBy, setGroupBy] = React.useState<GroupBy>(() => (localStorage.getItem(GROUP_KEY) as GroupBy) || 'none')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  const statuses = React.useMemo(() => sortStatuses(statusesQ.data ?? []), [statusesQ.data])
  const visible = React.useMemo(
    () => applyTaskFilters(tasksQ.data?.items ?? [], filters.filters, me.id),
    [tasksQ.data, filters.filters, me.id],
  )
  const byId = React.useMemo(() => new Map(visible.map((t) => [t.id, t])), [visible])
  const lanes = React.useMemo(() => buildLanes(visible, groupBy, me.id), [visible, groupBy, me.id])
  const serverItems = React.useMemo(() => buildItems(visible, statuses, lanes, groupBy), [visible, statuses, lanes, groupBy])

  // While dragging, a local copy of the containers drives the UI; otherwise the cache does.
  const [dragItems, setDragItems] = React.useState<Items | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const items = dragItems ?? serverItems
  const activeTask = activeId ? byId.get(activeId) : undefined

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    setDragItems(serverItems)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return
    const from = findContainer(dragItems, String(active.id))
    const to = findContainer(dragItems, String(over.id))
    if (!from || !to || from === to) return
    setDragItems((prev) => {
      if (!prev) return prev
      const src = prev[from].filter((id) => id !== active.id)
      const dst = [...prev[to]]
      const overIndex = dst.indexOf(String(over.id))
      dst.splice(overIndex >= 0 ? overIndex : dst.length, 0, String(active.id))
      return { ...prev, [from]: src, [to]: dst }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const current = dragItems
    setActiveId(null)
    setDragItems(null)
    const task = byId.get(id)
    if (!over || !current || !task) return
    const container = findContainer(current, id)
    if (!container) return
    let ids = current[container]
    const overIndex = ids.indexOf(String(over.id))
    const oldIndex = ids.indexOf(id)
    if (overIndex >= 0 && overIndex !== oldIndex) {
      ids = [...ids]
      ids.splice(oldIndex, 1)
      ids.splice(overIndex, 0, id)
    }
    const target = parseContainer(container)
    if (!target) return
    const placement = placementFor(ids, id, byId, task.position)
    const statusChanged = target.statusId !== task.status.id
    const unchanged = !statusChanged && placement.position === task.position
    if (!unchanged) move.mutate({ task, statusId: statusChanged ? target.statusId : undefined, ...placement })

    // Dropping into another swimlane also reassigns / reprioritises.
    if (groupBy !== 'none' && target.laneKey !== laneOf(task, groupBy)) {
      const [kind, value] = target.laneKey.split(':')
      bulk.mutate({
        task_ids: [task.id],
        clear_assignee: kind === 'u' && value === 'none',
        delete: false,
        ...(kind === 'u' ? (value === 'none' ? {} : { assignee_id: value }) : { priority: value as Task['priority'] }),
      })
    }
  }

  if (tasksQ.isLoading || statusesQ.isLoading) {
    return (
      <div className="flex gap-3 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-80 w-72 shrink-0 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-5">
        <FilterBar
          state={filters}
          right={
            <Picker
              options={(['none', 'assignee', 'priority'] as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
              value={groupBy}
              onChange={(g) => {
                setGroupBy(g as GroupBy)
                localStorage.setItem(GROUP_KEY, g)
              }}
            >
              <Button variant="ghost" size="sm">
                <Rows3 /> {groupBy === 'none' ? 'Swimlanes' : GROUP_LABEL[groupBy]}
              </Button>
            </Picker>
          }
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null)
          setDragItems(null)
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="inline-flex min-w-full flex-col gap-4 p-4 sm:px-5">
            {lanes.map((lane) => (
              <LaneRow
                key={lane.key}
                lane={lane}
                showHeader={groupBy !== 'none'}
                statuses={statuses}
                items={items}
                byId={byId}
                collapsed={collapsed}
                toggle={(sid) =>
                  setCollapsed((s) => {
                    const n = new Set(s)
                    if (n.has(sid)) n.delete(sid)
                    else n.add(sid)
                    return n
                  })
                }
                canEdit={canEdit}
                activeId={activeId}
                onAdd={(statusId) =>
                  openCreateTask({
                    projectId: project.id,
                    statusId,
                    assigneeId: lane.assignee !== undefined ? (lane.assignee?.id ?? null) : undefined,
                  })
                }
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180 }}>
          {activeTask && <TaskCard task={activeTask} editable={false} overlay className="w-72" />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function laneOf(task: Task, groupBy: GroupBy) {
  if (groupBy === 'assignee') return `u:${task.assignee?.id ?? 'none'}`
  if (groupBy === 'priority') return `p:${task.priority}`
  return 'all'
}

function LaneRow({
  lane,
  showHeader,
  statuses,
  items,
  byId,
  collapsed,
  toggle,
  canEdit,
  activeId,
  onAdd,
}: {
  lane: Lane
  showHeader: boolean
  statuses: Status[]
  items: Items
  byId: Map<string, Task>
  collapsed: Set<string>
  toggle: (statusId: string) => void
  canEdit: boolean
  activeId: string | null
  onAdd: (statusId: string) => void
}) {
  const count = statuses.reduce((n, s) => n + (items[containerId(lane.key, s.id)]?.length ?? 0), 0)
  return (
    <section>
      {showHeader && (
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {lane.assignee !== undefined && <UserAvatar user={lane.assignee} size="sm" />}
          {lane.priority && <PriorityIcon priority={lane.priority} />}
          {lane.label}
          <span className="text-xs font-normal text-subtle">{count}</span>
        </div>
      )}
      <div className="flex gap-3">
        {statuses.map((s) => (
          <Column
            key={s.id}
            id={containerId(lane.key, s.id)}
            status={s}
            ids={items[containerId(lane.key, s.id)] ?? []}
            byId={byId}
            collapsed={collapsed.has(s.id)}
            onToggle={() => toggle(s.id)}
            canEdit={canEdit}
            activeId={activeId}
            onAdd={() => onAdd(s.id)}
          />
        ))}
      </div>
    </section>
  )
}

function Column({
  id,
  status,
  ids,
  byId,
  collapsed,
  onToggle,
  canEdit,
  activeId,
  onAdd,
}: {
  id: string
  status: Status
  ids: string[]
  byId: Map<string, Task>
  collapsed: boolean
  onToggle: () => void
  canEdit: boolean
  activeId: string | null
  onAdd: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const estimate = ids.reduce((h, tid) => h + (byId.get(tid)?.estimate_hours ?? 0), 0)

  if (collapsed) {
    return (
      <button
        ref={setNodeRef}
        onClick={onToggle}
        className={cn(
          'flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-border/60 bg-muted/40 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted',
          isOver && 'border-primary/50 bg-primary-soft/40',
        )}
      >
        <StatusIcon category={status.category} color={status.color} />
        <span className="[writing-mode:vertical-rl]">{status.name}</span>
        <span className="text-subtle">{ids.length}</span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-muted/40 transition-colors',
        isOver && 'border-primary/40 bg-primary-soft/30',
      )}
    >
      <div className="group flex h-10 items-center gap-2 px-3">
        <button onClick={onToggle} className="flex min-w-0 items-center gap-2 text-sm font-medium" title="Collapse column">
          <StatusIcon category={status.category} color={status.color} />
          <span className="truncate">{status.name}</span>
          <span className="text-xs font-normal text-subtle">{ids.length}</span>
          <ChevronRight className="size-3.5 rotate-90 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        {estimate > 0 && <span className="ml-auto text-2xs text-subtle">{Math.round(estimate * 10) / 10}h</span>}
        {canEdit && (
          <Button variant="ghost" size="icon-xs" className={cn(estimate > 0 ? '' : 'ml-auto')} onClick={onAdd} aria-label={`Add task to ${status.name}`}>
            <Plus />
          </Button>
        )}
      </div>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
          {ids.map((tid) => {
            const task = byId.get(tid)
            return task ? <SortableCard key={tid} task={task} canEdit={canEdit} dragging={activeId === tid} /> : null
          })}
          {ids.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 py-6 text-xs text-subtle">
              Drop tasks here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

function SortableCard({ task, canEdit, dragging }: { task: Task; canEdit: boolean; dragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id, disabled: !canEdit })
  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      editable={canEdit}
      dragging={dragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    />
  )
}
