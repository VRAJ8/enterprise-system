import { cn } from '@/lib/utils'

/** Thin progress bar. value 0..1 */
export function ProgressBar({
  value,
  className,
  indicatorClassName,
  marker,
}: {
  value: number
  className?: string
  indicatorClassName?: string
  /** Optional 0..1 marker (e.g. expected progress) */
  marker?: number | null
}) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full rounded-full bg-primary transition-[width] duration-500 ease-out-expo', indicatorClassName)}
        style={{ width: `${pct}%` }}
      />
      {marker != null && (
        <div
          className="absolute inset-y-0 w-0.5 rounded-full bg-foreground/50"
          style={{ left: `calc(${Math.max(0, Math.min(1, marker)) * 100}% - 1px)` }}
        />
      )}
    </div>
  )
}

/** Circular progress ring. value 0..1 */
export function ProgressRing({
  value,
  size = 18,
  stroke = 2.5,
  className,
  color = 'hsl(var(--primary))',
}: {
  value: number
  size?: number
  stroke?: number
  className?: string
  color?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('-rotate-90', className)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        className="transition-[stroke-dashoffset] duration-700 ease-out-expo"
      />
    </svg>
  )
}
