/**
 * Small, shared visual building blocks for domain concepts (status, priority, health, labels, dates, projects).
 */
import {
  AlertOctagon,
  Box,
  Briefcase,
  Code2,
  Flag,
  Folder,
  Gauge,
  Globe,
  Heart,
  Layers,
  Lightbulb,
  Megaphone,
  Palette,
  Rocket,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Target,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DUE_TONE_CLASS, dueLabel } from '@/lib/dates'
import { Tip } from './ui/tooltip'

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'canceled'
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none'
export type HealthStatus = 'on_track' | 'at_risk' | 'off_track' | 'not_started' | 'done' | 'no_data'

export const CLOSED: StatusCategory[] = ['done', 'canceled']
export const isClosed = (c: StatusCategory) => CLOSED.includes(c)

// ─── Status ───

/** Linear-style status glyph: progress ring by category, tinted with the status colour. */
export function StatusIcon({
  category,
  color,
  className,
}: {
  category: StatusCategory
  color?: string
  className?: string
}) {
  const c = color ?? 'currentColor'
  const common = { className: cn('size-3.5 shrink-0', className), viewBox: '0 0 14 14', fill: 'none' }
  switch (category) {
    case 'backlog':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      )
    case 'todo':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" />
        </svg>
      )
    case 'in_progress':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={c} />
        </svg>
      )
    case 'review':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5H7z" fill={c} />
        </svg>
      )
    case 'done':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={c} />
          <path d="m4.4 7.2 1.8 1.8 3.4-3.6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'canceled':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={c} />
          <path d="m5 5 4 4m0-4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
  }
}

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  canceled: 'Canceled',
}

export function StatusLabel({ status }: { status: { name: string; category: StatusCategory; color: string } }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <StatusIcon category={status.category} color={status.color} />
      <span>{status.name}</span>
    </span>
  )
}

// ─── Priority ───

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none']
export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === 'urgent') {
    return (
      <svg viewBox="0 0 14 14" className={cn('size-3.5 shrink-0', className)}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="hsl(var(--danger))" />
        <path d="M7 3.8v3.9" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.95" fill="white" />
      </svg>
    )
  }
  if (priority === 'none') {
    return (
      <svg viewBox="0 0 14 14" className={cn('size-3.5 shrink-0 text-subtle', className)}>
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    )
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5 shrink-0', className)}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={9 - i * 3}
          width="3"
          height={3 + i * 3}
          rx="0.8"
          fill="currentColor"
          className={i < level ? 'text-foreground/75' : 'text-foreground/15'}
        />
      ))}
    </svg>
  )
}

// ─── Health ───

export const HEALTH_META: Record<HealthStatus, { label: string; dot: string; text: string; bg: string }> = {
  on_track: { label: 'On track', dot: 'bg-success', text: 'text-success', bg: 'bg-success/10' },
  at_risk: { label: 'At risk', dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  off_track: { label: 'Off track', dot: 'bg-danger', text: 'text-danger', bg: 'bg-danger/10' },
  not_started: { label: 'Not started', dot: 'bg-subtle', text: 'text-muted-foreground', bg: 'bg-muted' },
  done: { label: 'Completed', dot: 'bg-info', text: 'text-info', bg: 'bg-info/10' },
  no_data: { label: 'No data', dot: 'bg-subtle', text: 'text-muted-foreground', bg: 'bg-muted' },
}

export function HealthBadge({
  status,
  reasons,
  className,
}: {
  status: HealthStatus
  reasons?: string[]
  className?: string
}) {
  const m = HEALTH_META[status] ?? HEALTH_META.no_data
  const badge = (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium', m.bg, m.text, className)}
    >
      <span className={cn('size-1.5 rounded-full', m.dot, status === 'off_track' && 'animate-pulse-soft')} />
      {m.label}
    </span>
  )
  if (!reasons?.length) return badge
  return (
    <Tip
      content={
        <ul className="max-w-xs space-y-0.5">
          {reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      }
    >
      {badge}
    </Tip>
  )
}

// ─── Labels ───

export function LabelChip({ label, className }: { label: { name: string; color: string }; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-[10rem] items-center gap-1 rounded-full border border-border bg-surface px-1.5 text-2xs font-medium text-foreground/80',
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
      <span className="truncate">{label.name}</span>
    </span>
  )
}

// ─── Due date ───

export function DueDate({
  date,
  closed = false,
  className,
  showIcon = false,
}: {
  date: string | null | undefined
  closed?: boolean
  className?: string
  showIcon?: boolean
}) {
  if (!date) return null
  const { label, tone } = dueLabel(date, closed)
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', DUE_TONE_CLASS[tone], className)}>
      {showIcon && <Flag className="size-3" />}
      {label}
    </span>
  )
}

// ─── Projects ───

export const PROJECT_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  target: Target,
  code: Code2,
  palette: Palette,
  megaphone: Megaphone,
  layers: Layers,
  box: Box,
  zap: Zap,
  globe: Globe,
  smartphone: Smartphone,
  shield: Shield,
  sparkles: Sparkles,
  lightbulb: Lightbulb,
  briefcase: Briefcase,
  cart: ShoppingCart,
  heart: Heart,
  wrench: Wrench,
  gauge: Gauge,
  alert: AlertOctagon,
}

export const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b',
  '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#64748b',
]

export function ProjectIcon({
  project,
  size = 'md',
  className,
}: {
  project: { color: string; icon: string }
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const Icon = PROJECT_ICONS[project.icon] ?? Folder
  const box = size === 'sm' ? 'size-4 rounded-[4px]' : size === 'lg' ? 'size-8 rounded-lg' : 'size-5 rounded-md'
  const icon = size === 'sm' ? 'size-2.5' : size === 'lg' ? 'size-4' : 'size-3'
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', box, className)}
      style={{ backgroundColor: `${project.color}22`, color: project.color }}
    >
      <Icon className={icon} strokeWidth={2.25} />
    </span>
  )
}
