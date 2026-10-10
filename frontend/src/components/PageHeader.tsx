import { MobileNavButton } from '@/app/AppShell'
import { cn } from '@/lib/utils'

/**
 * Sticky page header used by every screen:
 *   <PageHeader title="Projects" icon={FolderKanban} actions={<Button/>}>{optional tabs/filters row}</PageHeader>
 */
export function PageHeader({
  title,
  icon: Icon,
  breadcrumb,
  actions,
  children,
  className,
}: {
  title: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  breadcrumb?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('shrink-0 border-b border-border/70 bg-background/80 backdrop-blur', className)}>
      <div className="flex h-12 items-center gap-2 px-4 sm:px-5">
        <MobileNavButton />
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {breadcrumb && (
            <>
              <span className="truncate text-muted-foreground">{breadcrumb}</span>
              <span className="text-subtle">/</span>
            </>
          )}
          <h1 className="truncate font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>
      {children && <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 scrollbar-none sm:px-5">{children}</div>}
    </header>
  )
}

/** Scrollable page body with consistent padding. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
}
