/**
 * Selection + keyboard navigation for dense task lists (project list view, My Tasks).
 *
 *  - Checkbox per row, Shift+click selects a range from the last toggled row, Cmd/Ctrl+click toggles.
 *  - J/K or ↓/↑ move the active row (Shift extends the selection), Enter opens it, X toggles it.
 *  - Cmd/Ctrl+A selects every visible row, Esc clears the selection (then the active row).
 *  - While the task panel is open, moving the active row follows it in the panel.
 */
import * as React from 'react'
import type { Task } from '@/api/hooks/tasks'
import { useTaskPanel } from '@/app/task-panel'

export interface TaskSelectionApi {
  /** Set (or flip) one row and make it the range anchor. */
  toggle: (id: string, value?: boolean) => void
  /** Attach to a row wrapper's onClickCapture: handles Shift/Cmd clicks and tracks the active row. */
  rowClickCapture: (e: React.MouseEvent<HTMLElement>, id: string) => void
  /** Attach to a row wrapper's onMouseDown: stops Shift+click from selecting text. */
  rowMouseDown: (e: React.MouseEvent<HTMLElement>) => void
}

export interface TaskSelection {
  selectedIds: ReadonlySet<string>
  selectedTasks: Task[]
  activeId: string | null
  /** Stable callbacks, safe to pass to memoised rows. */
  api: TaskSelectionApi
  clear: () => void
  selectAll: () => void
  setActiveId: (id: string | null) => void
}

interface Options {
  /** Rows in on-screen order (collapsed groups excluded). Navigation and ranges use this. */
  rows: Task[]
  /** Every task that may stay selected (e.g. includes collapsed groups). Selection is pruned to it. */
  pool: Task[]
  /** Bind the keyboard shortcuts (turn off for inactive tabs). */
  keyboard?: boolean
  canSelect?: (t: Task) => boolean
}

function isTypingTarget(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

const OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'
const INTERACTIVE = 'button,a,input,textarea,select,[role="button"],[role="checkbox"]'

export function useTaskSelection({ rows, pool, keyboard = true, canSelect }: Options): TaskSelection {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const anchor = React.useRef<string | null>(null)
  const panel = useTaskPanel()

  const latest = React.useRef({ rows, canSelect, activeId, selected, panel })
  latest.current = { rows, canSelect, activeId, selected, panel }

  // Drop ids that left the list (deleted, filtered out, moved to another project…)
  React.useEffect(() => {
    const ids = new Set(pool.map((t) => t.id))
    setSelected((prev) => {
      let changed = false
      const next = new Set<string>()
      prev.forEach((id) => (ids.has(id) ? next.add(id) : (changed = true)))
      return changed ? next : prev
    })
  }, [pool])

  const api = React.useMemo<TaskSelectionApi & { range: (id: string) => void; selectAll: () => void; clear: () => void }>(() => {
    const selectable = (t: Task | undefined) => !!t && (!latest.current.canSelect || latest.current.canSelect(t))

    const toggle = (id: string, value?: boolean) => {
      anchor.current = id
      setSelected((prev) => {
        const on = value ?? !prev.has(id)
        if (on === prev.has(id)) return prev
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })
    }

    const range = (id: string) => {
      const { rows } = latest.current
      const to = rows.findIndex((t) => t.id === id)
      const from = anchor.current ? rows.findIndex((t) => t.id === anchor.current) : -1
      if (to < 0) return
      if (from < 0) return toggle(id, true)
      const [lo, hi] = from < to ? [from, to] : [to, from]
      setSelected((prev) => {
        const next = new Set(prev)
        rows.slice(lo, hi + 1).forEach((t) => selectable(t) && next.add(t.id))
        return next
      })
    }

    const selectAll = () => {
      const { rows } = latest.current
      setSelected(new Set(rows.filter(selectable).map((t) => t.id)))
    }

    const clear = () => {
      anchor.current = null
      setSelected((prev) => (prev.size ? new Set() : prev))
    }

    return {
      toggle,
      range,
      selectAll,
      clear,
      rowMouseDown: (e) => {
        if (e.shiftKey) e.preventDefault()
      },
      rowClickCapture: (e, id) => {
        const target = e.target as HTMLElement
        // Clicks inside portalled popovers bubble through React; ignore them
        if (!e.currentTarget.contains(target)) return
        const onCheckbox = !!target.closest('[role="checkbox"]')
        const onControl = !onCheckbox && !!target.closest(INTERACTIVE)
        if (onControl) return
        const task = latest.current.rows.find((t) => t.id === id)
        if (e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          if (selectable(task)) range(id)
          return
        }
        if ((e.metaKey || e.ctrlKey) && !onCheckbox) {
          e.preventDefault()
          e.stopPropagation()
          if (selectable(task)) toggle(id)
          return
        }
        if (!onCheckbox) setActiveId(id)
      },
    }
  }, [])

  // Keyboard
  React.useEffect(() => {
    if (!keyboard) return
    let lastG = 0

    const move = (delta: number, extend: boolean) => {
      const { rows, activeId, panel, canSelect } = latest.current
      if (!rows.length) return
      const idx = activeId ? rows.findIndex((t) => t.id === activeId) : -1
      const nextIdx = idx < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + delta))
      const next = rows[nextIdx]
      if (extend) {
        const current = idx >= 0 ? rows[idx] : null
        const ok = (t: Task | null) => !!t && (!canSelect || canSelect(t))
        if (!anchor.current && current) anchor.current = current.id
        setSelected((prev) => {
          const s = new Set(prev)
          if (ok(current)) s.add(current!.id)
          if (ok(next)) s.add(next.id)
          return s
        })
      }
      setActiveId(next.id)
      if (panel.ref && panel.ref !== next.ref) panel.open(next.ref)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const target = e.target as HTMLElement | null
      if (isTypingTarget(target) || target?.closest?.(OVERLAY)) return
      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey

      if (mod) {
        if (key === 'a' && latest.current.rows.length) {
          e.preventDefault()
          api.selectAll()
        }
        return
      }
      // "g" starts app-level navigation sequences (g h, g m…); don't steal the next key
      if (key === 'g') {
        lastG = Date.now()
        return
      }
      if (Date.now() - lastG < 900) return

      const { rows, activeId, panel, selected } = latest.current
      const active = activeId ? rows.find((t) => t.id === activeId) : undefined
      const onInteractive = !!target?.closest?.(INTERACTIVE)

      switch (key) {
        case 'j':
        case 'arrowdown':
          e.preventDefault()
          move(1, e.shiftKey)
          break
        case 'k':
        case 'arrowup':
          e.preventDefault()
          move(-1, e.shiftKey)
          break
        case 'enter':
          if (active && !onInteractive) {
            e.preventDefault()
            panel.open(active.ref)
          }
          break
        case 'x':
          if (active && !onInteractive) {
            const ok = !latest.current.canSelect || latest.current.canSelect(active)
            if (ok) {
              e.preventDefault()
              api.toggle(active.id)
            }
          }
          break
        case 'escape':
          // The task panel owns Esc while it is open
          if (panel.ref) return
          if (selected.size) {
            e.preventDefault()
            api.clear()
          } else if (activeId) {
            setActiveId(null)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, api])

  const selectedTasks = React.useMemo(() => pool.filter((t) => selected.has(t.id)), [pool, selected])

  return {
    selectedIds: selected,
    selectedTasks,
    activeId,
    api,
    clear: api.clear,
    selectAll: api.selectAll,
    setActiveId,
  }
}
