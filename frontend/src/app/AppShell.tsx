import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  Clock,
  FolderKanban,
  Home,
  Inbox,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogoMark } from '@/components/Logo'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tip } from '@/components/ui/tooltip'
import { useHotkeys } from '@/lib/hotkeys'
import { cn, modKey } from '@/lib/utils'
import { GlobalOverlays, InboxBadge, SidebarProjects, SidebarTimer } from './slots'
import { useAuth, useMe } from './auth'
import { useRealtime } from './realtime'
import { useUI, type Theme } from './ui-store'
import { useWorkspace, wsPath } from './workspace'

const NAV = [
  { to: '', label: 'Home', icon: Home, end: true, hotkey: 'G H' },
  { to: 'inbox', label: 'Inbox', icon: Inbox, hotkey: 'G I', badge: true },
  { to: 'my-tasks', label: 'My tasks', icon: ListChecks, hotkey: 'G M' },
  { to: 'projects', label: 'Projects', icon: FolderKanban, hotkey: 'G P', end: true },
]

const PLAN_NAV = [
  { to: 'workload', label: 'Workload', icon: Users, hotkey: 'G W' },
  { to: 'time', label: 'Timesheets', icon: Clock, hotkey: 'G T' },
  { to: 'insights', label: 'Insights', icon: BarChart3, hotkey: 'G R' },
]

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  hotkey,
  collapsed,
  children,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  hotkey?: string
  collapsed: boolean
  children?: React.ReactNode
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-surface-raised text-foreground shadow-elev-1 ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && children}
    </NavLink>
  )
  return collapsed ? (
    <Tip content={label} keys={hotkey?.split(' ')} side="right">
      {link}
    </Tip>
  ) : (
    link
  )
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const me = useMe()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { theme, setTheme } = useUI()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-accent/70',
            collapsed && 'justify-center px-0',
          )}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-violet-500 text-[11px] font-bold text-white shadow-elev-1">
            {ws.name.slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{ws.name}</span>
              <ChevronsUpDown className="size-3.5 text-subtle" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
        {me.workspaces.map((w) => (
          <DropdownMenuItem key={w.workspace_id} onSelect={() => navigate(`/${w.workspace_slug}`)}>
            <div className="flex size-5 items-center justify-center rounded bg-secondary text-[10px] font-bold">
              {w.workspace_name.slice(0, 1).toUpperCase()}
            </div>
            <span className="flex-1 truncate">{w.workspace_name}</span>
            {w.workspace_id === ws.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => navigate('/onboarding?new=1')}>
          <Plus /> New workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(wsPath(ws, 'settings'))}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace()
  const me = useMe()
  const collapsed = useUI((s) => s.sidebarCollapsed) && !onNavigate
  const toggle = useUI((s) => s.toggleSidebar)
  const setCommandOpen = useUI((s) => s.setCommandOpen)
  const openCreateTask = useUI((s) => s.openCreateTask)
  const base = wsPath(ws)

  return (
    <nav
      className={cn('flex h-full flex-col gap-1 px-2 py-2', collapsed ? 'w-[52px]' : 'w-[244px]')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.()
      }}
    >
      <WorkspaceSwitcher collapsed={collapsed} />

      <div className={cn('mt-1 flex gap-1', collapsed && 'flex-col')}>
        <Tip content="Search" keys={[modKey, 'K']} side="right">
          <Button
            variant="outline"
            size="sm"
            className={cn('h-8 flex-1 justify-start gap-2 bg-surface text-muted-foreground', collapsed && 'justify-center px-0')}
            onClick={() => setCommandOpen(true)}
          >
            <Search />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search</span>
                <Kbd>{modKey}K</Kbd>
              </>
            )}
          </Button>
        </Tip>
        {!ws.isGuest && (
          <Tip content="New task" keys={['C']} side="right">
            <Button size="icon" className="size-8 shrink-0" onClick={() => openCreateTask()} aria-label="New task">
              <Plus />
            </Button>
          </Tip>
        )}
      </div>

      <div className="mt-2 space-y-0.5">
        {NAV.map((n) => (
          <NavItem key={n.label} {...n} to={`${base}${n.to ? `/${n.to}` : ''}`} collapsed={collapsed}>
            {n.badge && <InboxBadge />}
          </NavItem>
        ))}
      </div>

      {!ws.isGuest && (
        <>
          {!collapsed && <p className="mb-1 mt-4 px-2 text-2xs font-medium uppercase tracking-wider text-subtle">Plan</p>}
          <div className={cn('space-y-0.5', collapsed && 'mt-3')}>
            {PLAN_NAV.map((n) => (
              <NavItem key={n.label} {...n} to={`${base}/${n.to}`} collapsed={collapsed} />
            ))}
          </div>
        </>
      )}

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <SidebarProjects collapsed={collapsed} />
      </div>

      <SidebarTimer collapsed={collapsed} />

      <div className={cn('flex items-center gap-1 border-t border-border/60 pt-2', collapsed && 'flex-col')}>
        <NavLink
          to={`${base}/settings/profile`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/70"
        >
          <UserAvatar user={me} size="sm" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{me.name}</p>
              <p className="truncate text-2xs text-muted-foreground">{ws.role}</p>
            </div>
          )}
        </NavLink>
        {!onNavigate && (
          <Tip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} keys={['[']} side="right">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle sidebar">
              <PanelLeft />
            </Button>
          </Tip>
        )}
      </div>
    </nav>
  )
}

export function AppShell() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const { setCommandOpen, openCreateTask, toggleSidebar, setShortcutsOpen, mobileNavOpen, setMobileNavOpen } = useUI()
  useRealtime(ws.id)

  React.useEffect(() => setMobileNavOpen(false), [location.pathname, setMobileNavOpen])

  const go = (path: string) => () => navigate(wsPath(ws, ...(path ? [path] : [])))
  useHotkeys(
    {
      'mod+k': () => setCommandOpen(true),
      '/': () => setCommandOpen(true),
      c: () => !ws.isGuest && openCreateTask(),
      '[': toggleSidebar,
      'shift+?': () => setShortcutsOpen(true),
      '?': () => setShortcutsOpen(true),
      'g h': go(''),
      'g i': go('inbox'),
      'g m': go('my-tasks'),
      'g p': go('projects'),
      'g w': go('workload'),
      'g t': go('time'),
      'g r': go('insights'),
      'g s': go('settings'),
    },
    [ws.slug, ws.isGuest],
  )

  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      <aside className="hidden shrink-0 border-r border-border/60 bg-canvas transition-[width] duration-200 md:block">
        <Sidebar />
      </aside>

      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 border-r border-border bg-canvas shadow-elev-3 md:hidden"
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <Sidebar onNavigate={() => setMobileNavOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-xl md:border md:border-border/70 md:shadow-elev-1">
          <Outlet />
        </div>
      </main>

      <GlobalOverlays />
    </div>
  )
}

/** Mobile menu button for page headers. */
export function MobileNavButton() {
  const setOpen = useUI((s) => s.setMobileNavOpen)
  return (
    <Button variant="ghost" size="icon-sm" className="-ml-1 md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
      <LogoMark className="size-5" />
    </Button>
  )
}
