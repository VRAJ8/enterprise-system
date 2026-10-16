import { Check, Globe2, Lock } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '@/app/auth'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useCreateProject } from '@/api/hooks/projects'
import { usePeople } from '@/api/hooks/workspace'
import { PROJECT_COLORS, PROJECT_ICONS, ProjectIcon } from '@/components/domain'
import { AssigneePicker, DatePicker, PropertyButton } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0]).slice(0, 4)
}

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace()
  const me = useMe()
  const people = usePeople()
  const navigate = useNavigate()
  const create = useCreateProject()
  const [name, setName] = React.useState('')
  const [key, setKey] = React.useState('')
  const [keyTouched, setKeyTouched] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [color, setColor] = React.useState(PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)])
  const [icon, setIcon] = React.useState('rocket')
  const [privateProject, setPrivate] = React.useState(false)
  const [leadId, setLeadId] = React.useState<string | null>(me.id)
  const [start, setStart] = React.useState<string | null>(null)
  const [target, setTarget] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setName('')
      setKey('')
      setKeyTouched(false)
      setDescription('')
      setPrivate(false)
      setLeadId(me.id)
      setStart(null)
      setTarget(null)
    }
  }, [open, me.id])

  const lead = people.find((p) => p.id === leadId)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        name: name.trim(),
        key: (keyTouched ? key : suggestKey(name)) || null,
        description,
        color,
        icon,
        status: 'active',
        priority: 'medium',
        visibility: privateProject ? 'private' : 'workspace',
        lead_id: leadId,
        start_date: start,
        target_date: target,
      },
      {
        onSuccess: (p) => {
          onOpenChange(false)
          navigate(wsPath(ws, 'projects', p.key, 'board'))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Projects hold tasks, milestones and status updates for one outcome.</DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-3">
            <ProjectIcon project={{ color, icon }} size="lg" className="mt-5" />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Website relaunch"
                maxLength={120}
              />
            </div>
            <div className="w-24 space-y-1.5">
              <Label htmlFor="project-key">Key</Label>
              <Input
                id="project-key"
                value={keyTouched ? key : suggestKey(name)}
                onChange={(e) => {
                  setKeyTouched(true)
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
                }}
                placeholder="WEB"
                className="font-mono uppercase"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Appearance</Label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110"
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                >
                  {color === c && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(PROJECT_ICONS).map(([k, Icon]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setIcon(k)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent',
                    icon === k && 'bg-accent text-foreground ring-1 ring-border',
                  )}
                  aria-label={k}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Description</Label>
            <Textarea
              id="project-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does success look like?"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <AssigneePicker people={people} value={leadId} onChange={setLeadId} meId={me.id}>
              <PropertyButton empty={!lead}>
                <UserAvatar user={lead} size="sm" /> {lead ? `Lead: ${lead.name}` : 'Lead'}
              </PropertyButton>
            </AssigneePicker>
            <DatePicker value={start} onChange={setStart} title="Start date">
              <PropertyButton empty={!start}>{start ? `Starts ${formatDate(start)}` : 'Start date'}</PropertyButton>
            </DatePicker>
            <DatePicker value={target} onChange={setTarget} fromDate={start} title="Target date">
              <PropertyButton empty={!target}>{target ? `Target ${formatDate(target)}` : 'Target date'}</PropertyButton>
            </DatePicker>
            <PropertyButton type="button" onClick={() => setPrivate((p) => !p)}>
              {privateProject ? <Lock className="size-3.5" /> : <Globe2 className="size-3.5" />}
              {privateProject ? 'Private' : 'Everyone in workspace'}
            </PropertyButton>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
