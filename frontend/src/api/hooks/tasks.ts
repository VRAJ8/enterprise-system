/**
 * Task queries and mutations. Every edit is applied optimistically to all cached task lists
 * (board, list, my tasks, timeline) and the task detail, then reconciled with the server response.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { operations } from '../schema'
import { useWorkspace } from '@/app/workspace'
import { api, unwrap, type Schemas } from '../client'
import { qk, type TaskFilters } from '../keys'

export type Task = Schemas['TaskOut']
export type TaskDetail = Schemas['TaskDetail']
export type TaskList = Schemas['TaskList']
export type TaskBrief = Schemas['TaskBrief']
export type TaskUpdate = Schemas['TaskUpdate']

type ListQuery = NonNullable<operations['list_workspace_tasks_api_v1_workspaces__workspace_id__tasks_get']['parameters']['query']>
export type TaskQuery = Omit<ListQuery, 'cursor'>

const CLOSED = ['done', 'canceled']

// ─── Queries ───

export function useProjectTasks(projectId: string | undefined, filters: TaskQuery = {}) {
  return useQuery({
    queryKey: qk.projectTasks(projectId ?? '', filters as TaskFilters),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/projects/{project_id}/tasks', {
          params: { path: { project_id: projectId! }, query: { limit: 2000, ...filters } },
        }),
      ),
    enabled: !!projectId,
  })
}

export function useWorkspaceTasks(filters: TaskQuery = {}, opts: { enabled?: boolean } = {}) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.workspaceTasks(ws.id, filters as TaskFilters),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/tasks', {
          params: { path: { workspace_id: ws.id }, query: { limit: 500, ...filters } },
        }),
      ),
    enabled: opts.enabled ?? true,
  })
}

export function useTask(taskId: string | null | undefined) {
  return useQuery({
    queryKey: qk.task(taskId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/tasks/{task_id}', { params: { path: { task_id: taskId! } } })),
    enabled: !!taskId,
  })
}

/** Look a task up by its human reference ("WEB-42"); seeds the by-id cache. */
export function useTaskByRef(ref: string | null | undefined) {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useQuery({
    queryKey: qk.taskByRef(ws.id, ref ?? ''),
    queryFn: async () => {
      const task = await unwrap(
        api.GET('/api/v1/tasks/by-ref/{workspace_id}/{ref}', { params: { path: { workspace_id: ws.id, ref: ref! } } }),
      )
      qc.setQueryData(qk.task(task.id), task)
      return task
    },
    enabled: !!ref,
  })
}

// ─── Cache helpers ───

type Snapshot = [QueryKey, unknown][]

function snapshot(qc: QueryClient): Snapshot {
  return [...qc.getQueriesData({ queryKey: ['tasks'] }), ...qc.getQueriesData({ queryKey: ['task'] })]
}

function restore(qc: QueryClient, snap: Snapshot | undefined) {
  snap?.forEach(([key, data]) => qc.setQueryData<unknown>(key, data))
}

function isTaskList(v: unknown): v is TaskList {
  return !!v && typeof v === 'object' && Array.isArray((v as TaskList).items)
}
function isTaskDetail(v: unknown): v is TaskDetail {
  return !!v && typeof v === 'object' && 'subtasks' in (v as object) && 'ref' in (v as object)
}

/** Apply `fn` to the task everywhere it is cached (lists, detail, parent's subtasks). */
export function patchTaskInCache(qc: QueryClient, taskId: string, fn: (t: Task) => Task) {
  qc.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) =>
    isTaskList(old) ? { ...old, items: old.items.map((t) => (t.id === taskId ? fn(t) : t)) } : old,
  )
  qc.setQueriesData({ queryKey: ['task'] }, (old: unknown) => {
    if (!isTaskDetail(old)) return old
    if (old.id === taskId) return { ...old, ...fn(old) }
    if (old.subtasks.some((s) => s.id === taskId)) {
      return { ...old, subtasks: old.subtasks.map((s) => (s.id === taskId ? fn(s) : s)) }
    }
    return old
  })
}

function removeTaskFromCache(qc: QueryClient, taskIds: Set<string>) {
  qc.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) =>
    isTaskList(old)
      ? { ...old, items: old.items.filter((t) => !taskIds.has(t.id)), total: Math.max(0, old.total - 1) }
      : old,
  )
  qc.setQueriesData({ queryKey: ['task'] }, (old: unknown) =>
    isTaskDetail(old) && old.subtasks.some((s) => taskIds.has(s.id))
      ? { ...old, subtasks: old.subtasks.filter((s) => !taskIds.has(s.id)) }
      : old,
  )
}

