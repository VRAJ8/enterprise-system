import * as React from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'flex h-8 w-full rounded-md border border-input bg-surface-sunken px-2.5 text-sm text-foreground shadow-[inset_0_1px_1px_hsl(var(--shadow)/0.04)] transition-colors placeholder:text-subtle focus-visible:border-ring/70 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} className={cn(inputClass, className)} ref={ref} {...props} />
  ),
)
Input.displayName = 'Input'
