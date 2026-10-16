import { GitBranch, Lock, MessageSquare, Paperclip } from 'lucide-react'
import * as React from 'react'
import { useTaskPanel } from '@/app/task-panel'
import type { Task } from '@/api/hooks/tasks'
import { ProjectIcon } from '@/components/domain'
import { Checkbox } from '@/components/ui/checkbox'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AssigneeControl, DueDateControl, LabelsControl, PriorityControl, StatusControl } from './controls'

export interface TaskRowProps {
  task: Task
  editable?: boolean
  showProject?: boolean
  selected?: boolean
  onSelectChange?: (selected: boolean) => void
  /** Keyboard focus (J/K navigation) */
  active?: boolean
  className?: string
  indent?: boolean
}

/** Dense, Linear-style list row. Click opens the task panel; every property is editable in place. */
export const TaskRow = React.memo(function TaskRow({
  task,
  editable = true,
  showProject = false,
  selected,
  onSelectChange,
  active,
  className,
  indent,
}: TaskRowProps) {
  const { open } = useTaskPanel()
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div
      ref={ref}
      role="row"
      tabIndex={-1}
      data-task-id={task.id}
      onClick={() => open(task.ref)}
      className={cn(
        'group flex h-10 cursor-default items-center gap-2 border-b border-border/50 px-3 text-sm transition-colors hover:bg-accent/50',
        selected && 'bg-primary-soft/60 hover:bg-primary-soft',
        active && 'bg-accent/70 ring-1 ring-inset ring-ring/30',
        className,
      )}
    >
      {onSelectChange && (
        <div className="flex w-5 shrink-0 justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelectChange(!!v)}
            className={cn('transition-opacity', !selected && 'opacity-0 group-hover:opacity-100')}
            aria-label={`Select ${task.ref}`}
          />
        </div>
      )}
      <PriorityControl task={task} disabled={!editable} />
      <span className="hidden w-[4.5rem] shrink-0 truncate font-mono text-2xs text-subtle sm:inline-block">{task.ref}</span>
      <StatusControl task={task} disabled={!editable} />
      <div className={cn('flex min-w-0 flex-1 items-center gap-2', indent && 'pl-4')}>
        {showProject && (
          <Tip content={task.project.name}>
            <span className="shrink-0">
              <ProjectIcon project={task.project} size="sm" />
            </span>
          </Tip>
        )}
        <span className={cn('truncate', task.status.category === 'done' && 'text-muted-foreground line-through decoration-subtle/60')}>
          {task.title}
        </span>
        <TaskMeta task={task} className="hidden sm:flex" />
        <LabelsControl task={task} disabled={!editable} className="hidden max-w-[40%] overflow-hidden lg:flex" />
      </div>
      <DueDateControl task={task} disabled={!editable} />
      <AssigneeControl task={task} disabled={!editable} />
    </div>
  )
})

/** Small counters: subtasks, comments, attachments, blocked. */
export function TaskMeta({ task, className }: { task: Task; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-2 text-2xs text-subtle', className)}>
      {task.blocked_by_count > 0 && (
        <Tip content={`Blocked by ${task.blocked_by_count} open task${task.blocked_by_count > 1 ? 's' : ''}`}>
          <span className="inline-flex items-center gap-0.5 rounded bg-danger/10 px-1 py-px font-medium text-danger">
            <Lock className="size-3" /> Blocked
          </span>
        </Tip>
      )}
      {task.subtask_count > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <GitBranch className="size-3" /> {task.subtask_done_count}/{task.subtask_count}
        </span>
      )}
      {task.comment_count > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <MessageSquare className="size-3" /> {task.comment_count}
        </span>
      )}
      {task.attachment_count > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Paperclip className="size-3" /> {task.attachment_count}
        </span>
      )}
    </span>
  )
}