function findInCaches<T>(qc: QueryClient, prefix: QueryKey, pick: (data: unknown) => T | undefined): T | undefined {
  for (const [, data] of qc.getQueriesData({ queryKey: prefix })) {
    const hit = pick(data)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Translate a TaskUpdate payload into the optimistic TaskOut shape using cached statuses/people/labels. */
function applyUpdate(qc: QueryClient, t: Task, body: TaskUpdate): Task {
  const next: Task = { ...t }
  if (body.title !== undefined && body.title !== null) next.title = body.title
  if (body.priority !== undefined && body.priority !== null) next.priority = body.priority
  if (body.due_date !== undefined) next.due_date = body.due_date ?? null
  if (body.start_date !== undefined) next.start_date = body.start_date ?? null
  if (body.estimate_hours !== undefined) next.estimate_hours = body.estimate_hours ?? null
  if (body.milestone_id !== undefined) next.milestone_id = body.milestone_id ?? null
  if (body.parent_id !== undefined) next.parent_id = body.parent_id ?? null
  if (body.status_id) {
    const status = findInCaches(qc, ['project', t.project.id, 'statuses'], (d) =>
      Array.isArray(d) ? (d as Schemas['StatusOut'][]).find((s) => s.id === body.status_id) : undefined,
    )
    if (status) {
      next.status = { id: status.id, name: status.name, category: status.category, color: status.color }
      const closed = CLOSED.includes(status.category)
      next.completed_at = status.category === 'done' ? (t.completed_at ?? new Date().toISOString()) : null
      if (closed) next.is_overdue = false
    }
  }
  if (body.assignee_id !== undefined) {
    if (body.assignee_id === null) next.assignee = null
    else {
      const user = findInCaches(qc, ['members'], (d) =>
        Array.isArray(d) ? (d as Schemas['MemberOut'][]).find((m) => m.user.id === body.assignee_id)?.user : undefined,
      )
      if (user) next.assignee = user
    }
  }
  if (body.label_ids) {
    const all = findInCaches(qc, ['labels'], (d) => (Array.isArray(d) ? (d as Schemas['LabelOut'][]) : undefined)) ?? []
    next.labels = all.filter((l) => body.label_ids!.includes(l.id))
  }
  return next
}

function invalidateAround(qc: QueryClient, task: { id: string; project: { id: string } } | undefined) {
  void qc.invalidateQueries({ queryKey: ['home'] })
  void qc.invalidateQueries({ queryKey: ['insights'] })
  if (task) {
    void qc.invalidateQueries({ queryKey: ['project', task.project.id], exact: false, refetchType: 'active' })
    void qc.invalidateQueries({ queryKey: ['task', task.id, 'activity'] })
  }
}

// ─── Mutations ───

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't create task" },
    mutationFn: ({ projectId, ...body }: { projectId: string } & Schemas['TaskCreate']) =>
      unwrap(api.POST('/api/v1/projects/{project_id}/tasks', { params: { path: { project_id: projectId } }, body })),
    onSuccess: (task) => {
      qc.setQueryData(qk.task(task.id), task)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      if (task.parent_id) void qc.invalidateQueries({ queryKey: qk.task(task.parent_id) })
      invalidateAround(qc, task)
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't update task" },
    mutationFn: ({ id, ...body }: { id: string } & TaskUpdate) =>
      unwrap(api.PATCH('/api/v1/tasks/{task_id}', { params: { path: { task_id: id } }, body })),
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: qk.task(id) })
      const snap = snapshot(qc)
      patchTaskInCache(qc, id, (t) => applyUpdate(qc, t, body))
      if (body.description !== undefined) {
        qc.setQueryData<TaskDetail>(qk.task(id), (d) => (d ? { ...d, description: body.description ?? '' } : d))
      }
      return { snap }
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (detail) => {
      qc.setQueryData(qk.task(detail.id), detail)
      patchTaskInCache(qc, detail.id, (t) => ({ ...t, ...pickTaskOut(detail) }))
      invalidateAround(qc, detail)
      if (detail.parent_id) void qc.invalidateQueries({ queryKey: qk.task(detail.parent_id) })
    },
  })
}

function pickTaskOut(d: TaskDetail): Task {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { description, reporter, parent, milestone, subtasks, blocked_by, blocking, watchers, is_watching, time_logged_minutes, can_edit, ...rest } = d
  return rest as Task
}

export interface MoveArgs {
  task: Task
  statusId?: string
  /** Neighbours in the destination column after the move */
  afterId?: string | null
  beforeId?: string | null
  afterPosition?: number | null
  beforePosition?: number | null
}

