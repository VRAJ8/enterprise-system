import { ListTodo } from 'lucide-react'
import { useMe } from '@/app/auth'
import { useUI } from '@/app/ui-store'
import { useStatuses } from '@/api/hooks/projects'
import { useProjectTasks } from '@/api/hooks/tasks'
import { applyTaskFilters, FilterBar, useTaskFilters } from '@/components/task/filters'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectContext } from '@/features/projects/ProjectLayout'
import { TaskList } from './TaskList'
import { useListOptions, ViewOptions } from './ViewOptions'

export default function ListView() {
  const { project, canEdit } = useProjectContext()
  const me = useMe()
  const filters = useTaskFilters()
  const tasks = useProjectTasks(project.id)
  const statuses = useStatuses(project.id)
  const openCreateTask = useUI((s) => s.openCreateTask)
  const [opts, setOpts] = useListOptions('ph-list-view', { groupBy: 'status', orderBy: 'manual' })
  const visible = applyTaskFilters(tasks.data?.items ?? [], filters.filters, me.id)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-5">
        <FilterBar state={filters} right={<ViewOptions {...opts} onChange={setOpts} />} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.isLoading || statuses.isLoading ? (
          <div className="space-y-1 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <TaskList
            tasks={visible}
            groupBy={opts.groupBy}
            orderBy={opts.orderBy}
            statuses={statuses.data}
            canEdit={canEdit}
            hideEmptyGroups={filters.active}
            onAdd={(d) => openCreateTask({ projectId: project.id, ...d })}
            empty={
              <EmptyState
                icon={ListTodo}
                title={filters.active ? 'No tasks match these filters' : 'No tasks yet'}
                description={filters.active ? 'Try clearing a filter.' : 'Break the project down into tasks to start tracking progress.'}
                action={
                  filters.active ? (
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filters
                    </Button>
                  ) : (
                    canEdit && <Button onClick={() => openCreateTask({ projectId: project.id })}>Create a task</Button>
                  )
                }
              />
            }
          />
        )}
      </div>
    </div>
  )
}
