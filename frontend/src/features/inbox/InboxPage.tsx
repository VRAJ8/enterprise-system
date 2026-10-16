import {
  AlarmClock,
  AtSign,
  CheckCheck,
  CircleDot,
  FolderPlus,
  Inbox,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import * as React from 'react'
import { useTaskPanel } from '@/app/task-panel'
import { useNavigate } from 'react-router-dom'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useMarkRead, useNotifications, type Notification } from '@/api/hooks/insights'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/UserAvatar'
import { stripMarkdown } from '@/components/Markdown'
import { timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'

const META: Record<string, { icon: LucideIcon; tone: string }> = {
  assigned: { icon: UserPlus, tone: 'text-primary' },
  mentioned: { icon: AtSign, tone: 'text-primary' },
  commented: { icon: MessageSquare, tone: 'text-muted-foreground' },
  status_changed: { icon: CircleDot, tone: 'text-muted-foreground' },
  due_soon: { icon: AlarmClock, tone: 'text-warning' },
  overdue: { icon: TriangleAlert, tone: 'text-danger' },
  added_to_project: { icon: FolderPlus, tone: 'text-primary' },
  project_update: { icon: Megaphone, tone: 'text-primary' },
  invited: { icon: UserPlus, tone: 'text-primary' },
}

function message(n: Notification): { text: React.ReactNode; detail?: string } {
  const d = (n.data ?? {}) as Record<string, unknown>
  const who = <span className="font-medium text-foreground">{n.actor?.name ?? 'Someone'}</span>
  const what = n.task ? <span className="font-medium text-foreground">{n.task.title}</span> : n.project?.name
  switch (n.type) {
    case 'assigned':
      return { text: <>{who} assigned you {what}</> }
    case 'mentioned':
      return { text: <>{who} mentioned you on {what}</>, detail: d.excerpt ? stripMarkdown(String(d.excerpt)) : undefined }
    case 'commented':
      return { text: <>{who} commented on {what}</>, detail: d.excerpt ? stripMarkdown(String(d.excerpt)) : undefined }
    case 'status_changed':
      return { text: <>{who} moved {what} to {String(d.to ?? d.status ?? 'a new status')}</> }
    case 'due_soon':
      return { text: <>{what} is due {Number(d.days_left) === 0 ? 'today' : `in ${String(d.days_left)} day${d.days_left === 1 ? '' : 's'}`}</> }
    case 'overdue':
      return { text: <>{what} is {String(d.days_overdue)} day{d.days_overdue === 1 ? '' : 's'} overdue</> }
    case 'added_to_project':
      return { text: <>{who} added you to <span className="font-medium text-foreground">{n.project?.name}</span></> }
    case 'project_update':
      return {
        text: <>{who} posted a status update on <span className="font-medium text-foreground">{n.project?.name}</span></>,
        detail: d.excerpt ? stripMarkdown(String(d.excerpt)) : undefined,
      }
    default:
      return { text: <>{who} {n.type.replace(/_/g, ' ')}</> }
  }
}

export default function InboxPage() {
  const [tab, setTab] = React.useState<'unread' | 'all'>('unread')
  const list = useNotifications(tab === 'unread')
  const markRead = useMarkRead()
  const panel = useTaskPanel()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const items = list.data ?? []

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate({ ids: [n.id] })
    if (n.task) panel.open(n.task.ref)
    else if (n.project) navigate(wsPath(ws, 'projects', n.project.key, n.type === 'project_update' ? 'updates' : 'overview'))
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        icon={Inbox}
        actions={
          <Button variant="ghost" size="sm" onClick={() => markRead.mutate({ all: true })}>
            <CheckCheck /> Mark all read
          </Button>
        }
      >
        {(['unread', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium capitalize',
              tab === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {t}
          </button>
        ))}
      </PageHeader>
      <PageBody>
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          {list.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : !items.length ? (
            <EmptyState
              icon={CheckCheck}
              title={tab === 'unread' ? 'Inbox zero' : 'No notifications yet'}
              description="Assignments, mentions, comments on tasks you watch and deadline reminders land here."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
              {items.map((n) => {
                const meta = META[n.type] ?? META.commented
                const { text, detail } = message(n)
                return (
                  <button
                    key={n.id}
                    onClick={() => open(n)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent/40',
                      !n.read_at && 'bg-primary-soft/25',
                    )}
                  >
                    <div className="relative">
                      <UserAvatar user={n.actor} />
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5">
                        <meta.icon className={cn('size-3', meta.tone)} />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-muted-foreground">{text}</p>
                      {detail && <p className="mt-0.5 line-clamp-2 text-xs text-subtle">“{detail}”</p>}
                      <p className="mt-1 text-2xs text-subtle">
                        {n.task?.ref ?? n.project?.key} · {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </PageBody>
    </>
  )
}
