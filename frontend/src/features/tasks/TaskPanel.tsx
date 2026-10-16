import { useTaskPanel } from '@/app/task-panel'
import { useTaskByRef } from '@/api/hooks/tasks'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { TaskDetailSkeleton, TaskDetailView } from './TaskDetailView'

/** Peek panel over any page, driven by `?task=REF`. */
export default function TaskPanel() {
  const { ref, close } = useTaskPanel()
  const task = useTaskByRef(ref)
  return (
    <Sheet open={!!ref} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full p-0 sm:max-w-[720px]" aria-describedby={undefined}>
        <SheetTitle className="sr-only">{task.data?.title ?? 'Task'}</SheetTitle>
        {task.data ? (
          <TaskDetailView key={task.data.id} task={task.data} mode="panel" onClose={close} />
        ) : task.isError ? (
          <EmptyState title="Task not found" description="It may have been deleted, or you don't have access." />
        ) : (
          <TaskDetailSkeleton />
        )}
      </SheetContent>
    </Sheet>
  )
}
