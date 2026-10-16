import type { TooltipProps } from 'recharts'

/** Theme-aware colors for recharts (CSS variables, so light/dark both work). */
export const CHART = {
  primary: 'hsl(var(--primary))',
  muted: 'hsl(var(--muted-foreground))',
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--subtle, var(--muted-foreground)))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  danger: 'hsl(var(--danger))',
}

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
} as const

/** Compact tooltip card: label on top, one row per series with a swatch. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: TooltipProps<number, string> & { formatLabel?: (l: string) => string; formatValue?: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-elev-2">
      <p className="mb-1 font-medium">{formatLabel ? formatLabel(String(label)) : label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}
          <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">
            {formatValue ? formatValue(Number(p.value)) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex items-center gap-3 text-2xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3 rounded"
            style={i.dashed ? { borderTop: `2px dashed ${i.color}` } : { background: i.color, height: 2 }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}
