/**
 * Markdown textarea with @mention autocomplete.
 *
 * Users see friendly "@Jane Doe" text while typing; on save, `serialize()` converts known mentions
 * into the storage token @[Jane Doe](user:<uuid>) that the API parses for notifications.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { MENTION_RE } from './Markdown'
import { Textarea, type TextareaProps } from './ui/textarea'
import { UserAvatar } from './UserAvatar'

export interface MentionPerson {
  id: string
  name: string
  avatar_color?: string
}

/** Storage body -> editable text + the mentions it contains. */
export function fromStorage(body: string): { text: string; mentions: Map<string, string> } {
  const mentions = new Map<string, string>()
  const text = body.replace(MENTION_RE, (_m, name: string, id: string) => {
    mentions.set(name, id)
    return `@${name}`
  })
  return { text, mentions }
}

/** Editable text -> storage body (only names picked from the menu become real mentions). */
export function toStorage(text: string, mentions: Map<string, string>): string {
  let out = text
  // Longest names first so "Ann Lee" wins over "Ann"
  for (const [name, id] of [...mentions.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(^|[^\\w@\\[])@${escaped}(?![\\w])`, 'g'), `$1@[${name}](user:${id})`)
  }
  return out
}

export function useMentionEditor(initialBody = '') {
  const initial = React.useMemo(() => fromStorage(initialBody), [initialBody])
  const [text, setText] = React.useState(initial.text)
  const mentions = React.useRef(initial.mentions)
  const reset = React.useCallback((body = '') => {
    const next = fromStorage(body)
    mentions.current = next.mentions
    setText(next.text)
  }, [])
  return {
    text,
    setText,
    mentions: mentions.current,
    addMention: (p: MentionPerson) => mentions.current.set(p.name, p.id),
    serialize: () => toStorage(text, mentions.current).trim(),
    reset,
  }
}

interface MentionEditorProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  editor: ReturnType<typeof useMentionEditor>
  people: MentionPerson[]
  /** Cmd/Ctrl+Enter */
  onSubmit?: () => void
}

export function MentionEditor({ editor, people, onSubmit, className, onKeyDown, ...props }: MentionEditorProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = React.useState<{ start: number; text: string } | null>(null)
  const [active, setActive] = React.useState(0)

  const matches = React.useMemo(() => {
    if (!query) return []
    const q = query.text.toLowerCase()
    return people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)
  }, [people, query])

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = before.match(/(^|\s)@([\w.\- ]{0,24})$/)
    if (m && !m[2].includes('  ')) {
      setQuery({ start: caret - m[2].length - 1, text: m[2] })
      setActive(0)
    } else setQuery(null)
  }

  const choose = (p: MentionPerson) => {
    if (!query || !ref.current) return
    const el = ref.current
    const caret = el.selectionStart
    const next = `${editor.text.slice(0, query.start)}@${p.name} ${editor.text.slice(caret)}`
    editor.addMention(p)
    editor.setText(next)
    setQuery(null)
    const pos = query.start + p.name.length + 2
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        autosize
        value={editor.text}
        onChange={(e) => {
          editor.setText(e.target.value)
          detect(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + matches.length) % matches.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              choose(matches[active])
              return
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setQuery(null)
              return
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault()
            onSubmit()
            return
          }
          onKeyDown?.(e)
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={cn('min-h-[60px]', className)}
        {...props}
      />
      {query && matches.length > 0 && (
        <div className="absolute bottom-full left-2 z-50 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-elev-3 animate-in fade-in-0 zoom-in-95">
          <p className="px-2 py-1 text-2xs font-medium uppercase tracking-wider text-subtle">Mention</p>
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                i === active && 'bg-accent',
              )}
            >
              <UserAvatar user={p} size="sm" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
