import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id="ph-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="0.5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#ph-logo)" />
      <path d="M9 11.5h9M9 16h14M9 20.5h6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      {!compact && <span className="text-[15px] font-semibold tracking-tight">ProjectHub</span>}
    </div>
  )
}
