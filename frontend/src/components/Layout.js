import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { notificationsApi, chatApi } from '../lib/api';
import {
  LayoutDashboard, FolderKanban, ListTodo, MessageSquare, Bell,
  Settings, Users, LogOut, Menu, X, Inbox, Search,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '../components/ui/dropdown-menu';
import AIAssistant from './AIAssistant';
import TaskDrawer from './TaskDrawer';
import CommandPalette from './CommandPalette';
import { UserAvatar } from './common';
import { roleLabel } from '../lib/constants';

const navItems = [
  { path: '/my-work', label: 'My Work', icon: Inbox },
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/tasks', label: 'Tasks', icon: ListTodo },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/notifications', label: 'Notifications', icon: Bell },
];

const adminItems = [
  { path: '/users', label: 'User Management', icon: Users },
];

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const refreshBadges = useCallback(async () => {
    try {
      const [n, c] = await Promise.all([notificationsApi.unreadCount(), chatApi.getChannels()]);
      setUnreadCount(n.data.count);
      setChatUnread(c.data.reduce((sum, ch) => sum + (ch.unread_count || 0), 0));
    } catch {}
  }, []);

  useEffect(() => {
    refreshBadges();
    const interval = setInterval(refreshBadges, 20000);
    return () => clearInterval(interval);
  }, [refreshBadges]);

  // Refresh badges when navigating (e.g. after reading notifications or chat)
  useEffect(() => { refreshBadges(); }, [location.pathname, refreshBadges]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const allNav = user?.role === 'admin' ? [...navItems, ...adminItems] : navItems;
  const badgeFor = (path) => (path === '/notifications' ? unreadCount : path === '/chat' ? chatUnread : 0);

  return (
    <div className="flex h-screen overflow-hidden bg-background" data-testid="app-layout">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        style={{ background: 'hsl(240 4% 7%)' }}
        data-testid="sidebar"
      >
        <div className="flex items-center gap-3 px-6 h-16 border-b border-border/40">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <FolderKanban size={18} className="text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight font-['Outfit']">ProjectHub</span>
          <Button variant="ghost" size="icon" className="lg:hidden ml-auto" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={18} />
          </Button>
        </div>

        <div className="px-3 pt-4">
          <button onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            data-testid="open-command-palette">
            <Search size={14} /> Search…
            <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-secondary">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {allNav.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
            const badge = badgeFor(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200
                  ${active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {badge > 0 && (
                  <Badge className="ml-auto bg-primary text-[10px] px-1.5 py-0 h-5">{badge > 99 ? '99+' : badge}</Badge>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border/40 p-4">
          <Link to="/settings" className="flex items-center gap-3 rounded-md -m-1 p-1 hover:bg-secondary/40">
            <UserAvatar name={user?.name} className="h-9 w-9 border border-border" textClass="text-xs" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(user?.role)}</p>
            </div>
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border/40 flex items-center justify-between px-4 lg:px-8 bg-background/80 backdrop-blur-md sticky top-0 z-30" data-testid="topbar">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="menu-toggle" aria-label="Open menu">
              <Menu size={20} />
            </Button>
            <h1 className="text-lg font-semibold font-['Outfit'] tracking-tight">
              {allNav.find(n => location.pathname.startsWith(n.path))?.label
                || (location.pathname.startsWith('/settings') ? 'Settings' : 'ProjectHub')}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search">
              <Search size={18} />
            </Button>
            <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/notifications')} data-testid="topbar-notifications" aria-label="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary rounded-full text-[10px] flex items-center justify-center text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2" data-testid="user-menu-trigger">
                  <UserAvatar name={user?.name} className="h-7 w-7" textClass="text-xs" />
                  <span className="hidden sm:inline text-sm">{user?.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')} data-testid="menu-settings">
                  <Settings size={14} className="mr-2" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout" className="text-destructive">
                  <LogOut size={14} className="mr-2" /> Log Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </main>
      </div>

      <AIAssistant />
      <TaskDrawer />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
