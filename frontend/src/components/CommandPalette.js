import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from './ui/command';
import { FolderKanban, ListTodo, LayoutDashboard, Inbox, MessageSquare, Bell, Settings } from 'lucide-react';
import { projectsApi, tasksApi } from '../lib/api';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { statusConfig } from '../lib/constants';

const PAGES = [
  { label: 'My Work', path: '/my-work', icon: Inbox },
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Projects', path: '/projects', icon: FolderKanban },
  { label: 'Tasks', path: '/tasks', icon: ListTodo },
  { label: 'Chat', path: '/chat', icon: MessageSquare },
  { label: 'Notifications', path: '/notifications', icon: Bell },
  { label: 'Settings', path: '/settings', icon: Settings },
];

/** Ctrl/⌘+K quick switcher for pages, projects and tasks. */
export default function CommandPalette({ open, onOpenChange }) {
  const navigate = useNavigate();
  const { openTask } = useTaskDrawer();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    Promise.all([projectsApi.list(), tasksApi.list()])
      .then(([p, t]) => { setProjects(p.data); setTasks(t.data); })
      .catch(() => {});
  }, [open]);

  const go = (fn) => { onOpenChange(false); fn(); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects, tasks or pages…" data-testid="command-input" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem key={p.path} value={`page ${p.label}`} onSelect={() => go(() => navigate(p.path))}>
              <p.icon size={14} className="mr-2" /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.slice(0, 50).map((p) => (
              <CommandItem key={p.project_id} value={`project ${p.name} ${p.project_id}`} onSelect={() => go(() => navigate(`/projects/${p.project_id}`))}>
                <FolderKanban size={14} className="mr-2" /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {tasks.slice(0, 200).map((t) => {
              const Icon = statusConfig[t.status]?.icon || ListTodo;
              return (
                <CommandItem key={t.task_id} value={`task ${t.title} ${t.project_name} ${t.task_id}`} onSelect={() => go(() => openTask(t.task_id))}>
                  <Icon size={14} className={`mr-2 ${statusConfig[t.status]?.color}`} />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[40%]">{t.project_name}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
