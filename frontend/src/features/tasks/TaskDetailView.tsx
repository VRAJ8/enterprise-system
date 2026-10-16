import {
  Bell,
  BellOff,
  Check,
  Clock,
  Copy,
  Download,
  Flag,
  GitBranch,
  Link2,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMe } from '@/app/auth'
import { useWorkspace, wsPath } from '@/app/workspace'
import {
  downloadAttachment,
  useAttachmentPreview,
  useAttachments,
  useComments,
  useCreateComment,
  useDeleteAttachment,
  useDeleteComment,
  useUpdateComment,
  useUploadAttachment,
  type Attachment,
  type Comment,
} from '@/api/hooks/collaboration'
import { useTaskActivity, type Activity } from '@/api/hooks/insights'
import { useMilestones } from '@/api/hooks/projects'
import {
  useCreateTask,
  useDeleteTask,
  useProjectTasks,
  useTaskDependency,
  useUpdateTask,
  useWatchTask,
  type TaskBrief,
  type TaskDetail,
} from '@/api/hooks/tasks'
import { useLogTime, useStartTimer, useStopTimer, useTimer, useElapsed } from '@/api/hooks/time'
import { usePeople } from '@/api/hooks/workspace'
import { ProjectIcon, StatusIcon } from '@/components/domain'
import { Markdown } from '@/components/Markdown'
import { MentionEditor, useMentionEditor } from '@/components/MentionEditor'
import { MilestonePicker, Picker, PropertyButton } from '@/components/pickers'
import {
  AssigneeControl,
  DueDateControl,
  LabelsControl,
  PriorityControl,
  StartDateControl,
  StatusControl,
} from '@/components/task/controls'
import { TaskRow } from '@/components/task/TaskRow'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ProgressBar } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDateTime, formatMinutes, parseDuration, timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'

