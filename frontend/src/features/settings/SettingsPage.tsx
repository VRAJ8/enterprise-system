import { Check, Copy, KeyRound, Laptop, Link2, Moon, Monitor, Plus, Settings, Sun, Tag, Trash2, UserCog, Users } from 'lucide-react'
import * as React from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { useMe } from '@/app/auth'
import { useUI, type Theme } from '@/app/ui-store'
import { useWorkspace, wsPath } from '@/app/workspace'
import {
  useChangePassword,
  useCreateInvitation,
  useCreateLabel,
  useDeleteLabel,
  useInvitations,
  useLabels,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useRevokeSession,
  useSessions,
  useUpdateLabel,
  useUpdateMember,
  useUpdateProfile,
  useUpdateWorkspace,
} from '@/api/hooks/workspace'
import type { WorkspaceRole } from '@/app/workspace'
import { PROJECT_COLORS } from '@/components/domain'
import { PageBody, PageHeader } from '@/components/PageHeader'
import { Picker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UserAvatar } from '@/components/UserAvatar'
import { formatDate, timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'

const TABS = [
  { to: 'profile', label: 'Profile', icon: UserCog },
  { to: 'security', label: 'Security', icon: KeyRound },
  { to: 'members', label: 'Members', icon: Users },
  { to: 'labels', label: 'Labels', icon: Tag },
  { to: 'workspace', label: 'Workspace', icon: Settings, admin: true },
]

export default function SettingsPage() {
  const ws = useWorkspace()
  return (
    <>
      <PageHeader title="Settings" icon={Settings}>
        {TABS.filter((t) => !t.admin || ws.isAdmin).map((t) => (
          <NavLink
            key={t.to}
            to={wsPath(ws, 'settings', t.to)}
            className={({ isActive }) =>
              cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium [&_svg]:size-3.5',
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
              )
            }
          >
            <t.icon /> {t.label}
          </NavLink>
        ))}
      </PageHeader>
      <PageBody>
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<Profile />} />
            <Route path="security" element={<Security />} />
            <Route path="members" element={<Members />} />
            <Route path="labels" element={<Labels />} />
            <Route path="workspace" element={<WorkspaceTab />} />
          </Routes>
        </div>
      </PageBody>
    </>
  )
}

