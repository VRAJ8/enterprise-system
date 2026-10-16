import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '@/app/workspace'
import { api, unwrap, type Schemas } from '../client'
import { qk } from '../keys'

export type ProjectInsights = Schemas['ProjectInsightsOut']
export type Portfolio = Schemas['PortfolioOut']
export type Workload = Schemas['WorkloadOut']
export type TimeReport = Schemas['TimeReportOut']
export type Home = Schemas['HomeOut']
export type Notification = Schemas['NotificationOut']
export type Activity = Schemas['ActivityOut']

// ─── Insights ───

export function useProjectInsights(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectInsights(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}/insights', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
  })
}

export function usePortfolio() {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.portfolio(ws.id),
    queryFn: () =>
      unwrap(api.GET('/api/v1/workspaces/{workspace_id}/insights/portfolio', { params: { path: { workspace_id: ws.id } } })),
  })
}

export function useWorkload(params: { weeks?: number; project_id?: string } = {}) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.workload(ws.id, params),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/insights/workload', {
          params: { path: { workspace_id: ws.id }, query: params },
        }),
      ),
    placeholderData: keepPreviousData,
    enabled: !ws.isGuest,
  })
}

export function useTimeReport(params: { date_from?: string; date_to?: string } = {}) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.timeReport(ws.id, params),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/insights/time', { params: { path: { workspace_id: ws.id }, query: params } }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useHome() {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.home(ws.id),
    queryFn: () => unwrap(api.GET('/api/v1/workspaces/{workspace_id}/home', { params: { path: { workspace_id: ws.id } } })),
  })
}

export function useSearch(q: string) {
  const ws = useWorkspace()
  const term = q.trim()
  return useQuery({
    queryKey: qk.search(ws.id, term),
    queryFn: () =>
      unwrap(api.GET('/api/v1/workspaces/{workspace_id}/search', { params: { path: { workspace_id: ws.id }, query: { q: term } } })),
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

// ─── Notifications ───

export function useNotifications(unreadOnly = false) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.notifications(ws.id, unreadOnly),
    queryFn: () =>
      unwrap(api.GET('/api/v1/notifications', { params: { query: { workspace_id: ws.id, unread_only: unreadOnly, limit: 100 } } })),
  })
}

export function useUnreadCount() {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.unreadCount(ws.id),
    queryFn: () => unwrap(api.GET('/api/v1/notifications/unread-count', { params: { query: { workspace_id: ws.id } } })),
    refetchInterval: 120_000,
  })
}

export function useMarkRead() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't update notifications" },
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      unwrap(api.POST('/api/v1/notifications/mark-read', { body: { all: false, workspace_id: ws.id, ...body } })),
    onMutate: async ({ ids, all }) => {
      const now = new Date().toISOString()
      qc.setQueriesData<Notification[]>({ queryKey: ['notifications', 'list'] }, (old) =>
        old?.map((n) => (all || ids?.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)),
      )
      qc.setQueryData<{ count: number }>(qk.unreadCount(ws.id), (old) =>
        old ? { count: all ? 0 : Math.max(0, old.count - (ids?.length ?? 0)) } : old,
      )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ─── Activity ───

export function useProjectActivity(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectActivity(projectId ?? ''),
    queryFn: () =>
      unwrap(api.GET('/api/v1/projects/{project_id}/activity', { params: { path: { project_id: projectId! }, query: { limit: 50 } } })),
    enabled: !!projectId,
  })
}

export function useTaskActivity(taskId: string | undefined) {
  return useQuery({
    queryKey: qk.taskActivity(taskId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/tasks/{task_id}/activity', { params: { path: { task_id: taskId! } } })),
    enabled: !!taskId,
  })
}