export function TaskDetailSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/** Everything about one task. Rendered in the peek panel and on the full task page. */
export function TaskDetailView({ task, mode, onClose }: { task: TaskDetail; mode: 'panel' | 'page'; onClose?: () => void }) {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const editable = task.can_edit
  const del = useDeleteTask()
  const watch = useWatchTask(task.id)
  const url = `${window.location.origin}${wsPath(ws, 'tasks', task.ref)}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <Link
          to={wsPath(ws, 'projects', task.project.key)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ProjectIcon project={task.project} size="sm" />
          {task.project.name}
        </Link>
        <span className="text-subtle">/</span>
        {task.parent && (
          <>
            <ParentLink parent={task.parent} />
            <span className="text-subtle">/</span>
          </>
        )}
        <span className="font-mono text-xs text-subtle">{task.ref}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Tip content={task.is_watching ? 'Stop watching' : 'Watch for updates'}>
            <Button variant="ghost" size="icon-sm" onClick={() => watch.mutate(!task.is_watching)} aria-label="Watch">
              {task.is_watching ? <Bell className="text-primary" /> : <BellOff />}
            </Button>
          </Tip>
          <Tip content="Copy link">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(url)
                toast.success('Link copied')
              }}
            >
              <Link2 />
            </Button>
          </Tip>
          {mode === 'panel' && (
            <Tip content="Open full page">
              <Button variant="ghost" size="icon-sm" asChild aria-label="Open full page">
                <Link to={wsPath(ws, 'tasks', task.ref)}>
                  <Maximize2 />
                </Link>
              </Button>
            </Tip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(task.ref)
                  toast.success(`Copied ${task.ref}`)
                }}
              >
                <Copy /> Copy reference
              </DropdownMenuItem>
              {editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onSelect={() => {
                      del.mutate(task)
                      if (mode === 'page') navigate(wsPath(ws, 'projects', task.project.key))
                      else onClose?.()
                    }}
                  >
                    <Trash2 /> Delete task
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', mode === 'page' && 'lg:grid lg:grid-cols-[1fr_300px]')}>
        <div className="space-y-6 px-5 py-5 sm:px-6">
          <TitleEditor task={task} editable={editable} />
          {mode === 'panel' && <Properties task={task} editable={editable} />}
          <Description task={task} editable={editable} />
          <Subtasks task={task} editable={editable} />
          <Dependencies task={task} editable={editable} />
          <Attachments task={task} editable={editable} />
          <Conversation task={task} />
        </div>
        {mode === 'page' && (
          <aside className="border-l border-border/70 bg-muted/20 px-4 py-5">
            <Properties task={task} editable={editable} />
          </aside>
        )}
      </div>
    </div>
  )
}

function ParentLink({ parent }: { parent: TaskBrief }) {
  return (
    <Link to={`?task=${parent.ref}`} className="max-w-[10rem] truncate text-xs text-muted-foreground hover:text-foreground" title={parent.title}>
      {parent.ref}
    </Link>
  )
}

// ─── Title ───

function TitleEditor({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const update = useUpdateTask()
  const [value, setValue] = React.useState(task.title)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => setValue(task.title), [task.title])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])
  const save = () => {
    const title = value.trim()
    if (title && title !== task.title) update.mutate({ id: task.id, title })
    else setValue(task.title)
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={!editable}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
        if (e.key === 'Escape') {
          setValue(task.title)
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
      className="w-full resize-none bg-transparent text-xl font-semibold leading-snug tracking-tight outline-none placeholder:text-subtle"
      aria-label="Task title"
    />
  )
}

// ─── Properties ───

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Properties({ task, editable }: { task: TaskDetail; editable: boolean }) {
  return (
    <div className="space-y-0.5">
      <Prop label="Status">
        <StatusControl task={task} disabled={!editable} variant="full" />
      </Prop>
      <Prop label="Priority">
        <PriorityControl task={task} disabled={!editable} variant="full" />
      </Prop>
      <Prop label="Assignee">
        <AssigneeControl task={task} disabled={!editable} variant="full" />
      </Prop>
      <Prop label="Labels">
        <LabelsControl task={task} disabled={!editable} variant="full" />
      </Prop>
      <Prop label="Start">
        <StartDateControl task={task} disabled={!editable} />
      </Prop>
      <Prop label="Due">
        <DueDateControl task={task} disabled={!editable} variant="full" />
      </Prop>
      <Prop label="Estimate">
        <EstimateControl task={task} disabled={!editable} />
      </Prop>
      <Prop label="Milestone">
        <MilestoneControl task={task} disabled={!editable} />
      </Prop>
      <Prop label="Time">
        <TimeControl task={task} disabled={!editable} />
      </Prop>
      <Prop label="Reporter">
        <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <UserAvatar user={task.reporter} size="sm" /> {task.reporter?.name ?? 'Unknown'} · {timeAgo(task.created_at)}
        </span>
      </Prop>
    </div>
  )
}

function EstimateControl({ task, disabled }: { task: TaskDetail; disabled: boolean }) {
  const update = useUpdateTask()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState('')
  if (editing) {
    return (
      <Input
        autoFocus
        className="h-7 w-28 text-xs"
        placeholder="e.g. 4h, 90m"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
          if (e.key === 'Enter') {
            const minutes = value.trim() ? parseDuration(value) : 0
            if (minutes == null) return toast.error('Try a duration like 4h or 1h30m')
            update.mutate({ id: task.id, estimate_hours: minutes ? Math.round((minutes / 60) * 100) / 100 : null })
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <PropertyButton
      disabled={disabled}
      empty={task.estimate_hours == null}
      onClick={() => {
        setValue(task.estimate_hours ? `${task.estimate_hours}h` : '')
        setEditing(true)
      }}
    >
      <Clock className="size-3.5" />
      {task.estimate_hours != null ? `${task.estimate_hours}h` : 'Add estimate'}
    </PropertyButton>
  )
}

function MilestoneControl({ task, disabled }: { task: TaskDetail; disabled: boolean }) {
  const update = useUpdateTask()
  const milestones = useMilestones(task.project.id)
  return (
    <MilestonePicker
      milestones={milestones.data ?? []}
      value={task.milestone_id}
      onChange={(id) => update.mutate({ id: task.id, milestone_id: id })}
      disabled={disabled}
    >
      <PropertyButton empty={!task.milestone} disabled={disabled}>
        <Flag className="size-3.5" /> {task.milestone?.name ?? 'No milestone'}
      </PropertyButton>
    </MilestonePicker>
  )
}

function TimeControl({ task, disabled }: { task: TaskDetail; disabled: boolean }) {
  const timer = useTimer()
  const start = useStartTimer()
  const stop = useStopTimer()
  const log = useLogTime(task.id)
  const running = timer.data?.entry?.task.id === task.id ? timer.data.entry : null
  const elapsed = useElapsed(running?.started_at)
  const [adding, setAdding] = React.useState(false)
  const [value, setValue] = React.useState('')
  const estimateMinutes = (task.estimate_hours ?? 0) * 60

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {running ? (
        <Button size="xs" variant="subtle" onClick={() => stop.mutate()}>
          <Pause /> <span className="font-mono tabular-nums">{elapsed}</span>
        </Button>
      ) : (
        <Button size="xs" variant="outline" disabled={disabled} onClick={() => start.mutate({ taskId: task.id })}>
          <Play /> Start timer
        </Button>
      )}
      {adding ? (
        <Input
          autoFocus
          className="h-6 w-24 text-xs"
          placeholder="1h30m"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAdding(false)
            if (e.key === 'Enter') {
              const minutes = parseDuration(value)
              if (!minutes) return toast.error('Try a duration like 45m or 1h30m')
              log.mutate({ minutes, note: '' }, { onSuccess: () => toast.success(`Logged ${formatMinutes(minutes)}`) })
              setAdding(false)
              setValue('')
            }
          }}
        />
      ) : (
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setAdding(true)}>
          <Plus /> Log
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        {formatMinutes(task.time_logged_minutes) || '0m'}
        {estimateMinutes > 0 && <span className="text-subtle"> / {formatMinutes(estimateMinutes)}</span>}
      </span>
    </div>
  )
}

// ─── Description ───

function Description({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const update = useUpdateTask()
  const people = usePeople()
  const editor = useMentionEditor(task.description)
  const [editing, setEditing] = React.useState(false)
  const save = () => {
    const body = editor.serialize()
    if (body !== task.description) update.mutate({ id: task.id, description: body })
    setEditing(false)
  }
  if (editing) {
    return (
      <div className="space-y-2">
        <MentionEditor
          editor={editor}
          people={people}
          autoFocus
          rows={6}
          onSubmit={save}
          placeholder="Add context, acceptance criteria, links… Markdown and @mentions work."
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              editor.reset(task.description)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div
      className={cn('group relative -mx-2 rounded-md px-2 py-1', editable && 'cursor-text hover:bg-accent/40')}
      onClick={() => {
        if (!editable || window.getSelection()?.toString()) return
        editor.reset(task.description)
        setEditing(true)
      }}
    >
      {task.description ? (
        <Markdown>{task.description}</Markdown>
      ) : (
        <p className="text-sm text-subtle">{editable ? 'Add a description…' : 'No description'}</p>
      )}
      {editable && task.description && (
        <Pencil className="absolute right-2 top-2 size-3.5 text-subtle opacity-0 group-hover:opacity-100" />
      )}
    </div>
  )
}

// ─── Subtasks ───

function Section({ title, count, action, children }: { title: string; count?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {title}
        {count != null && <span className="text-subtle">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  )
}

function Subtasks({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const create = useCreateTask()
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState('')
  if (task.parent_id && !task.subtasks.length) return null
  const done = task.subtasks.filter((s) => s.status.category === 'done').length
  const submit = () => {
    if (!title.trim()) return setAdding(false)
    create.mutate({
      projectId: task.project.id,
      title: title.trim(),
      parent_id: task.id,
      description: '',
      priority: 'none',
      placement: 'bottom',
    })
    setTitle('')
  }
  return (
    <Section
      title="Sub-tasks"
      count={task.subtasks.length ? `${done}/${task.subtasks.length}` : undefined}
      action={
        editable &&
        !task.parent_id && (
          <Button size="xs" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        )
      }
    >
      {task.subtasks.length > 0 && <ProgressBar value={done / task.subtasks.length} className="mb-2 h-1" />}
      <div className="overflow-hidden rounded-lg border border-border/70">
        {task.subtasks.map((s) => (
          <TaskRow key={s.id} task={s} editable={editable} className="last:border-0" />
        ))}
        {adding && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <GitBranch className="size-3.5 text-subtle" />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setAdding(false)
              }}
              placeholder="Sub-task title, Enter to add"
              className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
        )}
        {!task.subtasks.length && !adding && (
          <button
            disabled={!editable}
            onClick={() => setAdding(true)}
            className="w-full px-3 py-2.5 text-left text-xs text-subtle hover:bg-accent/40"
          >
            Break this down into smaller steps…
          </button>
        )}
      </div>
    </Section>
  )
}

// ─── Dependencies ───

function Dependencies({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const dep = useTaskDependency()
  const [picking, setPicking] = React.useState(false)
  const candidates = useProjectTasks(picking ? task.project.id : undefined, { state: 'open' })
  const taken = new Set([task.id, ...task.blocked_by.map((t) => t.id), ...task.blocking.map((t) => t.id)])
  if (!task.blocked_by.length && !task.blocking.length && !editable) return null

  const row = (t: TaskBrief, kind: 'blocked_by' | 'blocking') => (
    <div key={t.id} className="group flex h-8 items-center gap-2 px-3 text-sm">
      <StatusIcon category={t.status.category} color={t.status.color} />
      <Link to={`?task=${t.ref}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
        <span className="font-mono text-2xs text-subtle">{t.ref}</span>
        <span className="truncate">{t.title}</span>
      </Link>
      {editable && (
        <button
          className="text-subtle opacity-0 hover:text-foreground group-hover:opacity-100"
          aria-label="Remove dependency"
          onClick={() =>
            kind === 'blocked_by'
              ? dep.remove.mutate({ taskId: task.id, blockerId: t.id })
              : dep.remove.mutate({ taskId: t.id, blockerId: task.id })
          }
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )

  return (
    <Section
      title="Dependencies"
      action={
        editable && (
          <Picker
            open={picking}
            onOpenChange={setPicking}
            value={null}
            placeholder="Blocked by…"
            emptyText="No other open tasks"
            options={(candidates.data?.items ?? [])
              .filter((c) => !taken.has(c.id))
              .map((c) => ({ value: c.id, label: `${c.ref} ${c.title}`, icon: <StatusIcon category={c.status.category} color={c.status.color} /> }))}
            onChange={(id) => dep.add.mutate({ taskId: task.id, blockerId: id })}
          >
            <Button size="xs" variant="ghost">
              <Plus /> Blocked by
            </Button>
          </Picker>
        )
      }
    >
      {task.blocked_by.length + task.blocking.length === 0 ? (
        <p className="text-xs text-subtle">No dependencies. Mark what must finish first so the team sees blockers early.</p>
      ) : (
        <div className="space-y-2">
          {task.blocked_by.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-warning/30 bg-warning/5">
              <p className="px-3 pt-2 text-2xs font-medium uppercase tracking-wide text-warning">Blocked by</p>
              {task.blocked_by.map((t) => row(t, 'blocked_by'))}
            </div>
          )}
          {task.blocking.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <p className="px-3 pt-2 text-2xs font-medium uppercase tracking-wide text-subtle">Blocking</p>
              {task.blocking.map((t) => row(t, 'blocking'))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ─── Attachments ───

function Attachments({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const list = useAttachments(task.id)
  const upload = useUploadAttachment(task.id)
  const input = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const files = list.data ?? []
  const onFiles = (fl: FileList | null) => fl && Array.from(fl).forEach((f) => upload.mutate(f))

  return (
    <Section
      title="Attachments"
      count={files.length || undefined}
      action={
        editable && (
          <Button size="xs" variant="ghost" onClick={() => input.current?.click()}>
            <Paperclip /> Attach
          </Button>
        )
      }
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <div
        onDragOver={(e) => {
          if (!editable) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (editable) onFiles(e.dataTransfer.files)
        }}
        className={cn('rounded-lg transition-colors', dragOver && 'bg-primary-soft/40 ring-2 ring-primary/40')}
      >
        {upload.progress != null && <ProgressBar value={upload.progress} className="mb-2 h-1" />}
        {files.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {files.map((a) => (
              <AttachmentTile key={a.id} att={a} taskId={task.id} />
            ))}
          </div>
        ) : (
          editable && <p className="py-1 text-xs text-subtle">Drop files here or use Attach (up to 25 MB each).</p>
        )}
      </div>
    </Section>
  )
}

function AttachmentTile({ att, taskId }: { att: Attachment; taskId: string }) {
  const preview = useAttachmentPreview(att)
  const del = useDeleteAttachment(taskId)
  const size = att.size_bytes > 1e6 ? `${(att.size_bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(att.size_bytes / 1e3))} KB`
  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-surface p-2">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <Paperclip className="size-4 text-subtle" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{att.filename}</p>
        <p className="text-2xs text-subtle">
          {size} · {att.uploader?.name ?? 'Someone'} · {timeAgo(att.created_at)}
        </p>
      </div>
      <Button variant="ghost" size="icon-xs" onClick={() => void downloadAttachment(att)} aria-label="Download">
        <Download />
      </Button>
      {att.can_delete && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => del.mutate(att.id)}
          aria-label="Delete attachment"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}

// ─── Comments & activity ───

function Conversation({ task }: { task: TaskDetail }) {
  const [tab, setTab] = React.useState<'comments' | 'activity'>('comments')
  return (
    <section>
      <div className="mb-3 flex items-center gap-1 border-b border-border/70">
        {(['comments', 'activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-2 pb-2 text-xs font-medium capitalize transition-colors',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
            {t === 'comments' && task.comment_count > 0 && <span className="ml-1 text-subtle">{task.comment_count}</span>}
          </button>
        ))}
      </div>
      {tab === 'comments' ? <Comments task={task} /> : <ActivityFeed taskId={task.id} />}
    </section>
  )
}

function Comments({ task }: { task: TaskDetail }) {
  const me = useMe()
  const people = usePeople()
  const comments = useComments(task.id)
  const create = useCreateComment(task.id)
  const editor = useMentionEditor('')
  const submit = () => {
    const body = editor.serialize()
    if (!body) return
    create.mutate(body)
    editor.reset('')
  }
  return (
    <div className="space-y-4">
      {(comments.data ?? []).map((c) => (
        <CommentItem key={c.id} comment={c} taskId={task.id} />
      ))}
      <div className="flex gap-2.5">
        <UserAvatar user={me} />
        <div className="flex-1 space-y-2">
          <MentionEditor
            editor={editor}
            people={people}
            rows={2}
            onSubmit={submit}
            placeholder="Leave a comment… @mention to notify someone"
          />
          {editor.text.trim() && (
            <div className="flex justify-end">
              <Button size="sm" onClick={submit}>
                Comment <span className="text-2xs opacity-70">⌘↵</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CommentItem({ comment, taskId }: { comment: Comment; taskId: string }) {
  const people = usePeople()
  const update = useUpdateComment(taskId)
  const del = useDeleteComment(taskId)
  const editor = useMentionEditor(comment.body)
  const [editing, setEditing] = React.useState(false)
  const pending = comment.id.startsWith('optimistic-')
  return (
    <div className={cn('group flex gap-2.5', pending && 'opacity-60')}>
      <UserAvatar user={comment.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{comment.author?.name ?? 'Deleted user'}</span>
          <Tip content={formatDateTime(comment.created_at)}>
            <span className="text-subtle">{timeAgo(comment.created_at)}</span>
          </Tip>
          {comment.edited_at && <span className="text-subtle">(edited)</span>}
          {!pending && (comment.can_edit || comment.can_delete) && (
            <div className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100">
              {comment.can_edit && (
                <Button variant="ghost" size="icon-xs" onClick={() => setEditing(true)} aria-label="Edit comment">
                  <Pencil />
                </Button>
              )}
              {comment.can_delete && (
                <Button variant="ghost" size="icon-xs" onClick={() => del.mutate(comment.id)} aria-label="Delete comment">
                  <Trash2 />
                </Button>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <MentionEditor
              editor={editor}
              people={people}
              autoFocus
              rows={3}
              onSubmit={() => {
                update.mutate({ id: comment.id, body: editor.serialize() })
                setEditing(false)
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  update.mutate({ id: comment.id, body: editor.serialize() })
                  setEditing(false)
                }}
              >
                <Check /> Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 rounded-lg rounded-tl-sm bg-muted/50 px-3 py-2">
            <Markdown className="text-sm">{comment.body}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
}

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  due_date: 'due date',
  start_date: 'start date',
  milestone: 'milestone',
  labels: 'labels',
  title: 'title',
  estimate_hours: 'estimate',
  description: 'description',
  parent: 'parent',
}

export function describeActivity(a: Activity): React.ReactNode {
  const data = (a.data ?? {}) as Record<string, unknown>
  const changes = data.changes as Record<string, { from?: unknown; to?: unknown }> | undefined
  const fmt = (v: unknown) => (v == null || v === '' ? 'none' : Array.isArray(v) ? v.join(', ') || 'none' : String(v))
  switch (a.verb) {
    case 'created':
      return 'created the task'
    case 'commented':
      return 'commented'
    case 'attached':
      return `attached ${String(data.filename ?? 'a file')}`
    case 'detached':
      return `removed ${String(data.filename ?? 'an attachment')}`
    case 'deleted':
      return 'deleted the task'
    case 'restored':
      return 'restored the task'
    case 'logged_time':
    case 'time_logged':
      return `logged ${formatMinutes(Number(data.minutes ?? 0))}`
    case 'updated':
      if (!changes) return 'updated the task'
      return Object.entries(changes)
        .map(([field, ch]) =>
          field === 'description' || field === 'title'
            ? `changed the ${FIELD_LABEL[field] ?? field}`
            : `changed ${FIELD_LABEL[field] ?? field} from ${fmt(ch.from)} to ${fmt(ch.to)}`,
        )
        .join(', ')
    default:
      return a.verb.replace(/_/g, ' ')
  }
}

function ActivityFeed({ taskId }: { taskId: string }) {
  const activity = useTaskActivity(taskId)
  if (activity.isLoading) return <Skeleton className="h-20 w-full" />
  return (
    <ol className="relative space-y-3 before:absolute before:inset-y-1 before:left-[11px] before:w-px before:bg-border">
      {(activity.data ?? []).map((a) => (
        <li key={a.id} className="relative flex items-start gap-2.5 text-xs">
          <UserAvatar user={a.actor} size="sm" className="ring-4 ring-background" />
          <p className="pt-0.5 text-muted-foreground">
            <span className="font-medium text-foreground">{a.actor?.name ?? 'System'}</span> {describeActivity(a)}
            <span className="ml-1.5 text-subtle">{timeAgo(a.created_at)}</span>
          </p>
        </li>
      ))}
    </ol>
  )
}

