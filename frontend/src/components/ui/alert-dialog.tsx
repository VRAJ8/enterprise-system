import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-[18vh] z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 gap-4 rounded-xl border border-border bg-popover p-5 shadow-elev-3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  )
}

export const AlertDialogTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />
)
export const AlertDialogDescription = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
)
export const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex justify-end gap-2', className)} {...props} />
)
export const AlertDialogCancel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>) => (
  <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />
)
export const AlertDialogAction = ({
  className,
  destructive,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & { destructive?: boolean }) => (
  <AlertDialogPrimitive.Action
    className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }), className)}
    {...props}
  />
)
