import { Pause } from 'lucide-react'
import { useTaskPanel } from '@/app/task-panel'
import { useElapsed, useStopTimer, useTimer } from '@/api/hooks/time'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Running timer, always visible in the sidebar so it's never forgotten. */
export default function SidebarTimer({ collapsed }: { collapsed: boolean }) {
  const { data } = useTimer()
  const entry = data?.entry
  const elapsed = useElapsed(entry?.started_at)
  const stop = useStopTimer()
  const panel = useTaskPanel()
  if (!entry) return null
  return (
    <div className={cn('mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft/50 p-2', collapsed && 'flex-col p-1.5')}>
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
        <span className="size-2 rounded-full bg-primary" />
      </span>
      {!collapsed && (
        <button onClick={() => panel.open(entry.task.ref)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-medium">{entry.task.title}</p>
          <p className="font-mono text-2xs tabular-nums text-muted-foreground">
            {entry.task.ref} · {elapsed}
          </p>
        </button>
      )}
      <Tip content="Stop timer">
        <button
          onClick={() => stop.mutate()}
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          aria-label="Stop timer"
        >
          <Pause className="size-3" />
        </button>
      </Tip>
    </div>
  )
}