/** Drag & drop. Computes the optimistic position locally (midpoint), the server confirms. */
export function useMoveTask() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't move task" },
    mutationFn: ({ task, statusId, afterId, beforeId }: MoveArgs) =>
      unwrap(
        api.POST('/api/v1/tasks/{task_id}/move', {
          params: { path: { task_id: task.id } },
          body: { status_id: statusId ?? null, after_id: afterId ?? null, before_id: beforeId ?? null },
        }),
      ),
    onMutate: async ({ task, statusId, afterPosition, beforePosition }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const snap = snapshot(qc)
      const position =
        afterPosition != null && beforePosition != null
          ? (afterPosition + beforePosition) / 2
          : afterPosition != null
            ? afterPosition + 1024
            : beforePosition != null
              ? beforePosition - 1024
              : task.position
      patchTaskInCache(qc, task.id, (t) => ({ ...applyUpdate(qc, t, statusId ? { status_id: statusId } : {}), position }))
      return { snap }
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (updated) => {
      patchTaskInCache(qc, updated.id, () => updated)
      invalidateAround(qc, updated)
      void qc.invalidateQueries({ queryKey: qk.task(updated.id) })
    },
  })
}

export function useRestoreTask() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't restore task" },
    mutationFn: (taskId: string) => unwrap(api.POST('/api/v1/tasks/{task_id}/restore', { params: { path: { task_id: taskId } } })),
    onSuccess: (task) => {
      qc.setQueryData(qk.task(task.id), task)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      if (task.parent_id) void qc.invalidateQueries({ queryKey: qk.task(task.parent_id) })
      invalidateAround(qc, task)
    },
  })
}

/** Soft delete with an "Undo" toast. */
export function useDeleteTask() {
  const qc = useQueryClient()
  const restoreTask = useRestoreTask()
  return useMutation({
    meta: { errorTitle: "Couldn't delete task" },
    mutationFn: (task: Pick<Task, 'id' | 'ref' | 'title' | 'project' | 'parent_id'>) =>
      unwrap(api.DELETE('/api/v1/tasks/{task_id}', { params: { path: { task_id: task.id } } })),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const snap = snapshot(qc)
      removeTaskFromCache(qc, new Set([task.id]))
      return { snap }
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (_d, task) => {
      qc.removeQueries({ queryKey: qk.task(task.id), exact: true })
      if (task.parent_id) void qc.invalidateQueries({ queryKey: qk.task(task.parent_id) })
      invalidateAround(qc, task)
      toast(`Deleted ${task.ref}`, {
        description: task.title,
        action: { label: 'Undo', onClick: () => restoreTask.mutate(task.id) },
      })
    },
  })
}

export function useBulkUpdateTasks() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't update tasks" },
    mutationFn: (body: Schemas['TaskBulkUpdate']) => unwrap(api.PATCH('/api/v1/tasks/bulk', { body })),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const snap = snapshot(qc)
      if (body.delete) removeTaskFromCache(qc, new Set(body.task_ids))
      else {
        const update: TaskUpdate = {}
        if (body.status_id) update.status_id = body.status_id
        if (body.priority) update.priority = body.priority
        if (body.clear_assignee) update.assignee_id = null
        else if (body.assignee_id) update.assignee_id = body.assignee_id
        if (body.due_date) update.due_date = body.due_date
        body.task_ids.forEach((id) => patchTaskInCache(qc, id, (t) => applyUpdate(qc, t, update)))
      }
      return { snap }
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['task'] })
      void qc.invalidateQueries({ queryKey: ['home'] })
      void qc.invalidateQueries({ queryKey: ['insights'] })
      void qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

export function useTaskDependency() {
  const qc = useQueryClient()
  const done = (taskId: string, otherId: string) => {
    void qc.invalidateQueries({ queryKey: qk.task(taskId) })
    void qc.invalidateQueries({ queryKey: qk.task(otherId) })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
  }
  const add = useMutation({
    meta: { errorTitle: "Couldn't add dependency" },
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) =>
      unwrap(api.POST('/api/v1/tasks/{task_id}/dependencies/{other_id}', { params: { path: { task_id: taskId, other_id: blockerId } } })),
    onSuccess: (_d, v) => done(v.taskId, v.blockerId),
  })
  const remove = useMutation({
    meta: { errorTitle: "Couldn't remove dependency" },
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) =>
      unwrap(api.DELETE('/api/v1/tasks/{task_id}/dependencies/{other_id}', { params: { path: { task_id: taskId, other_id: blockerId } } })),
    onSuccess: (_d, v) => done(v.taskId, v.blockerId),
  })
  return { add, remove }
}

export function useWatchTask(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (watch: boolean) =>
      unwrap(
        watch
          ? api.POST('/api/v1/tasks/{task_id}/watch', { params: { path: { task_id: taskId } } })
          : api.DELETE('/api/v1/tasks/{task_id}/watch', { params: { path: { task_id: taskId } } }),
      ),
    onMutate: (watch) => qc.setQueryData<TaskDetail>(qk.task(taskId), (d) => (d ? { ...d, is_watching: watch } : d)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.task(taskId) }),
  })
}

export const isTaskClosed = (t: { status: { category: string } }) => CLOSED.includes(t.status.category)
