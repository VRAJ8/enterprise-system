import { useUnreadCount } from '@/api/hooks/insights'

export default function InboxBadge() {
  const { data } = useUnreadCount()
  if (!data?.count) return null
  return (
    <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-2xs font-semibold leading-5 text-primary-foreground">
      {data.count > 99 ? '99+' : data.count}
    </span>
  )
}
