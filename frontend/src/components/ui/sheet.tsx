import * as SheetPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetTitle = SheetPrimitive.Title
export const SheetDescription = SheetPrimitive.Description

/** Right-side panel (task peek). Non-modal visually: light overlay so context stays visible. */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & { side?: 'right' | 'left'; overlay?: boolean }
>(({ className, children, side = 'right', overlay = true, ...props }, ref) => (
  <SheetPrimitive.Portal>
    {overlay && (
      <SheetPrimitive.Overlay className="fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    )}
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-40 flex w-full flex-col border-border bg-background shadow-elev-3 outline-none duration-300 ease-out-expo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200',
        side === 'right'
          ? 'right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-[min(760px,92vw)]'
          : 'left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
))
SheetContent.displayName = 'SheetContent'
