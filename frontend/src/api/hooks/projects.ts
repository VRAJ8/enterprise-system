import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '@/app/workspace'
import { api, unwrap, type Schemas } from '../client'
import { qk } from '../keys'

export type Project = Schemas['ProjectOut']
export type ProjectMember = Schemas['ProjectMemberOut']
export type Status = Schemas['StatusOut']
export type Milestone = Schemas['MilestoneOut']
export type ProjectUpdate = Schemas['ProjectUpdateOut']
export type ProjectRole = Schemas['ProjectRole']

export const canEditProject = (p: { my_role?: ProjectRole | null } | undefined) => p?.my_role === 'lead' || p?.my_role === 'member'
export const isProjectLead = (p: { my_role?: ProjectRole | null } | undefined) => p?.my_role === 'lead'

// ─── Projects ───

export function useProjects(opts: { includeArchived?: boolean } = {}) {
  const ws = useWorkspace()
  const include = !!opts.includeArchived
  return useQuery({
    queryKey: qk.projects(ws.id, include),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/projects', {
          params: { path: { workspace_id: ws.id }, query: { include_archived: include } },
        }),
      ),
  })
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
  })
}

/** Resolve a project from its key (URL segment) using the projects list. */
export function useProjectByKey(key: string | undefined) {
  const list = useProjects({ includeArchived: true })
  const fromList = list.data?.find((p) => p.key.toLowerCase() === key?.toLowerCase())
  const detail = useProject(fromList?.id)
  return {
    project: detail.data ?? fromList,
    isLoading: list.isLoading || (!!fromList && detail.isLoading && !fromList),
    notFound: list.isSuccess && !fromList,
  }
}

export function useCreateProject() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['ProjectCreate']) =>
      unwrap(api.POST('/api/v1/workspaces/{workspace_id}/projects', { params: { path: { workspace_id: ws.id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', ws.id] })
      void qc.invalidateQueries({ queryKey: ['insights'] })
    },
  })
}

export function useUpdateProject(projectId: string) {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['ProjectUpdate']) =>
      unwrap(api.PATCH('/api/v1/projects/{project_id}', { params: { path: { project_id: projectId } }, body })),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(projectId), project)
      void qc.invalidateQueries({ queryKey: ['projects', ws.id] })
      void qc.invalidateQueries({ queryKey: ['insights'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeleteProject() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => unwrap(api.DELETE('/api/v1/projects/{project_id}', { params: { path: { project_id: projectId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', ws.id] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['insights'] })
    },
  })
}

// ─── Members ───

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectMembers(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}/members', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
  })
}

function invalidateProject(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: qk.project(projectId) })
  void qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useAddProjectMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['ProjectMemberCreate']) =>
      unwrap(api.POST('/api/v1/projects/{project_id}/members', { params: { path: { project_id: projectId } }, body })),
    onSuccess: () => invalidateProject(qc, projectId),
  })
}

export function useUpdateProjectMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      unwrap(
        api.PATCH('/api/v1/projects/{project_id}/members/{user_id}', {
          params: { path: { project_id: projectId, user_id: userId } },
          body: { role },
        }),
      ),
    onSuccess: () => invalidateProject(qc, projectId),
  })
}

export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(
        api.DELETE('/api/v1/projects/{project_id}/members/{user_id}', { params: { path: { project_id: projectId, user_id: userId } } }),
      ),
    onSuccess: () => invalidateProject(qc, projectId),
  })
}

// ─── Statuses ───

export function useStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.statuses(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}/statuses', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })
}

export function useCreateStatus(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['StatusCreate']) =>
      unwrap(api.POST('/api/v1/projects/{project_id}/statuses', { params: { path: { project_id: projectId } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.statuses(projectId) }),
  })
}

export function useUpdateStatus(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Schemas['StatusUpdate']) =>
      unwrap(api.PATCH('/api/v1/statuses/{status_id}', { params: { path: { status_id: id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.statuses(projectId) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeleteStatus(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
      unwrap(
        api.DELETE('/api/v1/statuses/{status_id}', {
          params: { path: { status_id: id }, query: moveTo ? { move_to: moveTo } : {} },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.statuses(projectId) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useReorderStatuses(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (statusIds: string[]) =>
      unwrap(
        api.POST('/api/v1/projects/{project_id}/statuses/reorder', {
          params: { path: { project_id: projectId } },
          body: { status_ids: statusIds },
        }),
      ),
    onMutate: async (statusIds) => {
      await qc.cancelQueries({ queryKey: qk.statuses(projectId) })
      const prev = qc.getQueryData<Status[]>(qk.statuses(projectId))
      if (prev) {
        const byId = new Map(prev.map((s) => [s.id, s]))
        qc.setQueryData(
          qk.statuses(projectId),
          statusIds.map((id, i) => ({ ...byId.get(id)!, position: i })),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.statuses(projectId), ctx.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.statuses(projectId) }),
  })
}

// ─── Milestones ───

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.milestones(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}/milestones', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
  })
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['MilestoneCreate']) =>
      unwrap(api.POST('/api/v1/projects/{project_id}/milestones', { params: { path: { project_id: projectId } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  })
}

export function useUpdateMilestone(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Schemas['MilestoneUpdate']) =>
      unwrap(api.PATCH('/api/v1/milestones/{milestone_id}', { params: { path: { milestone_id: id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  })
}

export function useDeleteMilestone(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/milestones/{milestone_id}', { params: { path: { milestone_id: id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.project(projectId) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

// ─── Status updates ───

export function useProjectUpdates(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.updates(projectId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project_id}/updates', { params: { path: { project_id: projectId! } } })),
    enabled: !!projectId,
  })
}

export function usePostProjectUpdate(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['ProjectUpdateCreate']) =>
      unwrap(api.POST('/api/v1/projects/{project_id}/updates', { params: { path: { project_id: projectId } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.project(projectId) })
      void qc.invalidateQueries({ queryKey: ['insights'] })
    },
  })
}
