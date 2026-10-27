import { useMemo, useState } from 'react'
import { IconChevronDown, IconMessage, IconSearch } from '../../icons'
import { Button, EmptyState, List, ListRow, PageSection, TextField } from '../../ui'
import type { ThreadEntry } from '../../lib/chat-thread'
import { ThreadStateMark, threadStateWords } from '../chat/thread/ThreadState'

/** Rows shown before "Show all" — a page, not the whole history. */
const PAGE = 10
/** Past this many conversations the list earns a filter field. */
const FILTER_AT = 8

/**
 * Every chat this project has had, newest activity first (decisions.md #6) —
 * the same threads, names and states as the header's thread list
 * (chat-as-web-components decision 14), both read from `thread.list`.
 *
 * A row is a name, and whether the chat is working, waiting for you, or how
 * long it has been idle — nothing else. The row opens the chat as its thread at
 * once (decision 7); a message picks a finished one back up.
 */
export function ConversationList({
  threads,
  pending,
  onOpen,
  now,
}: {
  threads: readonly ThreadEntry[]
  /** Still fetching for the first time — distinct from "there are none". */
  pending: boolean
  onOpen: (threadId: string) => void
  now?: number
}) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)

  const sorted = useMemo(() => [...threads].sort((a, b) => b.updatedAt - a.updatedAt), [threads])

  if (pending) return null

  const q = query.trim().toLowerCase()
  const matching = q ? sorted.filter((t) => t.title.toLowerCase().includes(q)) : sorted
  const shown = all || q ? matching : matching.slice(0, PAGE)
  const hidden = matching.length - shown.length

  return (
    <PageSection
      title="Chats"
      action={
        threads.length > FILTER_AT ? (
          <TextField
            icon={<IconSearch />}
            placeholder="Filter"
            aria-label="Filter chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            className="w-50"
          />
        ) : undefined
      }
    >
      {threads.length === 0 ? (
        <EmptyState
          compact
          icon={<IconMessage />}
          title="No chats yet"
          hint="A new chat starts from the row above."
        />
      ) : shown.length === 0 ? (
        <EmptyState compact icon={<IconSearch />} title="No chat matches" hint={`Nothing titled “${query.trim()}”.`} />
      ) : (
        <List label="Chats">
          {shown.map((t, i) => (
            <ListRow
              key={t.id}
              index={i}
              leading={t.state === 'idle' ? <IconMessage /> : <ThreadStateMark state={t.state} />}
              title={t.title}
              meta={threadStateWords(t.state, t.updatedAt, now)}
              onClick={() => onOpen(t.id)}
            />
          ))}
        </List>
      )}
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronDown />}
          className="mt-2"
          onClick={() => setAll(true)}
        >
          Show {hidden} more
        </Button>
      )}
    </PageSection>
  )
}
