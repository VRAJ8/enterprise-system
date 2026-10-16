import { CalendarDays, Clock, Flag, Tag } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useMe } from '@/app/auth'
import { useTaskPanel } from '@/app/task-panel'
import { useUI } from '@/app/ui-store'
import { useMilestones, useProjects, useStatuses, canEditProject } from '@/api/hooks/projects'
import { useCreateTask } from '@/api/hooks/tasks'
import { useLabels, usePeople } from '@/api/hooks/workspace'
import { LabelChip, PRIORITY_LABEL, PriorityIcon, ProjectIcon, StatusIcon, type Priority } from '@/components/domain'
import {
  AssigneePicker,
  DatePicker,
  LabelPicker,
  MilestonePicker,
  PriorityPicker,
  ProjectPicker,
  PropertyButton,
  StatusPicker,
} from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDate, parseDuration } from '@/lib/dates'
import { modKey } from '@/lib/utils'

export default function CreateTaskDialog() {
  const defaults = useUI((s) => s.createTask)
  const close = useUI((s) => s.closeCreateTask)
  return (
    <Dialog open={!!defaults} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl gap-0 p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">New task</DialogTitle>
        {defaults && <Form key={JSON.stringify(defaults)} />}
      </DialogContent>
    </Dialog>
  )
}

function Form() {
  const defaults = useUI((s) => s.createTask)!
  const close = useUI((s) => s.closeCreateTask)
  const me = useMe()
  const panel = useTaskPanel()
  const projects = (useProjects().data ?? []).filter(canEditProject)
  const people = usePeople()
  const labels = useLabels()
  const create = useCreateTask()

  const lastProject = localStorage.getItem('ph-last-project')
  const [projectId, setProjectId] = React.useState<string | undefined>(
    defaults.projectId ?? projects.find((p) => p.id === lastProject)?.id ?? projects[0]?.id,
  )
  React.useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projectId, projects])
  const project = projects.find((p) => p.id === projectId)
  const statuses = useStatuses(projectId)
  const milestones = useMilestones(projectId)

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [statusId, setStatusId] = React.useState<string | undefined>(defaults.statusId)
  const [priority, setPriority] = React.useState<Priority>('none')
  const [assigneeId, setAssigneeId] = React.useState<string | null>(
    defaults.assigneeId !== undefined ? defaults.assigneeId : null,
  )
  const [labelIds, setLabelIds] = React.useState<string[]>([])
  const [due, setDue] = React.useState<string | null>(defaults.dueDate ?? null)
  const [milestoneId, setMilestoneId] = React.useState<string | null>(defaults.milestoneId ?? null)
  const [estimate, setEstimate] = React.useState('')
  const [more, setMore] = React.useState(false)
  const titleRef = React.useRef<HTMLInputElement>(null)

  const statusList = statuses.data ?? []
  const status = statusList.find((s) => s.id === statusId) ?? statusList.find((s) => s.category === 'todo') ?? statusList[0]
  const assignee = people.find((p) => p.id === assigneeId)
  const milestone = milestones.data?.find((m) => m.id === milestoneId)

  const submit = () => {
    if (!title.trim() || !projectId) return
    const minutes = estimate.trim() ? parseDuration(estimate) : null
    if (estimate.trim() && minutes == null) return toast.error('Estimate should look like 4h or 1h30m')
    localStorage.setItem('ph-last-project', projectId)
    create.mutate(
      {
        projectId,
        title: title.trim(),
        description,
        status_id: status?.id ?? null,
        priority,
        assignee_id: assigneeId,
        parent_id: defaults.parentId ?? null,
        milestone_id: milestoneId,
        due_date: due,
        estimate_hours: minutes ? Math.round((minutes / 60) * 100) / 100 : null,
        label_ids: labelIds,
        placement: 'bottom',
      },
      {
        onSuccess: (task) => {
          toast.success(`Created ${task.ref}`, {
            description: task.title,
            action: { label: 'Open', onClick: () => panel.open(task.ref) },
          })
          if (more) {
            setTitle('')
            setDescription('')
            titleRef.current?.focus()
          } else close()
        },
      },
    )
  }

  if (!projects.length) {
    return <p className="p-6 text-sm text-muted-foreground">You need edit access to a project before you can add tasks.</p>
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      <div className="flex items-center gap-2 px-5 pt-4 text-xs text-muted-foreground">
        <ProjectPicker projects={projects} value={projectId} onChange={(id) => {
          setProjectId(id)
          setStatusId(undefined)
          setMilestoneId(null)
        }}>
          <PropertyButton>
            {project && <ProjectIcon project={project} size="sm" />}
            {project?.name ?? 'Choose project'}
          </PropertyButton>
        </ProjectPicker>
        <span className="text-subtle">›</span>
        <span>{defaults.parentId ? 'New sub-task' : 'New task'}</span>
      </div>
      <div className="px-5 pt-3">
        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Task title"
          maxLength={300}
          className="w-full bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-subtle"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Add description… (Markdown supported)"
          className="mt-2 w-full resize-none bg-transparent text-sm outline-none placeholder:text-subtle"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
        <StatusPicker statuses={statusList} value={status?.id} onChange={setStatusId}>
          <PropertyButton>
            {status && <StatusIcon category={status.category} color={status.color} />} {status?.name ?? 'Status'}
          </PropertyButton>
        </StatusPicker>
        <PriorityPicker value={priority} onChange={setPriority}>
          <PropertyButton empty={priority === 'none'}>
            <PriorityIcon priority={priority} /> {priority === 'none' ? 'Priority' : PRIORITY_LABEL[priority]}
          </PropertyButton>
        </PriorityPicker>
        <AssigneePicker people={people} value={assigneeId} onChange={setAssigneeId} meId={me.id}>
          <PropertyButton empty={!assignee}>
            <UserAvatar user={assignee} size="sm" /> {assignee?.name ?? 'Assignee'}
          </PropertyButton>
        </AssigneePicker>
        <LabelPicker
          labels={labels.data ?? []}
          values={labelIds}
          onToggle={(id, on) => setLabelIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))}
        >
          <PropertyButton empty={!labelIds.length}>
            {labelIds.length ? (
              (labels.data ?? [])
                .filter((l) => labelIds.includes(l.id))
                .map((l) => <LabelChip key={l.id} label={l} />)
            ) : (
              <>
                <Tag className="size-3.5" /> Labels
              </>
            )}
          </PropertyButton>
        </LabelPicker>
        <DatePicker value={due} onChange={setDue} title="Due date">
          <PropertyButton empty={!due}>
            <CalendarDays className="size-3.5" /> {due ? formatDate(due) : 'Due date'}
          </PropertyButton>
        </DatePicker>
        {!!milestones.data?.length && (
          <MilestonePicker milestones={milestones.data} value={milestoneId} onChange={setMilestoneId}>
            <PropertyButton empty={!milestone}>
              <Flag className="size-3.5" /> {milestone?.name ?? 'Milestone'}
            </PropertyButton>
          </MilestonePicker>
        )}
        <label className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground focus-within:border-ring">
          <Clock className="size-3.5" />
          <input
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="Estimate"
            className="w-16 bg-transparent outline-none placeholder:text-subtle"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 border-t border-border/70 px-5 py-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={more} onCheckedChange={setMore} /> Create more
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={create.isPending} disabled={!title.trim()}>
            Create task <span className="text-2xs opacity-70">{modKey}↵</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
