import { Archive, Check, Flag, GripVertical, Plus, Trash2, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '@/app/auth'
import { useWorkspace, wsPath } from '@/app/workspace'
import {
  useAddProjectMember,
  useCreateMilestone,
  useCreateStatus,
  useDeleteMilestone,
  useDeleteProject,
  useDeleteStatus,
  useMilestones,
  useProjectMembers,
  useRemoveProjectMember,
  useStatuses,
  useUpdateMilestone,
  useUpdateProject,
  useUpdateProjectMember,
  useUpdateStatus,
  type ProjectRole,
} from '@/api/hooks/projects'
import { usePeople } from '@/api/hooks/workspace'
import { CATEGORY_LABEL, PROJECT_COLORS, StatusIcon, type StatusCategory } from '@/components/domain'
import { AssigneePicker, DatePicker, Picker, PropertyButton } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useProjectContext } from './ProjectLayout'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border/60 py-8 first:pt-2 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export default function ProjectSettingsPage() {
  const { isLead } = useProjectContext()
  if (!isLead) return <EmptyState title="Only project leads can change settings" />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <General />
        <Members />
        <Workflow />
        <Milestones />
        <Danger />
      </div>
    </div>
  )
}

function General() {
  const { project } = useProjectContext()
  const update = useUpdateProject(project.id)
  const people = usePeople()
  const me = useMe()
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState(project.description)
  const dirty = name !== project.name || description !== project.description
  return (
    <Section title="General" description="How the project appears across the workspace.">
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Description" />
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => update.mutate({ color: c })}
              className="flex size-6 items-center justify-center rounded-full"
              style={{ background: c }}
              aria-label={`Color ${c}`}
            >
              {project.color === c && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Picker
            options={(['planning', 'active', 'on_hold', 'completed', 'archived'] as const).map((s) => ({ value: s, label: s.replace('_', ' ') }))}
            value={project.status}
            onChange={(v) => update.mutate({ status: v as typeof project.status })}
          >
            <PropertyButton className="capitalize">Status: {project.status.replace('_', ' ')}</PropertyButton>
          </Picker>
          <AssigneePicker people={people} meId={me.id} value={project.lead?.id} onChange={(id) => update.mutate({ lead_id: id })}>
            <PropertyButton>
              <UserAvatar user={project.lead} size="sm" /> Lead: {project.lead?.name ?? 'None'}
            </PropertyButton>
          </AssigneePicker>
          <DatePicker value={project.start_date} onChange={(d) => update.mutate({ start_date: d })} title="Start date">
            <PropertyButton empty={!project.start_date}>Start {project.start_date ? formatDate(project.start_date) : '—'}</PropertyButton>
          </DatePicker>
          <DatePicker value={project.target_date} onChange={(d) => update.mutate({ target_date: d })} title="Target date">
            <PropertyButton empty={!project.target_date}>Target {project.target_date ? formatDate(project.target_date) : '—'}</PropertyButton>
          </DatePicker>
          <PropertyButton onClick={() => update.mutate({ visibility: project.visibility === 'private' ? 'workspace' : 'private' })}>
            {project.visibility === 'private' ? 'Private: members only' : 'Visible to the workspace'}
          </PropertyButton>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => update.mutate({ name: name.trim(), description })} disabled={!name.trim()}>
              Save changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setName(project.name), setDescription(project.description))}>
              Reset
            </Button>
          </div>
        )}
      </div>
    </Section>
  )
}

const ROLES: { value: ProjectRole; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
]

