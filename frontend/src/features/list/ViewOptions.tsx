import { ArrowUpDown, Layers } from 'lucide-react'
import * as React from 'react'
import { Picker } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { GROUP_BY_OPTIONS, ORDER_BY_OPTIONS, type GroupBy, type OrderBy } from './grouping'

/** Group / order state remembered per view in localStorage. */
export function useListOptions(storageKey: string, defaults: { groupBy: GroupBy; orderBy: OrderBy }) {
  const read = () => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') } as typeof defaults
    } catch {
      return defaults
    }
  }
  const [opts, setOpts] = React.useState(read)
  const update = (patch: Partial<typeof defaults>) =>
    setOpts((o) => {
      const next = { ...o, ...patch }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  return [opts, update] as const
}

export function ViewOptions({
  groupBy,
  orderBy,
  onChange,
}: {
  groupBy: GroupBy
  orderBy: OrderBy
  onChange: (patch: { groupBy?: GroupBy; orderBy?: OrderBy }) => void
}) {
  const g = GROUP_BY_OPTIONS.find((o) => o.value === groupBy)
  const o = ORDER_BY_OPTIONS.find((x) => x.value === orderBy)
  return (
    <>
      <Picker
        options={GROUP_BY_OPTIONS.map((x) => ({ value: x.value, label: x.label, icon: <x.icon className="size-3.5" /> }))}
        value={groupBy}
        onChange={(v) => onChange({ groupBy: v as GroupBy })}
      >
        <Button variant="ghost" size="sm">
          <Layers /> <span className="hidden md:inline">{g?.label}</span>
        </Button>
      </Picker>
      <Picker
        options={ORDER_BY_OPTIONS.map((x) => ({ value: x.value, label: x.label, icon: <x.icon className="size-3.5" /> }))}
        value={orderBy}
        onChange={(v) => onChange({ orderBy: v as OrderBy })}
      >
        <Button variant="ghost" size="sm">
          <ArrowUpDown /> <span className="hidden md:inline">{o?.label}</span>
        </Button>
      </Picker>
    </>
  )
}
