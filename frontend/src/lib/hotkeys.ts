import * as React from 'react'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

type Handler = (e: KeyboardEvent) => void

/**
 * Global keyboard shortcuts. Keys: "c", "mod+k", "shift+?", sequences like "g h".
 * Ignored while typing in inputs unless `allowInInputs` (mod+ combos always work).
 */
export function useHotkeys(bindings: Record<string, Handler>, deps: React.DependencyList = [], allowInInputs = false) {
  const ref = React.useRef(bindings)
  ref.current = bindings

  React.useEffect(() => {
    let pending: string | null = null
    let timer: number | undefined

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      const typing = isTypingTarget(e.target)
      // Open dialogs/menus own the keyboard
      const inOverlay = !!(e.target as HTMLElement | null)?.closest?.('[role="dialog"],[role="menu"],[role="listbox"]')

      const combo = `${mod ? 'mod+' : ''}${e.shiftKey && key.length > 1 ? 'shift+' : ''}${key}`
      if (mod) {
        const h = ref.current[combo]
        if (h) {
          e.preventDefault()
          h(e)
        }
        return
      }
      if ((typing && !allowInInputs) || inOverlay || e.altKey) return

      if (pending) {
        const seq = `${pending} ${key}`
        pending = null
        window.clearTimeout(timer)
        const h = ref.current[seq]
        if (h) {
          e.preventDefault()
          h(e)
          return
        }
      }
      if (Object.keys(ref.current).some((k) => k.startsWith(`${key} `))) {
        pending = key
        timer = window.setTimeout(() => (pending = null), 900)
        return
      }
      const h = ref.current[key] ?? ref.current[combo]
      if (h) {
        e.preventDefault()
        h(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
