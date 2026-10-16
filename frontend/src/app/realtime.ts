/**
 * Live updates: one WebSocket per tab. Server events are mapped to TanStack Query invalidations,
 * batched so a burst of events (e.g. bulk edits) triggers a single refetch per query family.
 */
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import * as React from 'react'
import { API_ORIGIN, tokenStore } from '@/api/client'
import { create } from 'zustand'

export interface RealtimeEvent {
  type: string
  workspace_id: string | null
  project_id: string | null
  task_id: string | null
  data: Record<string, unknown>
}

type ConnectionState = 'connecting' | 'open' | 'closed'
export const useRealtimeStatus = create<{ state: ConnectionState; set: (s: ConnectionState) => void }>((set) => ({
  state: 'closed',
  set: (state) => set({ state }),
}))

type Listener = (e: RealtimeEvent) => void
const listeners = new Set<Listener>()

/** Subscribe to raw events (e.g. to show a toast when someone else edits the open task). */
export function useRealtimeEvent(listener: Listener) {
  const ref = React.useRef(listener)
  ref.current = listener
  React.useEffect(() => {
    const l: Listener = (e) => ref.current(e)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
}

function keysFor(e: RealtimeEvent): QueryKey[] {
  const [entity] = e.type.split('.')
  const keys: QueryKey[] = []
  const project = e.project_id ? (['project', e.project_id] as QueryKey) : null
  const task = e.task_id ? (['task', e.task_id] as QueryKey) : null
  switch (entity) {
    case 'task':
    case 'dependency':
      keys.push(['tasks'], ['home'], ['insights'], ['activity'])
      if (task) keys.push(task, ['task', 'ref'])
      if (project) keys.push(project, ['projects'])
      break
    case 'comment':
    case 'attachment':
      if (task) keys.push(task)
      keys.push(['tasks'])
      if (project) keys.push([...(project as string[]), 'activity'])
      break
    case 'project':
    case 'project_update':
    case 'status':
    case 'milestone':
    case 'project_member':
      keys.push(['projects'], ['insights'], ['home'], ['tasks'])
      if (project) keys.push(project)
      break
    case 'notification':
      keys.push(['notifications'])
      break
    case 'timer':
    case 'time_entry':
      keys.push(['timer'], ['time'], ['insights', 'time'], ['home'])
      if (task) keys.push(task)
      break
    default:
      if (project) keys.push(project)
  }
  return keys
}

export function useRealtime(workspaceId: string) {
  const queryClient = useQueryClient()
  const setState = useRealtimeStatus((s) => s.set)

  React.useEffect(() => {
    let ws: WebSocket | null = null
    let retry = 0
    let closed = false
    let reconnectTimer: number | undefined
    let pingTimer: number | undefined
    const pending = new Map<string, QueryKey>()
    let flushTimer: number | undefined

    const flush = () => {
      flushTimer = undefined
      pending.forEach((key) => void queryClient.invalidateQueries({ queryKey: key }))
      pending.clear()
    }

    const connect = () => {
      const token = tokenStore.get()
      if (!token || closed) {
        reconnectTimer = window.setTimeout(connect, 1500)
        return
      }
      // VITE_WS_ORIGIN: when /api is proxied (e.g. by Netlify, which can't carry WebSockets), connect to the API host directly.
      const origin = (import.meta.env.VITE_WS_ORIGIN as string | undefined)?.replace(/\/$/, '') || API_ORIGIN || window.location.origin
      const url = `${origin.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token)}`
      setState('connecting')
      ws = new WebSocket(url)
      ws.onopen = () => {
        retry = 0
        setState('open')
        pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
      }
      ws.onmessage = (msg) => {
        if (msg.data === 'pong') return
        let event: RealtimeEvent
        try {
          event = JSON.parse(msg.data)
        } catch {
          return
        }
        if (event.type === 'hello') return
        if (event.workspace_id && event.workspace_id !== workspaceId && !event.type.startsWith('notification')) return
        listeners.forEach((l) => l(event))
        for (const key of keysFor(event)) pending.set(JSON.stringify(key), key)
        if (!flushTimer) flushTimer = window.setTimeout(flush, 120)
      }
      ws.onclose = (ev) => {
        window.clearInterval(pingTimer)
        setState('closed')
        if (closed) return
        // 4401 = token rejected: wait for the auth layer to refresh, then reconnect
        const delay = ev.code === 4401 ? 2000 : Math.min(30_000, 1000 * 2 ** retry++) + Math.random() * 500
        reconnectTimer = window.setTimeout(connect, delay)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    // Reconnect with a fresh token after the access token rotates
    const unsubscribe = tokenStore.subscribe((t) => {
      if (t && ws && ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
        window.clearTimeout(reconnectTimer)
        connect()
      }
    })
    // Catch up after the tab was asleep / offline
    const onOnline = () => void queryClient.invalidateQueries()
    window.addEventListener('online', onOnline)

    return () => {
      closed = true
      unsubscribe()
      window.removeEventListener('online', onOnline)
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      window.clearTimeout(flushTimer)
      ws?.close()
    }
  }, [workspaceId, queryClient, setState])
}
