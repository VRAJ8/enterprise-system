import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isSameYear,
  parseISO,
  startOfWeek,
} from 'date-fns'

/** Parse an API calendar date ("2026-10-14") as a *local* date (no timezone shift). */
export function parseDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Local Date -> "YYYY-MM-DD" for the API. */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function daysFromToday(value: string): number {
  return differenceInCalendarDays(parseDate(value), new Date())
}

/** "Oct 14" (or "Oct 14, 2027" when not this year). */
export function formatDate(value: string | Date | null | undefined, withWeekday = false): string {
  if (!value) return ''
  const d = typeof value === 'string' ? parseDate(value) : value
  const base = isSameYear(d, new Date()) ? 'MMM d' : 'MMM d, yyyy'
  return format(d, withWeekday ? `EEE, ${base}` : base)
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'done'

/** Human due-date label and tone: "2d overdue", "Today", "Tomorrow", "Fri", "Oct 14". */
export function dueLabel(value: string, closed = false): { label: string; tone: DueTone } {
  const n = daysFromToday(value)
  if (closed) return { label: formatDate(value), tone: 'done' }
  if (n < 0) return { label: n === -1 ? 'Yesterday' : `${-n}d overdue`, tone: 'overdue' }
  if (n === 0) return { label: 'Today', tone: 'today' }
  if (n === 1) return { label: 'Tomorrow', tone: 'soon' }
  if (n < 7) return { label: format(parseDate(value), 'EEE'), tone: 'soon' }
  return { label: formatDate(value), tone: 'later' }
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  soon: 'text-foreground/80',
  later: 'text-muted-foreground',
  done: 'text-muted-foreground',
}

/** "3m ago", "2h ago", "Oct 3". Timestamps from the API are ISO with timezone. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = parseISO(iso)
  const diffDays = differenceInCalendarDays(new Date(), d)
  if (diffDays > 6) return formatDate(d)
  const secs = (Date.now() - d.getTime()) / 1000
  if (secs < 45) return 'just now'
  return `${formatDistanceToNowStrict(d).replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace(/ seconds?/, 's')} ago`
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a")
}

/** 95 -> "1h 35m", 60 -> "1h", 20 -> "20m". */
export function formatMinutes(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h && r) return `${h}h ${r}m`
  if (h) return `${h}h`
  return `${r}m`
}

/** 1.5 -> "1.5h", 8 -> "8h". */
export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—'
  const rounded = Math.round(hours * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`
}

/** Parse "1h 30m", "90m", "1.5h", "1:30", "45" (minutes) -> minutes, or null. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const colon = s.match(/^(\d+):(\d{1,2})$/)
  if (colon) return Number(colon[1]) * 60 + Number(colon[2])
  const hm = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/)
  if (hm && (hm[1] || hm[2])) return Math.round(Number(hm[1] ?? 0) * 60 + Number(hm[2] ?? 0))
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  return null
}

export function weekStart(date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

export { addDays, format, parseISO }