function Card({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-border bg-surface shadow-elev-1">
      <div className="flex items-start gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()

function Profile() {
  const me = useMe()
  const update = useUpdateProfile()
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const [name, setName] = React.useState(me.name)
  const [title, setTitle] = React.useState(me.title ?? '')
  return (
    <>
      <Card title="Your profile" description="How teammates see you.">
        <div className="flex items-center gap-4">
          <UserAvatar user={me} size="xl" />
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_COLORS.slice(0, 12).map((c) => (
              <button key={c} onClick={() => update.mutate({ avatar_color: c })} className="flex size-6 items-center justify-center rounded-full" style={{ background: c }} aria-label={`Avatar color ${c}`}>
                {me.avatar_color === c && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </div>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate({ name: name.trim(), title: title.trim() || null }, { onSuccess: () => toast.success('Profile saved') })
          }}
        >
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Product designer" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={me.email} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Picker options={TIMEZONES.map((t) => ({ value: t, label: t }))} value={me.timezone} onChange={(tz) => update.mutate({ timezone: tz })}>
              <Button type="button" variant="outline" className="w-full justify-start">
                {me.timezone}
              </Button>
            </Picker>
            <p className="text-2xs text-subtle">Due dates, reminders and timesheets use this.</p>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={!name.trim() || (name === me.name && title === (me.title ?? ''))}>
              Save profile
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Appearance">
        <div className="grid grid-cols-3 gap-2">
          {([
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', Monitor],
          ] as [Theme, string, typeof Sun][]).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors',
                theme === t ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-accent/50',
              )}
            >
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>
      </Card>
    </>
  )
}

function Security() {
  const change = useChangePassword()
  const sessions = useSessions()
  const revoke = useRevokeSession()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  return (
    <>
      <Card title="Change password" description="Changing it signs you out everywhere else.">
        <form
          className="grid max-w-sm gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            change.mutate(
              { current_password: current, new_password: next },
              {
                onSuccess: () => {
                  toast.success('Password changed')
                  setCurrent('')
                  setNext('')
                  void sessions.refetch()
                },
              },
            )
          }}
        >
          <Input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <Input type="password" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <Button type="submit" size="sm" className="w-fit" loading={change.isPending} disabled={!current || next.length < 8}>
            Update password
          </Button>
        </form>
      </Card>
      <Card title="Signed-in devices" description="Revoke any session you don't recognise.">
        <div className="divide-y divide-border/60">
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
              <Laptop className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{describeAgent(s.user_agent)}</p>
                <p className="text-xs text-subtle">
                  {s.ip ?? 'Unknown IP'} · signed in {formatDate(s.created_at)} · active {timeAgo(s.last_used_at)}
                </p>
              </div>
              {s.current ? (
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success">This device</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return `${browser}${os ? ` on ${os}` : ''}`
}

const WS_ROLES: { value: WorkspaceRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
]

function Members() {
  const ws = useWorkspace()
  const me = useMe()
  const members = useMembers({ includeDeactivated: ws.isAdmin })
  const update = useUpdateMember()
  const remove = useRemoveMember()
  return (
    <>
      {ws.isAdmin && <Invitations />}
      <Card title={`Members · ${members.data?.filter((m) => !m.deactivated).length ?? 0}`} description="Weekly capacity drives the workload heatmap and utilisation.">
        <div className="divide-y divide-border/60">
          {(members.data ?? []).map((m) => {
            const self = m.user.id === me.id
            const canEdit = ws.isAdmin || self
            return (
              <div key={m.user.id} className={cn('flex items-center gap-3 py-2.5 text-sm', m.deactivated && 'opacity-50')}>
                <UserAvatar user={m.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.user.name} {self && <span className="text-xs font-normal text-subtle">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="number"
                    min={0}
                    max={80}
                    disabled={!canEdit}
                    defaultValue={m.weekly_capacity_hours}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v !== m.weekly_capacity_hours && v >= 0 && v <= 80) update.mutate({ userId: m.user.id, weekly_capacity_hours: v })
                    }}
                    className="h-7 w-14 rounded-md border border-border bg-background px-2 text-right text-xs disabled:opacity-60"
                  />
                  h/wk
                </label>
                {ws.isAdmin && !self ? (
                  <Picker options={WS_ROLES} value={m.role} onChange={(r) => update.mutate({ userId: m.user.id, role: r as WorkspaceRole })}>
                    <Button variant="ghost" size="sm" className="w-20 capitalize">
                      {m.role}
                    </Button>
                  </Picker>
                ) : (
                  <span className="w-20 text-center text-xs capitalize text-muted-foreground">{m.role}</span>
                )}
                {ws.isAdmin && !self && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update.mutate({ userId: m.user.id, deactivated: !m.deactivated })}
                    title={m.deactivated ? 'Reactivate' : 'Deactivate: removes access and unassigns their open tasks'}
                  >
                    {m.deactivated ? 'Reactivate' : 'Deactivate'}
                  </Button>
                )}
                {self && m.role !== 'owner' && (
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.user.id)}>
                    Leave
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}

function Invitations() {
  const invites = useInvitations()
  const create = useCreateInvitation()
  const revoke = useRevokeInvitation()
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState<WorkspaceRole>('member')
  const [link, setLink] = React.useState<string | null>(null)
  const pending = (invites.data ?? []).filter((i) => !i.accepted_at)
  return (
    <Card title="Invite people" description="Invitation links expire after 7 days. Guests only see projects they're added to.">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate(
            { email: email.trim(), role },
            {
              onSuccess: (inv) => {
                setEmail('')
                if (inv.invite_url) {
                  setLink(inv.invite_url)
                  void navigator.clipboard?.writeText(inv.invite_url).catch(() => {})
                  toast.success('Invitation created, link copied')
                }
              },
            },
          )
        }}
      >
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="min-w-[220px] flex-1" />
        <Picker options={WS_ROLES.filter((r) => r.value !== 'owner')} value={role} onChange={(r) => setRole(r as WorkspaceRole)}>
          <Button type="button" variant="outline" className="w-24 capitalize">
            {role}
          </Button>
        </Picker>
        <Button type="submit" disabled={!email.includes('@')} loading={create.isPending}>
          <Plus /> Invite
        </Button>
      </form>
      {link && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
          <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{link}</span>
          <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('Copied'))} aria-label="Copy link">
            <Copy />
          </Button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="mt-4 divide-y divide-border/60 border-t border-border/60">
          {pending.map((i) => (
            <div key={i.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 truncate">{i.email}</span>
              <span className="text-xs capitalize text-muted-foreground">{i.role}</span>
              <span className="text-xs text-subtle">expires {formatDate(i.expires_at)}</span>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Labels() {
  const ws = useWorkspace()
  const labels = useLabels()
  const create = useCreateLabel()
  const update = useUpdateLabel()
  const del = useDeleteLabel()
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(PROJECT_COLORS[0])
  const canEdit = !ws.isGuest
  return (
    <Card title="Labels" description="Shared across all projects in the workspace.">
      <div className="divide-y divide-border/60">
        {(labels.data ?? []).map((l) => (
          <div key={l.id} className="group flex items-center gap-3 py-2 text-sm">
            <Picker
              options={PROJECT_COLORS.map((c) => ({ value: c, label: c, icon: <span className="size-3 rounded-full" style={{ background: c }} /> }))}
              value={l.color}
              onChange={(c) => update.mutate({ id: l.id, color: c })}
              disabled={!canEdit}
            >
              <button className="size-3.5 rounded-full" style={{ background: l.color }} aria-label="Change color" />
            </Picker>
            <input
              defaultValue={l.name}
              disabled={!canEdit}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && update.mutate({ id: l.id, name: e.target.value.trim() })}
              className="h-7 flex-1 rounded bg-transparent px-1 outline-none focus:bg-accent/50"
            />
            {canEdit && (
              <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" onClick={() => del.mutate(l.id)} aria-label="Delete label">
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            create.mutate({ name: name.trim(), color })
            setName('')
            setColor(PROJECT_COLORS[(PROJECT_COLORS.indexOf(color) + 3) % PROJECT_COLORS.length])
          }}
        >
          <span className="mt-2.5 size-3.5 shrink-0 rounded-full" style={{ background: color }} />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label" className="max-w-xs" />
          <Button type="submit" variant="outline">
            <Plus /> Add
          </Button>
        </form>
      )}
    </Card>
  )
}

function WorkspaceTab() {
  const ws = useWorkspace()
  const update = useUpdateWorkspace()
  const [name, setName] = React.useState(ws.name)
  return (
    <Card title="Workspace">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          update.mutate({ name: name.trim() }, { onSuccess: () => toast.success('Workspace renamed') })
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim() || name === ws.name}>
          Save
        </Button>
      </form>
      <p className="mt-2 text-xs text-subtle">URL: /{ws.slug}</p>
    </Card>
  )
}
