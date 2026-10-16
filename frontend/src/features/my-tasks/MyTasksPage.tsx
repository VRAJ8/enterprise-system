import { CheckCircle2, ListChecks } from 'lucide-react'
import { useMe } from '@/app/auth'
import { useUI } from '@/app/ui-store'
import { useWorkspaceTasks } from '@/api/hooks/tasks'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { applyTaskFilters, FilterBar, useTaskFilters } from '@/components/task/filters'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskList } from '@/features/list/TaskList'
import { useListOptions, ViewOptions } from '@/features/list/ViewOptions'

export default function MyTasksPage() {
  const me = useMe()
  const filters = useTaskFilters({ showClosed: false })
  const tasks = useWorkspaceTasks({ assignee: 'me' })
  const openCreateTask = useUI((s) => s.openCreateTask)
  const [opts, setOpts] = useListOptions('ph-my-tasks', { groupBy: 'due', orderBy: 'priority' })
  const visible = applyTaskFilters(tasks.data?.items ?? [], filters.filters, me.id)

  return (
    <>
      <PageHeader
        title="My tasks"
        icon={ListChecks}
        actions={
          <Button size="sm" onClick={() => openCreateTask({ assigneeId: me.id })}>
            New task
          </Button>
        }
      >
        <FilterBar state={filters} hideAssignee right={<ViewOptions {...opts} onChange={setOpts} />} />
      </PageHeader>
      <PageBody>
        {tasks.isLoading ? (
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
            showProject
            hideEmptyGroups
            empty={
              <EmptyState
                icon={CheckCircle2}
                title={filters.active ? 'Nothing matches these filters' : "You're all caught up"}
                description={filters.active ? 'Try clearing a filter.' : 'Tasks assigned to you across every project show up here.'}
                action={
                  filters.active && (
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filters
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </PageBody>
    </>
  )
}
