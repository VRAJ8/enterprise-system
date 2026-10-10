import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with content up to maxRows. */
  autosize?: boolean
  maxRows?: number
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autosize = false, maxRows = 16, onChange, ...props }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null)
    React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)

    const resize = React.useCallback(() => {
      const el = inner.current
      if (!autosize || !el) return
      el.style.height = 'auto'
      const lh = parseFloat(getComputedStyle(el).lineHeight || '20') || 20
      el.style.height = `${Math.min(el.scrollHeight, lh * maxRows + 16)}px`
    }, [autosize, maxRows])

    React.useLayoutEffect(resize, [resize, props.value])

    return (
      <textarea
        ref={inner}
        onChange={(e) => {
          onChange?.(e)
          resize()
        }}
        className={cn(
          'flex min-h-[72px] w-full resize-none rounded-md border border-input bg-surface-sunken px-2.5 py-2 text-sm leading-relaxed text-foreground placeholder:text-subtle focus-visible:border-ring/70 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'
