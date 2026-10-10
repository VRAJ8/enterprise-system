import * as React from 'react'
import { useSearchParams } from 'react-router-dom'

/** The task peek panel is driven by `?task=WEB-42`, so it opens over any page and links are shareable. */
export function useTaskPanel() {
  const [params, setParams] = useSearchParams()
  const ref = params.get('task')

  const open = React.useCallback(
    (taskRef: string) => {
      // Switching between tasks replaces the history entry instead of stacking one per task
      const replace = params.has('task')
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('task', taskRef)
          return next
        },
        { replace },
      )
    },
    [params, setParams],
  )

  const close = React.useCallback(
    () =>
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('task')
        return next
      }),
    [setParams],
  )

  return { ref, open, close }
}
