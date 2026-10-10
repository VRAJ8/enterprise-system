/**
 * Connected task property controls: each renders the current value and edits it in place
 * (optimistically) through useUpdateTask. Used by list rows, board cards, the task panel and bulk bars.
 */
import { CalendarDays, Plus, Tag } from 'lucide-react'
import * as React from 'react'
import { useMe } from '@/app/auth'
import { useStatuses } from '@/api/hooks/projects'
import { useUpdateTask, type Task } from '@/api/hooks/tasks'
import { useLabels, useMembers } from '@/api/hooks/workspace'
import { DueDate, LabelChip, PRIORITY_LABEL, PriorityIcon, StatusIcon, isClosed } from '@/components/domain'
import {
  AssigneePicker,
  DatePicker,
  LabelPicker,
  PriorityPicker,
  PropertyButton,
  StatusPicker,
} from '@/components/pickers'
import { Tip } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

type ControlProps = {
  task: Task
  disabled?: boolean
  /** "icon" = compact for rows/cards; "full" = labelled for the task panel */
  variant?: 'icon' | 'full'
  className?: string
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function StatusControl({ task, disabled, variant = 'icon', className }: ControlProps) {
  const update = useUpdateTask()
  const statuses = useStatuses(task.project.id)
  return (
    <StatusPicker
      statuses={statuses.data ?? []}
      value={task.status.id}
      disabled={disabled}
      onChange={(id) => id !== task.status.id && update.mutate({ id: task.id, status_id: id })}
    >
      <PropertyButton
        onClick={stop}
        className={cn(variant === 'icon' && 'h-6 w-6 justify-center px-0', className)}
        aria-label={`Status: ${task.status.name}`}
      >
        <StatusIcon category={task.status.category} color={task.status.color} />
        {variant === 'full' && <span>{task.status.name}</span>}
      </PropertyButton>
    </StatusPicker>
  )
}

export function PriorityControl({ task, disabled, variant = 'icon', className }: ControlProps) {
  const update = useUpdateTask()
  return (
    <PriorityPicker
      value={task.priority}
      disabled={disabled}
      onChange={(p) => p !== task.priority && update.mutate({ id: task.id, priority: p })}
    >
      <PropertyButton
        onClick={stop}
        empty={task.priority === 'none'}
        className={cn(variant === 'icon' && 'h-6 w-6 justify-center px-0', className)}
        aria-label={`Priority: ${PRIORITY_LABEL[task.priority]}`}
      >
        <PriorityIcon priority={task.priority} />
        {variant === 'full' && <span>{PRIORITY_LABEL[task.priority]}</span>}
      </PropertyButton>
    </PriorityPicker>
  )
}

export function AssigneeControl({ task, disabled, variant = 'icon', className }: ControlProps) {
  const update = useUpdateTask()
  const me = useMe()
  const members = useMembers()
  const people = (members.data ?? []).map((m) => m.user)
  return (
    <AssigneePicker
      people={people}
      meId={me.id}
      value={task.assignee?.id}
      disabled={disabled}
      onChange={(uid) => uid !== (task.assignee?.id ?? null) && update.mutate({ id: task.id, assignee_id: uid })}
    >
      <PropertyButton
        onClick={stop}
        empty={!task.assignee}
        className={cn(variant === 'icon' && 'h-6 w-6 justify-center rounded-full px-0', className)}
        aria-label={task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned'}
      >
        <UserAvatar user={task.assignee} size={variant === 'icon' ? 'md' : 'sm'} tooltip={variant === 'icon'} />
        {variant === 'full' && <span className="truncate">{task.assignee?.name ?? 'Unassigned'}</span>}
      </PropertyButton>
    </AssigneePicker>
  )
}

export function DueDateControl({
  task,
  disabled,
  variant = 'icon',
  className,
  showEmpty = false,
}: ControlProps & { showEmpty?: boolean }) {
  const update = useUpdateTask()
  if (!task.due_date && variant === 'icon' && !showEmpty) return null
  return (
    <DatePicker
      value={task.due_date}
      title="Due date"
      disabled={disabled}
      fromDate={task.start_date}
      onChange={(d) => d !== task.due_date && update.mutate({ id: task.id, due_date: d })}
    >
      <PropertyButton onClick={stop} empty={!task.due_date} className={cn(variant === 'icon' && 'h-6 px-1.5', className)}>
        {task.due_date ? (
          variant === 'full' ? (
            <>
              <CalendarDays className="size-3.5 text-muted-foreground" />
              <DueDate date={task.due_date} closed={isClosed(task.status.category)} />
              <span className="text-xs text-subtle">{formatDate(task.due_date, true)}</span>
            </>
          ) : (
            <DueDate date={task.due_date} closed={isClosed(task.status.category)} />
          )
        ) : (
          <>
            <CalendarDays className="size-3.5" />
            {variant === 'full' && <span>Set due date</span>}
          </>
        )}
      </PropertyButton>
    </DatePicker>
  )
}

export function StartDateControl({ task, disabled, className }: ControlProps) {
  const update = useUpdateTask()
  return (
    <DatePicker
      value={task.start_date}
      title="Start date"
      disabled={disabled}
      onChange={(d) => d !== task.start_date && update.mutate({ id: task.id, start_date: d })}
    >
      <PropertyButton onClick={stop} empty={!task.start_date} className={className}>
        <CalendarDays className="size-3.5 text-muted-foreground" />
        <span>{task.start_date ? formatDate(task.start_date, true) : 'Set start date'}</span>
      </PropertyButton>
    </DatePicker>
  )
}

export function LabelsControl({ task, disabled, variant = 'icon', className }: ControlProps) {
  const update = useUpdateTask()
  const labels = useLabels()
  const selected = task.labels.map((l) => l.id)
  const toggle = (id: string, on: boolean) =>
    update.mutate({ id: task.id, label_ids: on ? [...selected, id] : selected.filter((x) => x !== id) })
  if (variant === 'icon' && !task.labels.length) return null
  return (
    <LabelPicker labels={labels.data ?? []} values={selected} onToggle={toggle} disabled={disabled}>
      <button
        type="button"
        onClick={stop}
        className={cn('flex min-w-0 flex-wrap items-center gap-1 rounded-md text-left', variant === 'full' && 'min-h-7 px-1', className)}
      >
        {task.labels.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {variant === 'full' && (
          <Tip content="Add label">
            <span className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-2xs text-subtle hover:bg-accent hover:text-foreground">
              {task.labels.length ? <Plus className="size-3" /> : (
                <>
                  <Tag className="size-3" /> Add labels
                </>
              )}
            </span>
          </Tip>
        )}
      </button>
    </LabelPicker>
  )
}
