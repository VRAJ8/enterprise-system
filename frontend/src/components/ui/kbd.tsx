import { cn } from '@/lib/utils'

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface-sunken px-1 font-sans text-[10px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}
