import { useUI } from '@/app/ui-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Shortcut } from '@/components/ui/kbd'
import { modKey } from '@/lib/utils'

const GROUPS: { title: string; items: [string, string[]][] }[] = [
  {
    title: 'General',
    items: [
      ['Search & commands', [modKey, 'K']],
      ['Quick search', ['/']],
      ['Create task', ['C']],
      ['Toggle sidebar', ['[']],
      ['Show shortcuts', ['?']],
      ['Close panel / dialog', ['Esc']],
    ],
  },
  {
    title: 'Navigation',
    items: [
      ['Home', ['G', 'H']],
      ['Inbox', ['G', 'I']],
      ['My tasks', ['G', 'M']],
      ['Projects', ['G', 'P']],
      ['Workload', ['G', 'W']],
      ['Timesheets', ['G', 'T']],
      ['Insights', ['G', 'R']],
      ['Settings', ['G', 'S']],
    ],
  },
  {
    title: 'Lists & boards',
    items: [
      ['Move selection', ['J', 'K']],
      ['Open task', ['Enter']],
      ['Select task', ['X']],
    ],
  },
  {
    title: 'Task panel',
    items: [
      ['Change status', ['S']],
      ['Assign', ['A']],
      ['Set priority', ['P']],
      ['Set due date', ['D']],
      ['Copy link', [modKey, 'L']],
    ],
  },
]

export default function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen)
  const setOpen = useUI((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything is a keystroke away.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-subtle">{g.title}</p>
              <div className="space-y-1.5">
                {g.items.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <Shortcut keys={keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
