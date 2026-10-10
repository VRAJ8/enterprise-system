import React from 'react';
import { Flag, CalendarClock } from 'lucide-react';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Badge } from './ui/badge';
import {
  statusConfig, priorityConfig, healthConfig, projectStatusConfig, initials, dueInfo,
} from '../lib/constants';

export function UserAvatar({ name, className = 'h-7 w-7', textClass = 'text-[10px]' }) {
  return (
    <Avatar className={className} title={name}>
      <AvatarFallback className={`bg-primary/20 text-primary ${textClass}`}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function PriorityFlag({ priority, showLabel = false }) {
  const cfg = priorityConfig[priority] || priorityConfig.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cfg.color}`} title={`${cfg.label} priority`}>
      <Flag size={11} />
      {showLabel && cfg.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const cfg = statusConfig[status] || statusConfig.todo;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] font-medium ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon size={11} /> {cfg.label}
    </Badge>
  );
}

export function ProjectStatusBadge({ status }) {
  const cfg = projectStatusConfig[status] || projectStatusConfig.active;
  return <Badge variant="outline" className={`text-[11px] ${cfg.badge}`}>{cfg.label}</Badge>;
}

export function HealthBadge({ health, reason }) {
  const cfg = healthConfig[health];
  if (!cfg) return null;
  return (
    <Badge variant="outline" className={`gap-1.5 text-[11px] ${cfg.badge}`} title={reason || cfg.label}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> {cfg.label}
    </Badge>
  );
}

export function DueChip({ task, className = '' }) {
  const info = dueInfo(task);
  if (!info) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${info.tone} ${className}`}>
      <CalendarClock size={11} /> {info.label}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-14 px-4">
      {Icon && <Icon size={40} className="mx-auto text-muted-foreground/40 mb-3" />}
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, className = 'h-1.5', barClass = 'bg-primary' }) {
  return (
    <div className={`w-full rounded-full bg-secondary overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}
