import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Shortcut } from './kbd'

export const TooltipProvider = TooltipPrimitive.Provider

/** <Tip content="Create task" keys={['C']}><Button/></Tip> */
export function Tip({
  content,
  keys,
  side = 'bottom',
  children,
  delay,
}: {
  content: React.ReactNode
  keys?: string[]
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactNode
  delay?: number
}) {
  if (!content) return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[60] flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-elev-2 animate-in fade-in-0 zoom-in-95',
          )}
        >
          {content}
          {keys && <Shortcut keys={keys} />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
