import * as React from 'react'
import { useTaskPanel } from '@/app/task-panel'
import type { Task } from '@/api/hooks/tasks'
import { ProjectIcon } from '@/components/domain'
import { cn } from '@/lib/utils'
import { AssigneeControl, DueDateControl, LabelsControl, PriorityControl } from './controls'
import { TaskMeta } from './TaskRow'

/** Board card. Presentational + inline controls; drag handling is added by the board. */
export const TaskCard = React.memo(
  React.forwardRef<
    HTMLDivElement,
    {
      task: Task
      editable?: boolean
      showProject?: boolean
      dragging?: boolean
      overlay?: boolean
      className?: string
    } & React.HTMLAttributes<HTMLDivElement>
  >(function TaskCard({ task, editable = true, showProject, dragging, overlay, className, ...rest }, ref) {
    const { open } = useTaskPanel()
    return (
      <div
        ref={ref}
        data-task-id={task.id}
        onClick={() => !dragging && open(task.ref)}
        className={cn(
          'group relative cursor-default select-none rounded-lg border border-border bg-surface p-2.5 text-sm shadow-elev-1 transition-[box-shadow,border-color,opacity,transform] hover:border-subtle/40 hover:shadow-elev-2',
          task.is_overdue && 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-danger',
          dragging && 'opacity-40',
          overlay && 'rotate-[1.5deg] cursor-grabbing shadow-elev-3 ring-1 ring-primary/40',
          className,
        )}
        {...rest}
      >
        <div className="flex items-center gap-1.5 text-2xs text-subtle">
          {showProject && <ProjectIcon project={task.project} size="sm" />}
          <span className="font-mono">{task.ref}</span>
          <span className="ml-auto">
            <AssigneeControl task={task} disabled={!editable} />
          </span>
        </div>
        <p
          className={cn(
            'mt-1 line-clamp-3 font-medium leading-snug',
            task.status.category === 'done' && 'text-muted-foreground',
          )}
        >
          {task.title}
        </p>
        <LabelsControl task={task} disabled={!editable} className="mt-2" />
        <div className="mt-2 flex items-center gap-1">
          <PriorityControl task={task} disabled={!editable} />
          <DueDateControl task={task} disabled={!editable} />
          <TaskMeta task={task} className="ml-auto" />
        </div>
      </div>
    )
  }),
)
