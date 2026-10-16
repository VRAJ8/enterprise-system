import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useMe } from '@/app/auth'
import { api, authFetch, toApiError, tokenStore, API_ORIGIN, unwrap, type Schemas } from '../client'
import { qk } from '../keys'

export type Comment = Schemas['CommentOut']
export type Attachment = Schemas['AttachmentOut']

// ─── Comments ───

export function useComments(taskId: string | undefined) {
  return useQuery({
    queryKey: qk.taskComments(taskId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/tasks/{task_id}/comments', { params: { path: { task_id: taskId! } } })),
    enabled: !!taskId,
  })
}

export function useCreateComment(taskId: string) {
  const qc = useQueryClient()
  const me = useMe()
  return useMutation({
    meta: { errorTitle: "Couldn't post comment" },
    mutationFn: (body: string) =>
      unwrap(api.POST('/api/v1/tasks/{task_id}/comments', { params: { path: { task_id: taskId } }, body: { body } })),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.taskComments(taskId) })
      const prev = qc.getQueryData<Comment[]>(qk.taskComments(taskId))
      const optimistic: Comment = {
        id: `optimistic-${Date.now()}`,
        task_id: taskId,
        author: { id: me.id, name: me.name, email: me.email, avatar_color: me.avatar_color, title: me.title },
        body,
        created_at: new Date().toISOString(),
        edited_at: null,
        can_edit: true,
        can_delete: true,
      }
      qc.setQueryData<Comment[]>(qk.taskComments(taskId), (old) => [...(old ?? []), optimistic])
      return { prev }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.taskComments(taskId), ctx?.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.taskComments(taskId) })
      void qc.invalidateQueries({ queryKey: qk.taskActivity(taskId) })
      void qc.invalidateQueries({ queryKey: qk.task(taskId) })
    },
  })
}

export function useUpdateComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't edit comment" },
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      unwrap(api.PATCH('/api/v1/comments/{comment_id}', { params: { path: { comment_id: id } }, body: { body } })),
    onSuccess: (updated) =>
      qc.setQueryData<Comment[]>(qk.taskComments(taskId), (old) => old?.map((c) => (c.id === updated.id ? updated : c))),
  })
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't delete comment" },
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/comments/{comment_id}', { params: { path: { comment_id: id } } })),
    onMutate: async (id) => {
      const prev = qc.getQueryData<Comment[]>(qk.taskComments(taskId))
      qc.setQueryData<Comment[]>(qk.taskComments(taskId), (old) => old?.filter((c) => c.id !== id))
      return { prev }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.taskComments(taskId), ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.task(taskId) }),
  })
}

// ─── Attachments ───

export function useAttachments(taskId: string | undefined) {
  return useQuery({
    queryKey: qk.taskAttachments(taskId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/tasks/{task_id}/attachments', { params: { path: { task_id: taskId! } } })),
    enabled: !!taskId,
  })
}

/** Upload with progress (XHR, so we get upload progress events). */
export function useUploadAttachment(taskId: string) {
  const qc = useQueryClient()
  const [progress, setProgress] = React.useState<number | null>(null)
  const mutation = useMutation({
    meta: { errorTitle: 'Upload failed' },
    mutationFn: (file: File) =>
      new Promise<Attachment>((resolve, reject) => {
        const form = new FormData()
        form.append('file', file)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${API_ORIGIN}/api/v1/tasks/${taskId}/attachments`)
        xhr.withCredentials = true
        const token = tokenStore.get()
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total)
        xhr.onload = () => {
          setProgress(null)
          let body: unknown = null
          try {
            body = JSON.parse(xhr.responseText)
          } catch {
            /* empty */
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment)
          else reject(toApiError(xhr.status, body))
        }
        xhr.onerror = () => {
          setProgress(null)
          reject(toApiError(0, null))
        }
        xhr.send(form)
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.taskAttachments(taskId) })
      void qc.invalidateQueries({ queryKey: qk.task(taskId) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  return { ...mutation, progress }
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorTitle: "Couldn't delete attachment" },
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/api/v1/attachments/{attachment_id}', { params: { path: { attachment_id: id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.taskAttachments(taskId) })
      void qc.invalidateQueries({ queryKey: qk.task(taskId) })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

/** Download an attachment with auth and save it with its original name. */
export async function downloadAttachment(att: Attachment) {
  const res = await authFetch(`/api/v1/attachments/${att.id}/download`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = att.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Object URL for an image attachment preview (fetched with auth, revoked on unmount). */
export function useAttachmentPreview(att: Attachment | null | undefined) {
  const id = att?.is_image ? att.id : null
  const query = useQuery({
    queryKey: ['attachment-preview', id],
    queryFn: async () => {
      const res = await authFetch(`/api/v1/attachments/${id}/download?inline=true`)
      return URL.createObjectURL(await res.blob())
    },
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
  return query.data ?? null
}
