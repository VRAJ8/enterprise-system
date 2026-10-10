import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/app/auth'
import { useWorkspace } from '@/app/workspace'
import { api, unwrap, type Schemas } from '../client'
import { qk } from '../keys'

export type Member = Schemas['MemberOut']
export type Label = Schemas['LabelOut']
export type Invitation = Schemas['InvitationOut']
export type UserBrief = Schemas['UserBrief']

// ─── Members ───

export function useMembers(opts: { includeDeactivated?: boolean } = {}) {
  const ws = useWorkspace()
  const include = !!opts.includeDeactivated
  return useQuery({
    queryKey: qk.members(ws.id, include),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspace_id}/members', {
          params: { path: { workspace_id: ws.id }, query: { include_deactivated: include } },
        }),
      ),
    staleTime: 60_000,
  })
}

/** Active members as simple people objects (for pickers, avatars, mentions). */
export function usePeople() {
  const { data } = useMembers()
  return (data ?? []).map((m) => ({ ...m.user, role: m.role }))
}

export function useUpdateMember() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  const { reloadMe } = useAuth()
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string } & Schemas['MemberUpdate']) =>
      unwrap(
        api.PATCH('/api/v1/workspaces/{workspace_id}/members/{user_id}', {
          params: { path: { workspace_id: ws.id, user_id: userId } },
          body,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members', ws.id] })
      void qc.invalidateQueries({ queryKey: ['insights', 'workload'] })
      void reloadMe()
    },
  })
}

export function useRemoveMember() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(
        api.DELETE('/api/v1/workspaces/{workspace_id}/members/{user_id}', {
          params: { path: { workspace_id: ws.id, user_id: userId } },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members', ws.id] }),
  })
}

// ─── Workspace ───

export function useUpdateWorkspace() {
  const ws = useWorkspace()
  const { reloadMe } = useAuth()
  return useMutation({
    mutationFn: (body: Schemas['WorkspaceUpdate']) =>
      unwrap(api.PATCH('/api/v1/workspaces/{workspace_id}', { params: { path: { workspace_id: ws.id } }, body })),
    onSuccess: () => void reloadMe(),
  })
}

// ─── Invitations ───

export function useInvitations(enabled = true) {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.invitations(ws.id),
    queryFn: () => unwrap(api.GET('/api/v1/workspaces/{workspace_id}/invitations', { params: { path: { workspace_id: ws.id } } })),
    enabled,
  })
}

export function useCreateInvitation() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['InvitationCreate']) =>
      unwrap(api.POST('/api/v1/workspaces/{workspace_id}/invitations', { params: { path: { workspace_id: ws.id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invitations(ws.id) }),
  })
}

export function useRevokeInvitation() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/invitations/{invitation_id}', { params: { path: { invitation_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.invitations(ws.id) }),
  })
}

// ─── Labels ───

export function useLabels() {
  const ws = useWorkspace()
  return useQuery({
    queryKey: qk.labels(ws.id),
    queryFn: () => unwrap(api.GET('/api/v1/workspaces/{workspace_id}/labels', { params: { path: { workspace_id: ws.id } } })),
    staleTime: 5 * 60_000,
  })
}

export function useCreateLabel() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Schemas['LabelCreate']) =>
      unwrap(api.POST('/api/v1/workspaces/{workspace_id}/labels', { params: { path: { workspace_id: ws.id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.labels(ws.id) }),
  })
}

export function useUpdateLabel() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Schemas['LabelUpdate']) =>
      unwrap(api.PATCH('/api/v1/labels/{label_id}', { params: { path: { label_id: id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.labels(ws.id) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeleteLabel() {
  const ws = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/labels/{label_id}', { params: { path: { label_id: id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.labels(ws.id) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

// ─── Account ───

export function useUpdateProfile() {
  const { setMe } = useAuth()
  return useMutation({
    mutationFn: (body: Schemas['MeUpdate']) => unwrap(api.PATCH('/api/v1/auth/me', { body })),
    onSuccess: (me) => setMe(me),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: Schemas['ChangePasswordIn']) => unwrap(api.POST('/api/v1/auth/change-password', { body })),
  })
}

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => unwrap(api.GET('/api/v1/auth/sessions')) })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/auth/sessions/{session_id}', { params: { path: { session_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.sessions }),
  })
}
