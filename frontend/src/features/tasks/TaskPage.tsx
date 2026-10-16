import { useParams } from 'react-router-dom'
import { useTaskByRef } from '@/api/hooks/tasks'
import { EmptyState } from '@/components/ui/empty-state'
import { TaskDetailSkeleton, TaskDetailView } from './TaskDetailView'

export default function TaskPage() {
  const { taskRef } = useParams()
  const task = useTaskByRef(taskRef?.toUpperCase())
  if (task.isError) return <EmptyState title="Task not found" description="It may have been deleted, or you don't have access." />
  if (!task.data) return <TaskDetailSkeleton />
  return <TaskDetailView key={task.data.id} task={task.data} mode="page" />
}
