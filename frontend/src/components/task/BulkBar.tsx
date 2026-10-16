import { motion, AnimatePresence } from 'framer-motion'
import { CalendarDays, CircleDot, Signal, Trash2, UserRound, X } from 'lucide-react'
import { useMe } from '@/app/auth'
import type { Status } from '@/api/hooks/projects'
import { useBulkUpdateTasks, type Task } from '@/api/hooks/tasks'
import { usePeople } from '@/api/hooks/workspace'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { pluralize } from '@/lib/utils'

/** Floating action bar for multi-selected tasks. Status is offered when every task shares one project. */
export function BulkBar({
  tasks,
  statuses,
  onClear,
}: {
  tasks: Task[]
  statuses?: Status[]
  onClear: () => void
}) {
  const me = useMe()
  const people = usePeople()
  const bulk = useBulkUpdateTasks()
  const ids = tasks.map((t) => t.id)
  const base = { task_ids: ids, clear_assignee: false, delete: false }
  const singleProject = new Set(tasks.map((t) => t.project.id)).size === 1

  return (
    <AnimatePresence>
      {tasks.length > 0 && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          className="pointer-events-auto fixed inset-x-0 bottom-5 z-40 mx-auto flex w-max max-w-[calc(100vw-2rem)] items-center gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-elev-3"
        >
          <span className="px-2 text-xs font-medium">{pluralize(tasks.length, 'task')} selected</span>
          {singleProject && statuses && (
            <StatusPicker statuses={statuses} onChange={(id) => bulk.mutate({ ...base, status_id: id })}>
              <Button variant="ghost" size="sm">
                <CircleDot /> Status
              </Button>
            </StatusPicker>
          )}
          <PriorityPicker onChange={(p) => bulk.mutate({ ...base, priority: p })}>
            <Button variant="ghost" size="sm">
              <Signal /> Priority
            </Button>
          </PriorityPicker>
          <AssigneePicker
            people={people}
            meId={me.id}
            onChange={(uid) => bulk.mutate(uid ? { ...base, assignee_id: uid } : { ...base, clear_assignee: true })}
          >
            <Button variant="ghost" size="sm">
              <UserRound /> Assignee
            </Button>
          </AssigneePicker>
          <DatePicker value={null} onChange={(d) => bulk.mutate({ ...base, due_date: d })} title="Set due date">
            <Button variant="ghost" size="sm">
              <CalendarDays /> Due
            </Button>
          </DatePicker>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => bulk.mutate({ ...base, delete: true }, { onSuccess: onClear })}
          >
            <Trash2 /> Delete
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
            <X />
          </Button>
          <Kbd className="mr-1 hidden sm:inline-flex">Esc</Kbd>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
