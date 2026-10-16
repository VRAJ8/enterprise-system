/**
 * Keyboard-first pickers (Popover + cmdk). All are controlled and data-agnostic:
 * pass options in, get selections out. Used by the task panel, board cards, list cells, bulk bar, create dialog.
 */
import { addDays, nextMonday } from 'date-fns'
import { Calendar as CalendarIcon, Check, Milestone as MilestoneIcon, Tag, UserMinus, X } from 'lucide-react'
import * as React from 'react'
import { formatDate, parseDate, toISODate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PriorityIcon,
  ProjectIcon,
  StatusIcon,
  type Priority,
  type StatusCategory,
} from './domain'
import { Calendar } from './ui/calendar'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { UserAvatar } from './UserAvatar'

export interface PickerOption {
  value: string
  label: string
  icon?: React.ReactNode
  keywords?: string[]
  hint?: React.ReactNode
}

interface BasePickerProps {
  children: React.ReactNode // trigger
  options: PickerOption[]
  placeholder?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
  footer?: React.ReactNode
  emptyText?: string
}

export function Picker({
  children,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  open: openProp,
  onOpenChange,
  align = 'start',
  disabled,
  footer,
  emptyText = 'No results',
}: BasePickerProps & { value: string | null | undefined; onChange: (value: string) => void }) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = onOpenChange ?? setOpenState
  if (disabled) return <>{children}</>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-0" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder={placeholder} autoFocus />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  keywords={o.keywords}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.icon}
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint}
                  {value === o.value && <Check className="!size-3.5 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function MultiPicker({
  children,
  options,
  values,
  onToggle,
  placeholder = 'Search…',
  open: openProp,
  onOpenChange,
  align = 'start',
  disabled,
  footer,
  emptyText = 'No results',
}: BasePickerProps & { values: string[]; onToggle: (value: string, selected: boolean) => void }) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = onOpenChange ?? setOpenState
  if (disabled) return <>{children}</>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-0" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder={placeholder} autoFocus />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const selected = values.includes(o.value)
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => onToggle(o.value, !selected)}>
                    <span
                      className={cn(
                        'flex size-3.5 items-center justify-center rounded-[3px] border',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {selected && <Check className="!size-2.5 !text-primary-foreground" strokeWidth={3} />}
                    </span>
                    {o.icon}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Specialised pickers ───

export interface StatusOption {
  id: string
  name: string
  category: StatusCategory
  color: string
}

export function StatusPicker({
  statuses,
  value,
  onChange,
  children,
  ...rest
}: Omit<BasePickerProps, 'options'> & { statuses: StatusOption[]; value?: string | null; onChange: (id: string) => void }) {
  const options = statuses.map((s, i) => ({
    value: s.id,
    label: s.name,
    icon: <StatusIcon category={s.category} color={s.color} />,
    hint: <span className="text-2xs text-subtle">{i + 1}</span>,
  }))
  return (
    <Picker options={options} value={value} onChange={onChange} placeholder="Change status…" {...rest}>
      {children}
    </Picker>
  )
}

export function PriorityPicker({
  value,
  onChange,
  children,
  ...rest
}: Omit<BasePickerProps, 'options'> & { value?: Priority | null; onChange: (p: Priority) => void }) {
  const options = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))
  return (
    <Picker options={options} value={value} onChange={(v) => onChange(v as Priority)} placeholder="Set priority…" {...rest}>
      {children}
    </Picker>
  )
}

export interface PersonOption {
  id: string
  name: string
  email?: string
  avatar_color?: string
}

const UNASSIGN = '__unassigned__'

export function AssigneePicker({
  people,
  value,
  onChange,
  children,
  meId,
  ...rest
}: Omit<BasePickerProps, 'options'> & {
  people: PersonOption[]
  value?: string | null
  onChange: (userId: string | null) => void
  meId?: string
}) {
  const sorted = [...people].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)))
  const options: PickerOption[] = [
    { value: UNASSIGN, label: 'Unassigned', icon: <UserMinus className="!size-4 text-subtle" /> },
    ...sorted.map((p) => ({
      value: p.id,
      label: p.id === meId ? `${p.name} (you)` : p.name,
      keywords: p.email ? [p.email] : undefined,
      icon: <UserAvatar user={p} size="sm" />,
    })),
  ]
  return (
    <Picker
      options={options}
      value={value ?? UNASSIGN}
      onChange={(v) => onChange(v === UNASSIGN ? null : v)}
      placeholder="Assign to…"
      {...rest}
    >
      {children}
    </Picker>
  )
}

