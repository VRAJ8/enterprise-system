import {
  BarChart3,
  Clock,
  FolderKanban,
  Home,
  Inbox,
  Keyboard,
  ListChecks,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTaskPanel } from '@/app/task-panel'
import { useUI } from '@/app/ui-store'
import { useWorkspace, wsPath } from '@/app/workspace'
import { useSearch } from '@/api/hooks/insights'
import { useProjects } from '@/api/hooks/projects'
import { ProjectIcon, StatusIcon } from '@/components/domain'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/UserAvatar'

export default function CommandPalette() {
  const open = useUI((s) => s.commandOpen)
  const setOpen = useUI((s) => s.setCommandOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        {open && <Palette close={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

function Palette({ close }: { close: () => void }) {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const panel = useTaskPanel()
  const ui = useUI()
  const projects = useProjects()
  const [q, setQ] = React.useState('')
  const debounced = useDebounced(q, 150)
  const search = useSearch(debounced)
  const term = q.trim().toLowerCase()

  const run = (fn: () => void) => {
    close()
    fn()
  }
  const go = (...parts: string[]) => run(() => navigate(wsPath(ws, ...parts)))
  const isDark = document.documentElement.classList.contains('dark')

  const pages = [
    { label: 'Home', icon: Home, to: [] as string[] },
    { label: 'Inbox', icon: Inbox, to: ['inbox'] },
    { label: 'My tasks', icon: ListChecks, to: ['my-tasks'] },
    { label: 'Projects', icon: FolderKanban, to: ['projects'] },
    { label: 'Workload', icon: Users, to: ['workload'] },
    { label: 'Timesheet', icon: Clock, to: ['time'] },
    { label: 'Insights', icon: BarChart3, to: ['insights'] },
    { label: 'Settings', icon: Settings, to: ['settings'] },
  ].filter((p) => !term || p.label.toLowerCase().includes(term))

  const actions = [
    { label: 'Create task', icon: Plus, hint: 'C', fn: () => ui.openCreateTask({}) },
    { label: isDark ? 'Switch to light theme' : 'Switch to dark theme', icon: isDark ? Sun : Moon, fn: () => ui.setTheme(isDark ? 'light' : 'dark') },
    { label: 'Keyboard shortcuts', icon: Keyboard, hint: '?', fn: () => ui.setShortcutsOpen(true) },
  ].filter((a) => !term || a.label.toLowerCase().includes(term))

  const localProjects = (projects.data ?? []).filter(
    (p) => !term || p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term),
  )
  const results = term ? search.data : undefined

  return (
    <Command shouldFilter={false} loop>
      <CommandInput value={q} onValueChange={setQ} placeholder="Search tasks, projects, people… or type a command" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{search.isFetching ? 'Searching…' : 'No results.'}</CommandEmpty>
        {!!results?.tasks.length && (
          <CommandGroup heading="Tasks">
            {results.tasks.map((t) => (
              <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => run(() => panel.open(t.ref))}>
                <StatusIcon category={t.status.category} color={t.status.color} />
                <span className="w-16 shrink-0 font-mono text-2xs text-subtle">{t.ref}</span>
                <span className="truncate">{t.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!localProjects.length && (
          <CommandGroup heading="Projects">
            {localProjects.slice(0, term ? 6 : 4).map((p) => (
              <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => go('projects', p.key)}>
                <ProjectIcon project={p} size="sm" />
                {p.name}
                <span className="ml-auto font-mono text-2xs text-subtle">{p.key}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!results?.people.length && (
          <CommandGroup heading="People">
            {results.people.map((u) => (
              <CommandItem key={u.id} value={`person-${u.id}`} onSelect={() => go('workload')}>
                <UserAvatar user={u} size="sm" />
                {u.name}
                <span className="ml-auto text-2xs text-subtle">{u.email}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!actions.length && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.label} value={`action-${a.label}`} onSelect={() => run(a.fn)}>
                <a.icon />
                {a.label}
                {a.hint && <kbd className="ml-auto rounded border border-border px-1.5 text-2xs text-subtle">{a.hint}</kbd>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!pages.length && (
          <CommandGroup heading="Go to">
            {pages.map((p) => (
              <CommandItem key={p.label} value={`page-${p.label}`} onSelect={() => go(...p.to)}>
                <p.icon />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
