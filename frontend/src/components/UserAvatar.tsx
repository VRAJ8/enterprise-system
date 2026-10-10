import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { User as UserIcon } from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { Tip } from './ui/tooltip'

type AvatarUser = { name: string; avatar_color?: string | null }

const SIZES = {
  xs: 'size-4 text-[8px]',
  sm: 'size-5 text-[9px]',
  md: 'size-6 text-[10px]',
  lg: 'size-8 text-xs',
  xl: 'size-12 text-base',
} as const

export function UserAvatar({
  user,
  size = 'md',
  className,
  tooltip = false,
}: {
  user: AvatarUser | null | undefined
  size?: keyof typeof SIZES
  className?: string
  tooltip?: boolean
}) {
  const node = user ? (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-black/5',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: user.avatar_color ?? '#6366f1' }}
    >
      <AvatarPrimitive.Fallback delayMs={0}>{initials(user.name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  ) : (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-subtle/60 text-subtle',
        SIZES[size],
        className,
      )}
    >
      <UserIcon className="size-[60%]" />
    </span>
  )
  return tooltip ? <Tip content={user?.name ?? 'Unassigned'}>{node}</Tip> : node
}

export function AvatarStack({ users, max = 4, size = 'md' }: { users: AvatarUser[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = users.slice(0, max)
  const rest = users.length - shown.length
  return (
    <div className="flex -space-x-1.5">
      {shown.map((u, i) => (
        <UserAvatar key={i} user={u} size={size} tooltip className="ring-2 ring-background" />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-background',
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  )
}