function Members() {
  const { project } = useProjectContext()
  const members = useProjectMembers(project.id)
  const people = usePeople()
  const add = useAddProjectMember(project.id)
  const setRole = useUpdateProjectMember(project.id)
  const remove = useRemoveProjectMember(project.id)
  const ids = new Set((members.data ?? []).map((m) => m.user.id))
  return (
    <Section
      title="Members"
      description={
        project.visibility === 'private'
          ? 'Only these people can see this private project.'
          : 'Everyone in the workspace can view; these people get explicit roles.'
      }
    >
      <div className="overflow-hidden rounded-lg border border-border">
        {(members.data ?? []).map((m) => (
          <div key={m.user.id} className="group flex items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-0">
            <UserAvatar user={m.user} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
            </div>
            <Picker options={ROLES} value={m.role} onChange={(r) => setRole.mutate({ userId: m.user.id, role: r as ProjectRole })}>
              <Button variant="ghost" size="sm" className="capitalize">
                {m.role}
              </Button>
            </Picker>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100" onClick={() => remove.mutate(m.user.id)} aria-label="Remove">
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <AssigneePicker people={people.filter((p) => !ids.has(p.id))} onChange={(id) => id && add.mutate({ user_id: id, role: 'member' })}>
        <Button variant="outline" size="sm" className="mt-3">
          <UserPlus /> Add member
        </Button>
      </AssigneePicker>
    </Section>
  )
}

const CATEGORIES: StatusCategory[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'canceled']

function Workflow() {
  const { project } = useProjectContext()
  const statuses = useStatuses(project.id)
  const create = useCreateStatus(project.id)
  const update = useUpdateStatus(project.id)
  const del = useDeleteStatus(project.id)
  const [name, setName] = React.useState('')
  const list = [...(statuses.data ?? [])].sort((a, b) => a.position - b.position)
  return (
    <Section title="Workflow" description="Columns on the board. The category drives progress, health and cycle time.">
      <div className="overflow-hidden rounded-lg border border-border">
        {list.map((s) => (
          <div key={s.id} className="group flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-sm last:border-0">
            <GripVertical className="size-3.5 text-subtle" />
            <StatusIcon category={s.category} color={s.color} />
            <input
              defaultValue={s.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && update.mutate({ id: s.id, name: e.target.value.trim() })}
              className="h-7 min-w-0 flex-1 rounded bg-transparent px-1 outline-none focus:bg-accent/50"
            />
            <Picker options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} value={s.category} onChange={(c) => update.mutate({ id: s.id, category: c as StatusCategory })}>
              <Button variant="ghost" size="xs">
                {CATEGORY_LABEL[s.category]}
              </Button>
            </Picker>
            <span className="w-14 text-right text-2xs text-subtle">{s.task_count} tasks</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100"
              aria-label="Delete status"
              onClick={() => {
                const fallback = list.find((x) => x.id !== s.id && x.category === s.category) ?? list.find((x) => x.id !== s.id)
                del.mutate({ id: s.id, moveTo: s.task_count ? fallback?.id : undefined })
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          create.mutate({ name: name.trim(), category: 'in_progress', color: '#6366f1' })
          setName('')
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New status, e.g. QA" className="max-w-xs" />
        <Button type="submit" variant="outline" size="md">
          <Plus /> Add
        </Button>
      </form>
    </Section>
  )
}

function Milestones() {
  const { project } = useProjectContext()
  const milestones = useMilestones(project.id)
  const create = useCreateMilestone(project.id)
  const update = useUpdateMilestone(project.id)
  const del = useDeleteMilestone(project.id)
  const [name, setName] = React.useState('')
  const [due, setDue] = React.useState<string | null>(null)
  return (
    <Section title="Milestones" description="Key dates. Tasks can be attached to a milestone; at-risk milestones are flagged on the overview.">
      <div className="overflow-hidden rounded-lg border border-border">
        {(milestones.data ?? []).map((m) => (
          <div key={m.id} className="group flex items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-0">
            <Flag className={cn('size-4', m.completed_at ? 'text-success' : 'text-warning')} />
            <span className={cn('flex-1 truncate', m.completed_at && 'text-muted-foreground line-through')}>{m.name}</span>
            <span className="text-xs text-muted-foreground">
              {m.task_done}/{m.task_total}
            </span>
            <DatePicker value={m.due_date} onChange={(d) => update.mutate({ id: m.id, due_date: d })} title="Due date">
              <PropertyButton empty={!m.due_date}>{m.due_date ? formatDate(m.due_date) : 'No date'}</PropertyButton>
            </DatePicker>
            <Button variant="ghost" size="xs" onClick={() => update.mutate({ id: m.id, completed: !m.completed_at })}>
              {m.completed_at ? 'Reopen' : 'Complete'}
            </Button>
            <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" onClick={() => del.mutate(m.id)} aria-label="Delete">
              <Trash2 />
            </Button>
          </div>
        ))}
        {!milestones.data?.length && <p className="px-3 py-3 text-xs text-subtle">No milestones yet.</p>}
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          create.mutate({ name: name.trim(), description: '', due_date: due })
          setName('')
          setDue(null)
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Milestone name, e.g. Beta launch" className="max-w-xs" />
        <DatePicker value={due} onChange={setDue} title="Due date">
          <PropertyButton type="button" empty={!due}>
            {due ? formatDate(due) : 'Due date'}
          </PropertyButton>
        </DatePicker>
        <Button type="submit" variant="outline">
          <Plus /> Add
        </Button>
      </form>
    </Section>
  )
}

function Danger() {
  const { project } = useProjectContext()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const update = useUpdateProject(project.id)
  const del = useDeleteProject()
  const [confirm, setConfirm] = React.useState('')
  return (
    <Section title="Danger zone" description="Archiving hides the project but keeps everything. Deleting is permanent.">
      <div className="space-y-4 rounded-lg border border-danger/30 p-4">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm">Archive this project</p>
          <Button variant="outline" size="sm" onClick={() => update.mutate({ status: project.status === 'archived' ? 'active' : 'archived' })}>
            <Archive /> {project.status === 'archived' ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm">
            Delete permanently. Type <span className="font-mono font-semibold">{project.key}</span> to confirm.
          </p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-28 font-mono" />
          <Button
            variant="destructive"
            size="sm"
            disabled={confirm !== project.key}
            onClick={() => del.mutate(project.id, { onSuccess: () => navigate(wsPath(ws, 'projects')) })}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </Section>
  )
}
