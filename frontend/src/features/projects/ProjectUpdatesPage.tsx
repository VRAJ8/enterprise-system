import { Megaphone } from 'lucide-react'
import * as React from 'react'
import { useProjectInsights } from '@/api/hooks/insights'
import { usePostProjectUpdate, useProjectUpdates } from '@/api/hooks/projects'
import { usePeople } from '@/api/hooks/workspace'
import { HEALTH_META, HealthBadge } from '@/components/domain'
import { Markdown } from '@/components/Markdown'
import { MentionEditor, useMentionEditor } from '@/components/MentionEditor'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDateTime, timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useProjectContext } from './ProjectLayout'

type Health = 'on_track' | 'at_risk' | 'off_track'

export default function ProjectUpdatesPage() {
  const { project, canEdit } = useProjectContext()
  const updates = useProjectUpdates(project.id)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        {canEdit && <Composer />}
        {updates.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : !updates.data?.length ? (
          <EmptyState
            icon={Megaphone}
            title="No status updates yet"
            description="A short weekly update (what moved, what's at risk, what you need) keeps stakeholders aligned without a meeting."
          />
        ) : (
          <ol className="relative space-y-5 before:absolute before:inset-y-2 before:left-4 before:w-px before:bg-border">
            {updates.data.map((u) => (
              <li key={u.id} className="relative pl-12">
                <span className={cn('absolute left-2.5 top-4 size-3 rounded-full ring-4 ring-background', HEALTH_META[u.health].dot)} />
                <article className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
                  <header className="mb-2 flex items-center gap-2 text-xs">
                    <UserAvatar user={u.author} size="sm" />
                    <span className="font-medium">{u.author?.name ?? 'Former member'}</span>
                    <span className="text-subtle" title={formatDateTime(u.created_at)}>
                      {timeAgo(u.created_at)}
                    </span>
                    <HealthBadge status={u.health} className="ml-auto" />
                  </header>
                  <Markdown className="text-sm">{u.body}</Markdown>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function Composer() {
  const { project } = useProjectContext()
  const insights = useProjectInsights(project.id)
  const people = usePeople()
  const post = usePostProjectUpdate(project.id)
  const editor = useMentionEditor('')
  const computed = insights.data?.health.status
  const suggested: Health = computed === 'off_track' || computed === 'at_risk' ? computed : 'on_track'
  const [health, setHealth] = React.useState<Health | null>(null)
  const value = health ?? suggested

  const draft = () => {
    const d = insights.data
    if (!d) return
    const lines = [
      `**Progress:** ${Math.round(d.health.progress * 100)}% complete (${d.scope.done} done, ${d.scope.open} open).`,
      d.forecast.completion_date ? `**Forecast:** finishing around ${d.forecast.completion_date} at ${d.forecast.weekly_throughput} tasks/week.` : '',
      d.health.reasons?.length ? `**Signals:** ${d.health.reasons.join('; ')}.` : '',
      '',
      '**This week:** ',
      '**Risks / asks:** ',
    ].filter((l, i) => l || i > 2)
    editor.setText(lines.join('\n'))
  }

  const submit = () => {
    const body = editor.serialize()
    if (!body) return
    post.mutate(
      { health: value, body },
      {
        onSuccess: () => {
          editor.reset('')
          setHealth(null)
        },
      },
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Post a status update</p>
        <div className="ml-auto flex gap-1">
          {(['on_track', 'at_risk', 'off_track'] as Health[]).map((h) => (
            <button
              key={h}
              onClick={() => setHealth(h)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                value === h ? cn(HEALTH_META[h].bg, HEALTH_META[h].text, 'border-current/30') : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              <span className={cn('size-1.5 rounded-full', HEALTH_META[h].dot)} />
              {HEALTH_META[h].label}
            </button>
          ))}
        </div>
      </div>
      <MentionEditor
        editor={editor}
        people={people}
        rows={5}
        onSubmit={submit}
        placeholder="What moved this week, what's at risk, and what do you need?"
      />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={draft} disabled={!insights.data}>
          Draft from project data
        </Button>
        {computed && health && health !== suggested && (
          <span className="text-2xs text-subtle">Computed health is {HEALTH_META[computed]?.label.toLowerCase()}</span>
        )}
        <Button size="sm" className="ml-auto" onClick={submit} loading={post.isPending} disabled={!editor.text.trim()}>
          Post update
        </Button>
      </div>
    </div>
  )
}