export function LabelPicker({
  labels,
  values,
  onToggle,
  children,
  ...rest
}: Omit<BasePickerProps, 'options'> & {
  labels: { id: string; name: string; color: string }[]
  values: string[]
  onToggle: (labelId: string, selected: boolean) => void
}) {
  const options = labels.map((l) => ({
    value: l.id,
    label: l.name,
    icon: <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />,
  }))
  return (
    <MultiPicker
      options={options}
      values={values}
      onToggle={onToggle}
      placeholder="Add labels…"
      emptyText="No labels. Create them in settings."
      {...rest}
    >
      {children}
    </MultiPicker>
  )
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  children,
  ...rest
}: Omit<BasePickerProps, 'options'> & {
  projects: { id: string; name: string; key: string; color: string; icon: string }[]
  value?: string | null
  onChange: (projectId: string) => void
}) {
  const options = projects.map((p) => ({
    value: p.id,
    label: p.name,
    keywords: [p.key],
    icon: <ProjectIcon project={p} size="sm" />,
    hint: <span className="font-mono text-2xs text-subtle">{p.key}</span>,
  }))
  return (
    <Picker options={options} value={value} onChange={onChange} placeholder="Move to project…" {...rest}>
      {children}
    </Picker>
  )
}

const NO_MILESTONE = '__none__'
export function MilestonePicker({
  milestones,
  value,
  onChange,
  children,
  ...rest
}: Omit<BasePickerProps, 'options'> & {
  milestones: { id: string; name: string; due_date?: string | null }[]
  value?: string | null
  onChange: (milestoneId: string | null) => void
}) {
  const options: PickerOption[] = [
    { value: NO_MILESTONE, label: 'No milestone', icon: <X className="!size-4 text-subtle" /> },
    ...milestones.map((m) => ({
      value: m.id,
      label: m.name,
      icon: <MilestoneIcon className="!size-4" />,
      hint: m.due_date ? <span className="text-2xs text-subtle">{formatDate(m.due_date)}</span> : undefined,
    })),
  ]
  return (
    <Picker
      options={options}
      value={value ?? NO_MILESTONE}
      onChange={(v) => onChange(v === NO_MILESTONE ? null : v)}
      placeholder="Set milestone…"
      {...rest}
    >
      {children}
    </Picker>
  )
}

/** Date picker with quick choices (Today, Tomorrow, Next week…) and a calendar. */
export function DatePicker({
  value,
  onChange,
  children,
  open: openProp,
  onOpenChange,
  align = 'start',
  disabled,
  fromDate,
  title,
}: {
  value: string | null | undefined
  onChange: (date: string | null) => void
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
  fromDate?: string | null
  title?: string
}) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = onOpenChange ?? setOpenState
  if (disabled) return <>{children}</>
  const today = new Date()
  const quick = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next Monday', date: nextMonday(today) },
    { label: 'In 2 weeks', date: addDays(today, 14) },
  ]
  const pick = (d: Date | null) => {
    onChange(d ? toISODate(d) : null)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex">
          <div className="flex w-36 flex-col gap-0.5 border-r border-border p-1.5">
            {title && <p className="px-2 py-1 text-2xs font-medium uppercase tracking-wider text-subtle">{title}</p>}
            {quick.map((q) => (
              <button
                key={q.label}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => pick(q.date)}
              >
                {q.label}
                <span className="text-2xs text-subtle">{formatDate(q.date).split(' ')[1]}</span>
              </button>
            ))}
            {value && (
              <button
                className="mt-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
                onClick={() => pick(null)}
              >
                <X className="size-3.5" /> Clear
              </button>
            )}
          </div>
          <Calendar
            mode="single"
            selected={value ? parseDate(value) : undefined}
            defaultMonth={value ? parseDate(value) : undefined}
            onSelect={(d) => d && pick(d)}
            disabled={fromDate ? { before: parseDate(fromDate) } : undefined}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A compact, borderless trigger used for inline property editing. */
export const PropertyButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { empty?: boolean }
>(({ className, empty, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent',
      empty && 'text-subtle',
      className,
    )}
    {...props}
  >
    {children}
  </button>
))
PropertyButton.displayName = 'PropertyButton'

export { CalendarIcon, Tag }
