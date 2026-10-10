import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button'

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center text-sm font-medium',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-1 top-1 flex items-center justify-between',
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'z-10'),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'z-10'),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 text-2xs font-medium uppercase text-subtle',
        week: 'mt-1 flex w-full',
        day: 'relative size-8 p-0 text-center text-sm',
        day_button:
          'inline-flex size-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected: '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
        today: '[&>button]:font-semibold [&>button]:text-primary',
        outside: 'opacity-40',
        disabled: 'opacity-30',
        range_middle: '[&>button]:rounded-none [&>button]:bg-primary-soft [&>button]:text-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  )
}
