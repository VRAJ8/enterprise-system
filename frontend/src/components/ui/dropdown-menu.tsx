import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export const menuContentClass =
  'z-50 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-elev-3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1'
export const menuItemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(menuItemClass, destructive && 'text-danger focus:bg-danger/10 focus:text-danger [&_svg]:text-danger', className)}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(menuItemClass, 'pr-7', className)} checked={checked} {...props}>
    {children}
    <span className="absolute right-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="!text-primary" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem'

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(menuItemClass, 'pr-7', className)} {...props}>
    {children}
    <span className="absolute right-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="!text-primary" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) => (
  <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-subtle', className)} {...props} />
)

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
)

export const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto text-2xs tracking-widest text-subtle', className)} {...props} />
)

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger ref={ref} className={cn(menuItemClass, 'data-[state=open]:bg-accent', className)} {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent ref={ref} className={cn(menuContentClass, className)} {...props} />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'
