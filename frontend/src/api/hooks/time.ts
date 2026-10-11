import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useWorkspace } from '@/app/workspace'
import { api, unwrap, type Schemas } from '../client'
import { qk } from '../keys'

export type TimeEntry = Schemas['TimeEntryOut']

export interface TimeEntryFilters {
  user_id?: string
  project_id?: string
  task_id?: string
  date_from?: string
  date_to?: string
}

export function useTimeEntries(filters: TimeEntryFilters = {}, opts: { enabled?: boolean } = {}) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.timeEntries(ws.id, filters as Record<string, string>),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/time-entries', {
          params: { path: { workspace_id: ws.id }, query: filters },
        }),
      ),
    enabled: opts.enabled ?? true,
  })
}

function invalidateTime(qc: ReturnType<typeof useQueryClient>, taskId?: string) {
  void qc.invalidateQueries({ queryKey: ['time'] })
  void qc.invalidateQueries({ queryKey: qk.timer })
  void qc.invalidateQueries({ queryKey: ['insights', 'time'] })
  void qc.invalidateQueries({ queryKey: ['home'] })
  if (taskId) {
    void qc.invalidateQueries({ queryKey: qk.task(taskId) })
    void qc.invalidateQueries({ queryKey: qk.taskActivity(taskId) })
  }
}

export function useLogTime(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't log time" },
    mutationFn: (body: Schemas['TimeEntryCreate']) =>
      unwrap(api.POST('/api/v1/tasks/{task_id}/time-entries', { params: { path: { task_id: taskId } }, body })),
    onSuccess: () => invalidateTime(qc, taskId),
  })
}

export function useUpdateTimeEntry() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't update entry" },
    mutationFn: ({ id, ...body }: { id: string } & Schemas['TimeEntryUpdate']) =>
      unwrap(api.PATCH('/api/v1/time-entries/{entry_id}', { params: { path: { entry_id: id } }, body })),
    onSuccess: (e) => invalidateTime(qc, e.task.id),
  })
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't delete entry" },
    mutationFn: (entry: Pick<TimeEntry, 'id' | 'task'>) =>
      unwrap(api.DELETE('/api/v1/time-entries/{entry_id}', { params: { path: { entry_id: entry.id } } })),
    onSuccess: (_d, entry) => invalidateTime(qc, entry.task.id),
  })
}

// ─── Timer ───

export function useTimer() {
  return useQuery({
    queryKey: qk.timer,
    queryFn: () => unwrap(api.GET('/api/v1/timer')),
    refetchInterval: 60_000,
    staleTime: 15_000,
  })
}

export function useStartTimer() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't start timer" },
    mutationFn: ({ taskId, note = '' }: { taskId: string; note?: string }) =>
      unwrap(api.POST('/api/v1/tasks/{task_id}/timer/start', { params: { path: { task_id: taskId } }, body: { note } })),
    onSuccess: (timer) => {
      qc.setQueryData(qk.timer, timer)
      invalidateTime(qc, timer.entry?.task.id)
    },
  })
}

export function useStopTimer() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't stop timer" },
    mutationFn: () => unwrap(api.POST('/api/v1/timer/stop')),
    onMutate: () => {
      const prev = qc.getQueryData(qk.timer)
      qc.setQueryData(qk.timer, { entry: null })
      return { prev }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.timer, ctx?.prev),
    onSuccess: (entry) => invalidateTime(qc, entry.task.id),
  })
}

/** Live "mm:ss"/"h:mm:ss" for a running entry, ticking every second. */
export function useElapsed(startedAt: string | null | undefined): string {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!startedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])
  if (!startedAt) return '0:00'
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
