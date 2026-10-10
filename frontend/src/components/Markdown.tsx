import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/** Mentions are stored as @[Name](user:<uuid>) — rendered as chips. */
export const MENTION_RE = /@\[([^\]]+)\]\(user:([0-9a-f-]{36})\)/g

const components: Components = {
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('user:')) {
      return (
        <span className="mx-px inline-flex items-center rounded bg-primary-soft px-1 font-medium text-primary">@{children}</span>
      )
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
        {children}
      </a>
    )
  },
}

function preprocess(text: string) {
  // Turn mention tokens into plain markdown links with the user: scheme (rendered as chips above)
  return text.replace(MENTION_RE, (_m, name, id) => `[${name}](user:${id})`)
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const source = React.useMemo(() => preprocess(children ?? ''), [children])
  return (
    <div className={cn('prose-ph break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) => (url.startsWith('user:') || /^(https?:|mailto:|#|\/)/i.test(url) ? url : '')}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

/** Plain-text version (for previews/excerpts). */
export function stripMarkdown(text: string): string {
  return text
    .replace(MENTION_RE, '@$1')
    .replace(/[*_`>#~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
